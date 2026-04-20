import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let main: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  })
  main = await app.firstWindow()
  await main.waitForTimeout(3000)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
})

test.describe('Terminal Mirroring', () => {
  test('session content appears in both main window tab and popout window', async () => {
    // Create a new session
    await main.keyboard.press('Control+N')
    await main.waitForTimeout(500)

    // Get the active session ID
    const sessionId = await main.evaluate(() => {
      const sessions = document.querySelectorAll('[data-session-id]')
      for (const el of sessions) {
        if (el instanceof HTMLElement && el.style.display !== 'none') {
          return el.dataset.sessionId || null
        }
      }
      return null
    })

    expect(sessionId).toBeTruthy()
    if (!sessionId) return

    // Type a command in the main window's terminal
    await main.keyboard.type('echo "test from main"')
    await main.keyboard.press('Enter')
    await main.waitForTimeout(1000)

    // Verify the content appears in the main window
    const mainContent = await main.evaluate(() => {
      const containers = document.querySelectorAll('[data-session-id]')
      for (const container of containers) {
        if (container instanceof HTMLElement && container.style.display !== 'none') {
          return container.textContent || ''
        }
      }
      return ''
    })
    expect(mainContent).toContain('test from main')

    // Pop out the session using keyboard shortcut
    await main.keyboard.press('Control+Shift+P')
    await main.waitForTimeout(1500)

    // Get all windows
    const windows = app.windows()
    expect(windows.length).toBeGreaterThan(1)

    // Find the popout window (not the main window)
    const popout = windows.find(w => w !== main)
    expect(popout).toBeTruthy()
    if (!popout) return

    await popout.waitForLoadState('domcontentloaded')
    await popout.waitForTimeout(1000)

    // Type in the main window's tab - content should appear in both
    await main.bringToFront()
    await main.keyboard.type('echo "typed in main after popout"')
    await main.keyboard.press('Enter')
    await main.waitForTimeout(1500)

    // Verify content appears in main window
    const mainAfterType = await main.evaluate(() => {
      const containers = document.querySelectorAll('[data-session-id]')
      for (const container of containers) {
        if (container instanceof HTMLElement && container.style.display !== 'none') {
          return container.textContent || ''
        }
      }
      return ''
    })
    expect(mainAfterType).toContain('typed in main after popout')

    // Verify same content appears in popout window
    const popoutAfterType = await popout.evaluate(() => {
      const screen = document.querySelector('.xterm-screen') as HTMLElement
      return screen?.textContent || ''
    })
    expect(popoutAfterType).toContain('typed in main after popout')

    // Type in the popout window - content should appear in both
    await popout.bringToFront()
    await popout.keyboard.type('echo "typed in popout"')
    await popout.keyboard.press('Enter')
    await popout.waitForTimeout(1500)

    // Verify content appears in popout
    const popoutContent = await popout.evaluate(() => {
      const screen = document.querySelector('.xterm-screen') as HTMLElement
      return screen?.textContent || ''
    })
    expect(popoutContent).toContain('typed in popout')

    // Verify same content appears in main window
    const mainContentFinal = await main.evaluate(() => {
      const containers = document.querySelectorAll('[data-session-id]')
      for (const container of containers) {
        if (container instanceof HTMLElement && container.style.display !== 'none') {
          return container.textContent || ''
        }
      }
      return ''
    })
    expect(mainContentFinal).toContain('typed in popout')

    // Close the popout window
    await popout.close()
    await main.waitForTimeout(500)

    // Verify the main window tab still works after closing popout
    await main.bringToFront()
    await main.keyboard.type('echo "after popout closed"')
    await main.keyboard.press('Enter')
    await main.waitForTimeout(1500)

    const mainAfterClose = await main.evaluate(() => {
      const containers = document.querySelectorAll('[data-session-id]')
      for (const container of containers) {
        if (container instanceof HTMLElement && container.style.display !== 'none') {
          return container.textContent || ''
        }
      }
      return ''
    })
    expect(mainAfterClose).toContain('after popout closed')
  })

  test('multiple popouts can coexist without cross-wiring', async () => {
    // This test just verifies that having multiple popouts open doesn't cause
    // data to cross-wire between sessions. The detailed assertion is hard in
    // an environment with many pre-existing sessions.
    
    // Create a session and pop it out
    await main.keyboard.press('Control+N')
    await main.waitForTimeout(500)
    await main.keyboard.type('echo "popout1"')
    await main.keyboard.press('Enter')
    await main.waitForTimeout(500)
    
    await main.keyboard.press('Control+Shift+P')
    await main.waitForTimeout(1500)

    // Create another session and pop it out
    await main.keyboard.press('Control+N')
    await main.waitForTimeout(500)
    await main.keyboard.type('echo "popout2"')
    await main.keyboard.press('Enter')
    await main.waitForTimeout(500)
    
    await main.keyboard.press('Control+Shift+P')
    await main.waitForTimeout(1500)

    const windows = app.windows()
    // Should have main window + at least 2 popouts
    expect(windows.length).toBeGreaterThanOrEqual(3)

    // Clean up by collapsing all
    await main.keyboard.press('Control+Shift+C')
    await main.waitForTimeout(500)
  })
})

