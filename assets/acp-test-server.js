#!/usr/bin/env node
/**
 * Simple ACP (Agent Client Protocol) test server.
 * Run this on the Dev Box to test the Tangent remote connection pipeline.
 *
 * Usage:
 *   node acp-test-server.js [port]
 *
 * Default port: 7333
 *
 * This creates a TCP server that speaks ndjson (newline-delimited JSON),
 * which is the transport the ACP SDK expects. It responds to:
 *   - initialize → returns capabilities
 *   - session/create → returns a fake session
 *   - session/update → echoes back
 *   - prompt/send → returns a canned response
 */

const net = require('net')

const PORT = parseInt(process.argv[2] || '7333', 10)

function sendJson(socket, obj) {
  const line = JSON.stringify(obj) + '\n'
  socket.write(line)
}

function handleMessage(socket, msg) {
  console.log(`← ${JSON.stringify(msg)}`)

  // JSON-RPC response helper
  const respond = (result) => {
    const resp = { jsonrpc: '2.0', id: msg.id, result }
    console.log(`→ ${JSON.stringify(resp)}`)
    sendJson(socket, resp)
  }

  switch (msg.method) {
    case 'initialize':
      respond({
        capabilities: {
          streaming: true,
          permissions: true
        },
        serverInfo: {
          name: 'acp-test-server',
          version: '0.1.0'
        }
      })
      break

    case 'session/create':
    case 'session/new':
      respond({
        sessionId: `test-session-${Date.now()}`,
        agentName: 'test-agent',
        status: 'ready'
      })
      break

    case 'session/resume':
      respond({ status: 'resumed' })
      break

    case 'prompt/send':
    case 'prompt':
      // Send a streaming response then complete
      const sessionId = msg.params?.sessionId || 'unknown'
      const promptText = msg.params?.messages?.[0]?.content?.[0]?.text || msg.params?.text || '(empty)'
      const notification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          message: {
            role: 'assistant',
            content: `🎉 ACP test server received your prompt: "${promptText}"\n\nThe remote connection pipeline is working end-to-end!`
          },
          status: 'completed'
        }
      }
      respond({ accepted: true })
      // Send the session update notification after a brief delay
      setTimeout(() => {
        console.log(`→ notification: session/update`)
        sendJson(socket, notification)
      }, 500)
      break

    case 'session/close':
      respond({ closed: true })
      break

    default:
      if (msg.id) {
        respond({ echo: true, method: msg.method })
      }
  }
}

const server = net.createServer((socket) => {
  console.log(`✅ Client connected from ${socket.remoteAddress}:${socket.remotePort}`)

  let buffer = ''

  socket.on('data', (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''  // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        handleMessage(socket, msg)
      } catch (e) {
        console.warn(`⚠ Failed to parse: ${line.substring(0, 100)}`)
      }
    }
  })

  socket.on('close', () => {
    console.log('🔌 Client disconnected')
  })

  socket.on('error', (err) => {
    console.warn(`⚠ Socket error: ${err.message}`)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ACP Test Server listening on port ${PORT}`)
  console.log(`   Waiting for Tangent to connect via dev tunnel...\n`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Kill the existing process or use a different port.`)
  } else {
    console.error(`❌ Server error: ${err.message}`)
  }
  process.exit(1)
})
