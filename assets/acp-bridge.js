#!/usr/bin/env node
/**
 * ACP Bridge — wraps `@github/copilot --acp` (stdio) as a TCP server.
 *
 * The Copilot CLI's --acp mode speaks ndjson over stdin/stdout.
 * This bridge listens on a TCP port and maintains a SINGLE Copilot process
 * that survives tunnel reconnections. Multiple TCP connections (from tunnel
 * drops/reconnects) are transparently routed to the same Copilot process.
 *
 * Usage:
 *   node acp-bridge.js [port]       # default: 7333
 *
 * Prerequisites:
 *   npm install -g @github/copilot   # or npx handles it
 */

const net = require('net')
const { spawn } = require('child_process')

const PORT = parseInt(process.argv[2] || '7333', 10)
const GRACE_PERIOD_MS = 120_000 // 2 minutes before killing Copilot after disconnect

// Persistent state — survives socket reconnections
let currentSocket = null
let copilotProc = null
let graceTimer = null
let stdoutBuffer = ''

function forwardToSocket(text) {
  if (currentSocket && !currentSocket.destroyed) {
    const preview = text.substring(0, 200).replace(/\n/g, '\\n')
    console.log(`[← copilot stdout → socket] ${preview}`)
    currentSocket.write(text)
  } else {
    const preview = text.substring(0, 200).replace(/\n/g, '\\n')
    console.log(`[← copilot stdout → DROPPED (no socket)] ${preview}`)
  }
}

function spawnCopilot() {
  const isWindows = process.platform === 'win32'
  let cmd, args
  try {
    const { execSync } = require('child_process')
    execSync(isWindows ? 'where copilot' : 'which copilot', { stdio: 'ignore' })
    cmd = 'copilot'
    args = ['--acp']
  } catch {
    cmd = 'npx'
    args = ['--yes', '@github/copilot', '--acp']
  }

  console.log(`🚀 Spawning: ${cmd} ${args.join(' ')}`)
  copilotProc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWindows,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
  })
  console.log(`🚀 Copilot CLI spawned (PID ${copilotProc.pid})`)

  // Bridge: copilot stdout → current socket (only valid ndjson lines)
  copilotProc.stdout.on('data', (data) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() // keep incomplete line in buffer
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('{')) {
        forwardToSocket(trimmed + '\n')
      } else {
        console.log(`[copilot stdout filtered] ${trimmed}`)
      }
    }
  })

  copilotProc.stderr.on('data', (data) => {
    const text = data.toString().trim()
    if (text) console.log(`[copilot stderr] ${text}`)
  })

  copilotProc.on('close', (code) => {
    console.log(`🔌 Copilot process exited (code ${code})`)
    copilotProc = null
    if (currentSocket && !currentSocket.destroyed) currentSocket.destroy()
    currentSocket = null
  })

  copilotProc.on('error', (err) => {
    console.error(`❌ Failed to spawn copilot: ${err.message}`)
    forwardToSocket(JSON.stringify({
      jsonrpc: '2.0', id: null,
      error: { code: -1, message: `Failed to spawn copilot: ${err.message}` }
    }) + '\n')
    copilotProc = null
  })
}

const server = net.createServer((socket) => {
  // Cancel any pending grace timer — client reconnected
  if (graceTimer) {
    clearTimeout(graceTimer)
    graceTimer = null
    console.log('🔄 Client reconnected — cancelled grace timer')
  }

  // Replace current socket (tunnel reconnect creates new TCP connection)
  if (currentSocket && !currentSocket.destroyed) {
    console.log('⚠ New client connected — replacing previous socket (keeping Copilot alive)')
    currentSocket.destroy()
  }
  currentSocket = socket

  const reconnecting = !!copilotProc
  console.log(`✅ Client connected from ${socket.remoteAddress}:${socket.remotePort}` +
    (reconnecting ? ' (reconnected to existing Copilot)' : ' (fresh)'))

  // Bridge: socket → copilot stdin
  socket.on('data', (data) => {
    if (!copilotProc) {
      // Lazy spawn on first data
      spawnCopilot()
    }
    if (copilotProc && copilotProc.stdin.writable) {
      const preview = data.toString().substring(0, 200).replace(/\n/g, '\\n')
      console.log(`[→ copilot stdin] ${preview}`)
      copilotProc.stdin.write(data)
    }
  })

  socket.on('close', () => {
    console.log('🔌 Client disconnected — starting grace period')
    if (currentSocket === socket) currentSocket = null

    // Don't kill Copilot immediately — tunnel might reconnect
    graceTimer = setTimeout(() => {
      if (copilotProc) {
        console.log(`⏰ Grace period expired (${GRACE_PERIOD_MS / 1000}s) — killing Copilot`)
        copilotProc.kill()
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
  console.log(`\n🌉 ACP Bridge listening on port ${PORT}`)
  console.log(`   Copilot spawned on first client data, survives reconnections`)
  console.log(`   Grace period: ${GRACE_PERIOD_MS / 1000}s before killing Copilot on disconnect`)
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
  if (copilotProc) copilotProc.kill()
  server.close()
  process.exit(0)
})
