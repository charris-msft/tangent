#!/usr/bin/env node
/**
 * ACP Bridge — wraps `@github/copilot --acp` (stdio) as a TCP server.
 *
 * The Copilot CLI's --acp mode speaks ndjson over stdin/stdout.
 * This bridge listens on a TCP port and spawns a Copilot process
 * per connection, bridging TCP ↔ stdio.
 *
 * Copilot is only spawned when the client sends data (not on bare TCP connect),
 * so health-check probes don't waste resources.
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

let activeClient = null

const server = net.createServer((socket) => {
  if (activeClient) {
    console.log('⚠ New client connected — disconnecting previous')
    activeClient.socket.destroy()
    if (activeClient.proc) activeClient.proc.kill()
  }

  console.log(`✅ Client connected from ${socket.remoteAddress}:${socket.remotePort}`)

  let proc = null
  let dataBuffer = []
  const isWindows = process.platform === 'win32'

  activeClient = { socket, proc }

  function spawnCopilot() {
    proc = spawn('npx', ['--yes', '@github/copilot', '--acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
    activeClient.proc = proc
    console.log(`🚀 Copilot CLI spawned (PID ${proc.pid})`)

    // Flush buffered data
    for (const chunk of dataBuffer) {
      if (proc.stdin.writable) proc.stdin.write(chunk)
    }
    dataBuffer = []

    // Bridge: copilot stdout → socket
    proc.stdout.on('data', (data) => {
      if (!socket.destroyed) socket.write(data)
    })

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim()
      if (text) console.log(`[copilot stderr] ${text}`)
    })

    proc.on('close', (code) => {
      console.log(`🔌 Copilot process exited (code ${code})`)
      if (!socket.destroyed) socket.destroy()
      if (activeClient?.proc === proc) activeClient = null
    })

    proc.on('error', (err) => {
      console.error(`❌ Failed to spawn copilot: ${err.message}`)
      if (!socket.destroyed) {
        socket.write(JSON.stringify({
          jsonrpc: '2.0', id: null,
          error: { code: -1, message: `Failed to spawn copilot: ${err.message}` }
        }) + '\n')
        socket.destroy()
      }
    })
  }

  // Bridge: socket → copilot stdin (lazy spawn on first data)
  socket.on('data', (data) => {
    if (!proc) {
      dataBuffer.push(data)
      spawnCopilot()
    } else if (proc.stdin.writable) {
      proc.stdin.write(data)
    }
  })

  socket.on('close', () => {
    console.log('🔌 Client disconnected')
    if (proc) {
      if (proc.stdin.writable) proc.stdin.end()
      proc.kill()
    }
    if (activeClient?.socket === socket) activeClient = null
  })

  socket.on('error', (err) => {
    console.warn(`⚠ Socket error: ${err.message}`)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌉 ACP Bridge listening on port ${PORT}`)
  console.log(`   Each client connection spawns: npx @github/copilot --acp`)
  console.log(`   Bridging TCP ↔ stdio (ndjson)`)
  console.log(`   Copilot only spawned when client sends data (probes ignored)\n`)
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
  if (activeClient?.proc) activeClient.proc.kill()
  server.close()
  process.exit(0)
})
