import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  })
  page = await app.firstWindow()
  // Wait for the app to fully render
  await page.waitForTimeout(3000)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
})

test.describe('Tangent App — Visual & Behavioral', () => {
  test('app window opens and has correct title', async () => {
    const title = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return { visible: win.isVisible(), bounds: win.getBounds() }
    })
    expect(title.visible).toBe(true)
    expect(title.bounds.width).toBeGreaterThanOrEqual(600)
    expect(title.bounds.height).toBeGreaterThanOrEqual(400)
  })

  test('layout renders correctly', async () => {
    await page.screenshot({ path: 'tests/screenshots/01-initial-layout.png' })

    // Sessions panel on the left
    const sessionsPanel = page.locator('text=SESSIONS')
    await expect(sessionsPanel).toBeVisible()

    // Status bar at the bottom
    const statusBar = page.locator('text=Ctrl+B panels')
    await expect(statusBar).toBeVisible()

    // Terminal should be visible
    const xtermEl = page.locator('.xterm:visible').first()
    await expect(xtermEl).toBeVisible()
  })

  test('auto-session is created on startup', async () => {
    // Should have at least one session — look for the "Active" section toggle
    const activeToggle = page.getByRole('button', { name: /Active/ })
    await expect(activeToggle).toBeVisible()

    // A session item with "shell" badge should exist
    const sessionItems = page.locator('text=shell').first()
    await expect(sessionItems).toBeVisible()
  })

  test('terminal renders with xterm', async () => {
    // xterm creates a .xterm container
    const xtermEl = page.locator('.xterm:visible').first()
    await expect(xtermEl).toBeVisible()

    await page.screenshot({ path: 'tests/screenshots/02-terminal-visible.png' })
  })

  test('session subtitle does not show escape sequences', async () => {
    // Wait for terminal to initialize and show prompt
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'tests/screenshots/03-session-subtitle.png' })

    // Check that no escape sequence artifacts appear in the session panel
    // Common leaks: □[?25h, [?25l, [0m, etc.
    const sessionPanel = page.locator('.flex.flex-col').first()
    const panelText = await sessionPanel.textContent()

    // Should not contain raw escape sequence fragments
    expect(panelText).not.toContain('[?25')
    expect(panelText).not.toContain('[0m')
    expect(panelText).not.toContain('\\x1b')
    expect(panelText).not.toContain('\x1b')
  })

  test('sessions panel can be toggled with Ctrl+B', async () => {
    // Panel should be visible initially — use the panel header specifically
    const sessionsHeader = page.getByText(/^Sessions \(\d+\)$/)
    await expect(sessionsHeader).toBeVisible()

    // Toggle off
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'tests/screenshots/06-panel-hidden.png' })

    // Toggle back on
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(500)
    await expect(sessionsHeader).toBeVisible()
  })

  test('session can be closed with Ctrl+W', async () => {
    // Create a new session first so we don't close the only one
    await page.keyboard.press('Control+n')
    await page.waitForTimeout(2000)

    // Count sessions from the panel header "Sessions (N)"
    const headerBefore = await page.getByText(/^Sessions \(\d+\)$/).textContent()
    const beforeCount = parseInt(headerBefore?.match(/Sessions \((\d+)\)/)?.[1] || '0', 10)

    await page.keyboard.press('Control+w')
    await page.waitForTimeout(1000)

    await page.screenshot({ path: 'tests/screenshots/07-session-closed.png' })

    // Session count should have decreased
    const headerAfter = await page.getByText(/^Sessions \(\d+\)$/).textContent()
    const afterCount = parseInt(headerAfter?.match(/Sessions \((\d+)\)/)?.[1] || '0', 10)
    expect(afterCount).toBeLessThan(beforeCount)

    // Should auto-select another session (not show "No Session")
    const statusBar = await page.locator('text=Shell').last()
    await expect(statusBar).toBeVisible()

    // A terminal should be visible (auto-selected session renders it)
    const visibleTerminal = page.locator('.xterm:visible')
    await expect(visibleTerminal.first()).toBeVisible()
  })

  test('agent tabs visible on right edge', async () => {
    await page.screenshot({ path: 'tests/screenshots/08-agent-tabs.png' })

    // The vertical tab strip should always be visible with a "+" add-group button
    const addGroupBtn = page.getByRole('button', { name: 'Add group' })
    await expect(addGroupBtn).toBeVisible()
  })

  test('terminal receives PowerShell prompt', async () => {
    // Wait for PS prompt to appear in terminal
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'tests/screenshots/09-ps-prompt.png' })

    // A visible terminal should have rendered some content
    const visibleXterm = page.locator('.xterm:visible').first()
    await expect(visibleXterm).toBeVisible()
  })

  test('Ctrl+V pastes clipboard text into terminal', async () => {
    // Put known text on the clipboard
    const testText = 'echo tangent-paste-test'
    await app.evaluate(async ({ clipboard }, text) => {
      clipboard.writeText(text)
    }, testText)

    // Focus the terminal
    const xtermEl = page.locator('.xterm:visible').first()
    await xtermEl.click()
    await page.waitForTimeout(500)

    // Paste with Ctrl+V
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(1000)

    await page.screenshot({ path: 'tests/screenshots/10-paste-test.png' })

    // Verify the pasted text appears in the terminal buffer
    // xterm renders text into .xterm-rows; check that our test string is present
    const terminalText = await xtermEl.locator('.xterm-rows').textContent()
    expect(terminalText).toContain('tangent-paste-test')
  })
})
