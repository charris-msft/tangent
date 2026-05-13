// General regression suite (max 5 tests). These are the load-bearing behaviors
// that MUST keep working across any refactor. If a bug slips through, replace
// the least-valuable of these with a test that would have caught it — see
// .github/copilot-instructions.md -> "E2E hook workflow".
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  page = await app.firstWindow()
  await page.waitForTimeout(4000)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
})

function sessionCount(page: Page) {
  return page.locator('button[aria-label="Close session"]').count()
}

test.describe('regression/general', () => {
  // 1. App launches and renders terminal + sessions panel
  test('app launches and renders shell', async () => {
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
    expect(bounds.width).toBeGreaterThan(600)
    await expect(page.locator('.xterm:visible').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('text=SESSIONS').first()).toBeVisible()
  })

  // 2. At least one auto-created session exists
  test('auto-created session is present', async () => {
    const count = await sessionCount(page)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  // 3. × opens React confirm modal with Cancel + Close buttons.
  //    Primary guard: window.confirm regression (modal must be React, not native).
  //    (Actual session removal is covered by specific.spec.ts via the IPC path.)
  test('× opens React modal (not window.confirm)', async () => {
    await page.evaluate(() => {
      ;(window as any).__confirmCalled = false
      const orig = window.confirm
      window.confirm = (...a: any[]) => { (window as any).__confirmCalled = true; return orig.apply(window, a as any) }
    })

    await page.locator('button[aria-label="Close session"]').first().click()
    await page.waitForTimeout(500)

    await expect(page.locator('text=/Close session/i').first()).toBeVisible()
    const nativeCalled = await page.evaluate(() => (window as any).__confirmCalled === true)
    expect(nativeCalled).toBe(false)

    // Dismiss modal to leave state clean for the next test.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  // 4. Per-session popout button is present (guards popout UX regression)
  test('popout button renders on session rows', async () => {
    const popBtn = page.locator('button[aria-label="Pop out"], button[aria-label="Pull back"]')
    expect(await popBtn.count()).toBeGreaterThanOrEqual(1)
  })

  // 5. Status bar exposes Explode + Collapse All buttons
  test('status bar Explode + Collapse buttons render', async () => {
    const explode  = page.locator('button[title*="Explode" i]')
    const collapse = page.locator('button[title*="Collapse" i]')
    await expect(explode.first()).toBeVisible()
    await expect(collapse.first()).toBeVisible()
  })
})
