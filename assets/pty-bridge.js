#!/usr/bin/env node
/**
 * PTY Bridge — spawns `copilot` in a pseudo-terminal and bridges TCP ↔ PTY.
 *
 * Unlike the ACP bridge (ndjson over stdio), this bridge gives the FULL
 * Copilot CLI TUI experience. Raw terminal bytes flow between the TCP
 * client (Tangent via devtunnel) and the Copilot process's PTY.
 *
 * Usage:
 *   node pty-bridge.js [port] [cols] [rows]    # default: 7333, 120, 40
 *
 * Prerequisites:
 *   npm install -g @github/copilot   # or npx handles it
 *
 * Architecture:
 *   Tangent (xterm.js) ←TCP→ devtunnel ←TCP→ pty-bridge ←PTY→ copilot
 */

const net = require('net')
const { spawn } = require('child_process')
const os = require('os')

const PORT = parseInt(process.argv[2] || '7333', 10)
const DEFAULT_COLS = parseInt(process.argv[3] || '120', 10)
const DEFAULT_ROWS = parseInt(process.argv[4] || '40', 10)
const GRACE_PERIOD_MS = 120_000 // 2 minutes before killing Copilot on disconnect

// Persistent state — survives socket reconnections
let currentSocket = null
let copilotProc = null
let graceTimer = null
let ptyModule = null
let pendingCwd = os.homedir() // Default cwd, updated by control frame

// Try to load node-pty for proper PTY support
try {
  ptyModule = require('node-pty')
  console.log('✅ node-pty available — full PTY support')
} catch {
  console.log('⚠ node-pty not available — falling back to conpty-less mode')
}

function spawnCopilot(cols, rows) {
  const isWindows = process.platform === 'win32'

  // Find copilot binary — node-pty needs the FULL path on Windows
  let cmd, args
  try {
    const { execSync } = require('child_process')
    const which = execSync(isWindows ? 'where copilot' : 'which copilot', { encoding: 'utf8' }).trim()
    // 'where' can return multiple lines; take the first
    cmd = which.split(/\r?\n/)[0].trim()
    args = []
  } catch {
    // Fall back to npx
    const { execSync } = require('child_process')
    try {
      const npxPath = execSync(isWindows ? 'where npx.cmd' : 'which npx', { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim()
      cmd = npxPath
    } catch {
      cmd = isWindows ? 'npx.cmd' : 'npx'
    }
    args = ['--yes', '@github/copilot']
  }

  if (ptyModule) {
    // Spawn in a real PTY — this gives full TUI support
    // Ensure cwd exists (create if needed)
    const fs = require('fs')
    if (!fs.existsSync(pendingCwd)) {
      try {
        fs.mkdirSync(pendingCwd, { recursive: true })
        console.log(`📁 Created workspace dir: ${pendingCwd}`)
      } catch (mkdirErr) {
        console.warn(`⚠ Could not create ${pendingCwd}: ${mkdirErr.message}, falling back to home`)
        pendingCwd = os.homedir()
      }
    }

    console.log(`🚀 Spawning PTY: ${cmd} ${args.join(' ')} (${cols}x${rows}) cwd=${pendingCwd}`)
    try {
      copilotProc = ptyModule.spawn(cmd, args, {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: pendingCwd,
        env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' }
      })
    } catch (spawnErr) {
      console.error(`❌ PTY spawn failed: ${spawnErr.message}`)
      console.error(`   cmd: "${cmd}", args: ${JSON.stringify(args)}`)
      console.error(`   Falling back to pipe mode...`)
      copilotProc = null
      // Fall through to pipe-based fallback below
    }

    if (copilotProc) {
      console.log(`🚀 Copilot CLI spawned in PTY (PID ${copilotProc.pid})`)

      // PTY output → current socket
      copilotProc.onData((data) => {
        if (currentSocket && !currentSocket.destroyed) {
          currentSocket.write(data)
        }
      })

      copilotProc.onExit(({ exitCode }) => {
        console.log(`🔌 Copilot process exited (code ${exitCode})`)
        copilotProc = null
        if (currentSocket && !currentSocket.destroyed) currentSocket.destroy()
        currentSocket = null
      })
      return
    }
  }

  // Fallback: spawn with pipe stdio (no real PTY, limited TUI)
  console.log(`🚀 Spawning (no PTY): ${cmd} ${args.join(' ')} cwd=${pendingCwd}`)
  copilotProc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWindows,
    cwd: pendingCwd,
    env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1', COLUMNS: String(cols), LINES: String(rows) }
  })
  console.log(`🚀 Copilot CLI spawned (PID ${copilotProc.pid}) — no PTY, limited TUI`)

  copilotProc.stdout.on('data', (data) => {
    if (currentSocket && !currentSocket.destroyed) {
      currentSocket.write(data)
    }
  })

  copilotProc.stderr.on('data', (data) => {
    if (currentSocket && !currentSocket.destroyed) {
      currentSocket.write(data)
    }
  })

  copilotProc.on('close', (code) => {
    console.log(`🔌 Copilot process exited (code ${code})`)
    copilotProc = null
    if (currentSocket && !currentSocket.destroyed) currentSocket.destroy()
    currentSocket = null
  })

  copilotProc.on('error', (err) => {
    console.error(`❌ Failed to spawn copilot: ${err.message}`)
    copilotProc = null
  })
}

function resizePty(cols, rows) {
  if (copilotProc && ptyModule && copilotProc.resize) {
    try {
      copilotProc.resize(cols, rows)
      console.log(`📐 PTY resized to ${cols}x${rows}`)
    } catch (err) {
      console.warn(`⚠ Resize failed: ${err.message}`)
    }
  }
}

// Track the desired terminal size (updated by resize control frames)
let pendingCols = DEFAULT_COLS
let pendingRows = DEFAULT_ROWS

// Control frame protocol:
// \x00\x00\x01 + cols(2BE) + rows(2BE) = resize (7 bytes)
// \x00\x00\x02 + length(2BE) + utf8_bytes = set cwd (5 + length bytes)
// Everything else is raw terminal data passed through to the PTY
function handleData(data) {
  if (data.length >= 3 && data[0] === 0 && data[1] === 0) {
    const cmd = data[2]

    // Resize: \x00\x00\x01 + cols(2) + rows(2)
    if (cmd === 1 && data.length >= 7) {
      const cols = data.readUInt16BE(3)
      const rows = data.readUInt16BE(5)

      if (!copilotProc) {
        pendingCols = cols
        pendingRows = rows
        spawnCopilot(cols, rows)
      } else {
        resizePty(cols, rows)
      }

      if (data.length > 7) handleData(data.slice(7))
      return
    }

    // Set CWD: \x00\x00\x02 + length(2BE) + utf8_bytes
    if (cmd === 2 && data.length >= 5) {
      const cwdLen = data.readUInt16BE(3)
      if (data.length >= 5 + cwdLen) {
        const newCwd = data.slice(5, 5 + cwdLen).toString('utf8')
        pendingCwd = newCwd
        console.log(`📁 CWD set to: ${newCwd}`)

        if (data.length > 5 + cwdLen) handleData(data.slice(5 + cwdLen))
        return
      }
    }
  }

  // Regular data — spawn with pending dimensions if not yet spawned
  if (!copilotProc) {
    spawnCopilot(pendingCols, pendingRows)
  }
  writeToProcess(data)
}

function writeToProcess(data) {
  if (!copilotProc) return

  if (ptyModule && copilotProc.write) {
    // node-pty process
    copilotProc.write(data.toString())
  } else if (copilotProc.stdin && copilotProc.stdin.writable) {
    // Regular child process
    copilotProc.stdin.write(data)
  }
}

const server = net.createServer((socket) => {
  // Cancel any pending grace timer
  if (graceTimer) {
    clearTimeout(graceTimer)
    graceTimer = null
    console.log('🔄 Client reconnected — cancelled grace timer')
  }

  // Replace current socket
  if (currentSocket && !currentSocket.destroyed) {
    console.log('⚠ New client connected — replacing previous socket (keeping Copilot alive)')
    currentSocket.destroy()
  }
  currentSocket = socket

  const reconnecting = !!copilotProc
  console.log(`✅ Client connected from ${socket.remoteAddress}:${socket.remotePort}` +
    (reconnecting ? ' (reconnected to existing Copilot)' : ' (fresh)'))

  // Socket → Copilot PTY (handleData manages lazy spawn with correct dimensions)
  socket.on('data', (data) => {
    handleData(data)
  })

  socket.on('close', () => {
    console.log('🔌 Client disconnected — starting grace period')
    if (currentSocket === socket) currentSocket = null

    graceTimer = setTimeout(() => {
      if (copilotProc) {
        console.log(`⏰ Grace period expired (${GRACE_PERIOD_MS / 1000}s) — killing Copilot`)
        if (ptyModule && copilotProc.kill) {
          copilotProc.kill()
        } else if (copilotProc.kill) {
          copilotProc.kill()
        }
        copilotProc = null
      }
      graceTimer = null
    }, GRACE_PERIOD_MS)
  })

  socket.on('error', (err) => {
    console.warn(`⚠ Socket error: ${err.message}`)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌉 PTY Bridge listening on port ${PORT}`)
  console.log(`   Copilot spawned in PTY on first client data`)
  console.log(`   Full TUI support: ${ptyModule ? 'YES (node-pty)' : 'NO (fallback mode)'}`)
  console.log(`   Default terminal size: ${DEFAULT_COLS}x${DEFAULT_ROWS}`)
  console.log(`   Grace period: ${GRACE_PERIOD_MS / 1000}s before killing Copilot on disconnect`)
  console.log(`   Resize protocol: \\x00\\x00\\x01 + cols(2BE) + rows(2BE)`)
  console.log(`   Waiting for Tangent to connect via dev tunnel...\n`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use.`)
  } else {
    console.error(`❌ Server error: ${err.message}`)
  }
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...')
  if (copilotProc) {
    if (ptyModule && copilotProc.kill) copilotProc.kill()
    else if (copilotProc.kill) copilotProc.kill()
  }
  server.close()
  process.exit(0)
})
