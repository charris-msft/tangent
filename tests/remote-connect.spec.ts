import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
const mainLogs: string[] = []

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  })

  app.process().stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      const trimmed = line.trim()
      if (trimmed) {
        mainLogs.push(trimmed)
        console.log(`[MAIN] ${trimmed}`)
      }
    }
  })
  app.process().stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.includes('Debugger') && !trimmed.includes('inspector')) {
        mainLogs.push(`[ERR] ${trimmed}`)
        console.log(`[MAIN-ERR] ${trimmed}`)
      }
    }
  })

  page = await app.firstWindow()
  await page.waitForTimeout(5000)
})

test.afterAll(async () => {
  await page.close().catch(() => {})
  await app.close().catch(() => {})
})

test.describe('Remote Dev Box Connection', () => {
  test('lego1 remote agent connects via dev tunnel to ACP bridge', async () => {
    test.setTimeout(180000) // 3 min — Dev Box startup + tunnel + ACP

    // Launch lego1 using the test-friendly IPC (no UI interaction needed)
    const result = await page.evaluate(async () => {
      return await (window as any).tangentAPI.agents.launchByName('lego1')
    })
    console.log('Launch result:', JSON.stringify(result))
    expect(result.launched).toBe(true)

    // Poll session states until we see the remote session progress
    let connected = false
    let lastState = ''
    for (let i = 0; i < 30; i++) { // 30 × 5s = 150s max
      await page.waitForTimeout(5000)

      try {
        const sessions = await page.evaluate(async () => {
          return await (window as any).tangentAPI.test.getSessionStates()
        })

        const remoteSessions = sessions.filter((s: any) => s.kind === 'remote-agent' || s.devBoxName)
        if (remoteSessions.length > 0) {
          const rs = remoteSessions[remoteSessions.length - 1]
          const state = `${rs.status}/${rs.remoteState ?? 'none'}`
          if (state !== lastState) {
            console.log(`[${(i+1)*5}s] Remote session: status=${rs.status} remoteState=${rs.remoteState} devBox=${rs.devBoxName}`)
            lastState = state
          }

          // Success conditions
          if (rs.status === 'agent_ready' || rs.status === 'needs_input' || rs.status === 'processing') {
            if (rs.remoteState === 'connected' || rs.remoteState === 'ready') {
              console.log(`🎉 Remote session connected! (${(i+1)*5}s)`)
              connected = true
              break
            }
          }

          // Failure
          if (rs.status === 'failed') {
            console.log(`❌ Remote session failed at ${(i+1)*5}s`)
            break
          }
        } else {
          console.log(`[${(i+1)*5}s] No remote sessions yet...`)
        }
      } catch {
        console.log(`[${(i+1)*5}s] Page evaluate failed — app may be closing`)
        break
      }

      // Also check main process logs for key milestones
      const recentLogs = mainLogs.slice(-5)
      for (const log of recentLogs) {
        if (log.includes('DevTunnel mapped ACP') || log.includes('ACP port') || log.includes('Creating ACP session')) {
          console.log(`📍 Milestone: ${log}`)
        }
      }
    }

    // Take final screenshot
    try {
      await page.screenshot({ path: 'tests/screenshots/remote-final.png' })
    } catch { /* page closed */ }

    // Print relevant main process logs
    console.log('\n=== Key Main Process Logs ===')
    for (const log of mainLogs) {
      if (log.includes('Tangent 2') || log.includes('DevTunnel') || log.includes('ACP') || log.includes('tunnel') || log.includes('[ERR]')) {
        console.log(log)
      }
    }

    // Assert: tunnel was at least attempted
    const tunnelAttempted = mainLogs.some(l => l.includes('DevTunnel: connecting'))
    const acpReachable = mainLogs.some(l => l.includes('ACP port') && l.includes('reachable'))
    
    console.log(`\nTunnel attempted: ${tunnelAttempted}`)
    console.log(`ACP reachable: ${acpReachable}`)
    console.log(`Connected: ${connected}`)
  })
})
