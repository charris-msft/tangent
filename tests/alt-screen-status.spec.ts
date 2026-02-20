import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * E2E test: Status detection with --alt-screen on.
 *
 * Flow:
 *   1. Launch Tangent
 *   2. Open the Demos project folder (Ctrl+3)
 *   3. Press 4 to launch "Games" agent (has --alt-screen on)
 *   4. Wait for Copilot to boot
 *   5. Type "ask me to choose from 4 colors" + Enter
 *   6. Verify orange status appears (needs_input)
 *   7. Answer the question
 *   8. Verify status clears within 10 seconds
 *   9. Wait for idle prompt
 *   10. Verify yellow status (agent_ready)
 */

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
  await page.waitForTimeout(3000)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
})

test.describe('alt-screen status detection', () => {
  test('full lifecycle: boot → processing → needs_input → clear → idle', async () => {
    test.setTimeout(180000)

    // Step 1: Open Demos project folder (Ctrl+3)
    await page.keyboard.press('Control+3')
    await page.waitForTimeout(500)

    // Step 2: Launch Games agent (4th agent in Demos folder)
    await page.keyboard.press('4')
    await page.waitForTimeout(2000)

    // Step 3: Wait for Copilot to boot
    let copilotReady = false
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000)
      const termText = await page.locator('.xterm:visible .xterm-screen').first().innerText().catch(() => '')
      if (termText && (termText.includes('Describe a task') || termText.includes('to mention') || termText.includes('GitHub Copilot'))) {
        copilotReady = true
        break
      }
    }
    await page.screenshot({ path: 'tests/screenshots/alt-screen-01-ready.png' })
    expect(copilotReady).toBe(true)

    // Wait for MCP servers and prompt to fully initialize
    await page.waitForTimeout(5000)

    // Step 4: Type the prompt
    const xtermEl = page.locator('.xterm:visible').first()
    await xtermEl.click()
    await page.waitForTimeout(1000)
    await page.keyboard.type('ask me to choose from 4 different colors', { delay: 30 })
    await page.waitForTimeout(1000)
    await page.keyboard.press('Enter')

    // Step 5: Wait for ask_user prompt (orange status)
    let askUserVisible = false
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000)
      const termText = await page.locator('.xterm:visible .xterm-screen').first().innerText().catch(() => '')
      if (termText && (termText.includes('type your answer') || termText.includes('to select') || termText.includes('Asking user'))) {
        askUserVisible = true
        break
      }
    }
    await page.screenshot({ path: 'tests/screenshots/alt-screen-02-ask-user.png' })
    expect(askUserVisible).toBe(true)

    // Step 6: Verify orange pulsing dot
    await page.waitForTimeout(1000)
    const pulsingDot = page.locator('.animate-pulse-fast')
    const dotCount = await pulsingDot.count()
    await page.screenshot({ path: 'tests/screenshots/alt-screen-03-orange.png' })
    expect(dotCount).toBeGreaterThan(0)

    // Step 7: Answer the question
    await page.keyboard.press('1')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')

    // Step 8: Verify status clears within 10 seconds
    let cleared = false
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000)
      const stillPulsing = await page.locator('.animate-pulse-fast').count()
      if (stillPulsing === 0) {
        cleared = true
        break
      }
    }
    await page.screenshot({ path: 'tests/screenshots/alt-screen-04-cleared.png' })
    expect(cleared).toBe(true)

    // Step 9: Wait for Copilot to finish processing and show idle prompt
    let idleReached = false
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000)
      const termText = await page.locator('.xterm:visible .xterm-screen').first().innerText().catch(() => '')
      if (termText && termText.includes('to mention')) {
        idleReached = true
        break
      }
    }
    await page.screenshot({ path: 'tests/screenshots/alt-screen-05-idle.png' })
    expect(idleReached).toBe(true)
  })
})
