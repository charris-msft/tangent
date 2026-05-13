// Specific regression test. Validates the most recently fixed functionality.
// Update this file each time a new bug is fixed so the agentStop hook re-runs
// the check on every subsequent turn until the fix is known-good.
//
// Current target:
//   - xterm content must stay clipped inside the terminal column and never
//     render under/behind the right AgentsSidebar rail.
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let page: Page

type Box = { x: number; y: number; width: number; height: number }

const TOLERANCE_PX = 2

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

async function requiredBox(locator: Locator, name: string): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, `${name} should have a visible layout box`).not.toBeNull()
  return box!
}

function rightEdge(box: Box): number {
  return box.x + box.width
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    rightEdge(a) > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

test.describe('regression/specific', () => {
  test('visible xterm surfaces stay inside terminal column and clear of agent rail', async () => {
    const terminalColumn = page.getByTestId('terminal-column')
    const xterm = page.locator('.xterm:visible').first()
    const addProjectButton = page.getByRole('button', { name: 'Add project' })
    const agentRail = addProjectButton.locator('xpath=ancestor::div[contains(@class, "min-w-11")][1]')

    await expect(terminalColumn).toBeVisible({ timeout: 15000 })
    await expect(xterm).toBeVisible({ timeout: 15000 })
    await expect(addProjectButton).toBeVisible()
    await expect(agentRail).toBeVisible()

    const sessionId = await page.evaluate(async () => {
      const api = (window as any).tangentAPI
      const sessions = await api.session.getAll()
      const active = sessions.find((s: any) => s.status !== 'exited') ?? sessions[0]
      if (!active) return null
      await api.session.select(active.id)
      return active.id as string
    })
    expect(sessionId, 'a session should be available for terminal output').toBeTruthy()

    const longLine = `echo TANGENT_WRAP_GUARD_${'X'.repeat(260)}\r`
    await page.evaluate(({ id, data }) => {
      ;(window as any).tangentAPI.terminal.write(id, data)
    }, { id: sessionId, data: longLine })
    await page.waitForTimeout(750)

    const columnBox = await requiredBox(terminalColumn, 'terminal column')
    const railBox = await requiredBox(agentRail, 'agent rail')

    expect(columnBox.width, 'terminal column should be meaningfully visible').toBeGreaterThan(200)
    expect(railBox.width, 'agent rail should retain its reserved width').toBeGreaterThanOrEqual(40)
    expect(rightEdge(columnBox), 'terminal column must end before the agent rail begins')
      .toBeLessThanOrEqual(railBox.x + TOLERANCE_PX)

    const terminalSurfaceSelectors = [
      ['xterm container', '.xterm:visible'],
      ['xterm screen', '.xterm:visible .xterm-screen'],
      ['xterm rows', '.xterm:visible .xterm-rows'],
      ['xterm viewport', '.xterm:visible .xterm-viewport']
    ] as const

    for (const [name, selector] of terminalSurfaceSelectors) {
      const box = await requiredBox(page.locator(selector).first(), name)
      expect(box.x, `${name} should not start left of the terminal column`).toBeGreaterThanOrEqual(columnBox.x - TOLERANCE_PX)
      expect(rightEdge(box), `${name} should not be wider than the terminal column`).toBeLessThanOrEqual(rightEdge(columnBox) + TOLERANCE_PX)
      expect(rightEdge(box), `${name} should not reach the agent rail`).toBeLessThanOrEqual(railBox.x + TOLERANCE_PX)
      expect(overlaps(box, railBox), `${name} must not overlap the right agent rail`).toBe(false)
    }
  })
})
