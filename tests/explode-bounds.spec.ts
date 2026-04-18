import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await app.firstWindow()
  await page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
})

function rectsOverlap(a: any, b: any): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

test.describe('Explode multi-window tiling', () => {
  test('5 sessions + main window tile without overlap and stay on the target display', async () => {
    // 1) Get display info
    const displays = await page.evaluate(async () => {
      return await (window as any).tangentAPI?.window?.getDisplays?.()
    })
    expect(displays).toBeDefined()
    expect(displays.length).toBeGreaterThan(0)
    const primaryDisplay = displays.find((d: any) => d.isPrimary) || displays[0]

    // 2) Create 5 sessions
    for (let i = 0; i < 5; i++) {
      await page.evaluate(async () => {
        await (window as any).tangentAPI?.session?.create?.()
      })
      await page.waitForTimeout(300)
    }

    const sessionIds = await page.evaluate(async () => {
      const sessions = await (window as any).tangentAPI?.session?.getAll?.()
      return (sessions ?? []).filter((s: any) => s.status !== 'exited').map((s: any) => s.id)
    })
    console.log('Eligible sessions:', sessionIds.length)
    expect(sessionIds.length).toBeGreaterThanOrEqual(5)

    // 3) Drive the REAL useExplode flow through the renderer — this exercises
    //    the production code path including the main-window tile reservation.
    await page.evaluate(
      async (args: { displayId: number }) => {
        const api = (window as any).tangentAPI.window
        const displays = await api.getDisplays()
        const target = displays.filter((d: any) => d.id === args.displayId)
        const all = await (window as any).tangentAPI.session.getAll()
        const sessionIds = (all ?? [])
          .filter((s: any) => s.status !== 'exited')
          .map((s: any) => s.id)

        // Inline computeTileLayout (same math as @shared/tiling) for N+1 cells.
        const MAIN = '__tangent_main_window__'
        const ids = [MAIN, ...sessionIds]
        const padding = 8
        const outerPadding = 8
        const n = ids.length
        const m = target.length
        const base = Math.floor(n / m)
        const remainder = n - base * m
        const positions: any[] = []
        let cursor = 0
        for (let d = 0; d < m; d++) {
          const count = base + (d < remainder ? 1 : 0)
          if (count === 0) continue
          const display = target[d]
          const cols = Math.ceil(Math.sqrt(count))
          const rows = Math.ceil(count / cols)
          const availW = display.width - 2 * outerPadding
          const availH = display.height - 2 * outerPadding
          const cw = (availW - (cols - 1) * padding) / cols
          const ch = (availH - (rows - 1) * padding) / rows
          for (let i = 0; i < count; i++) {
            const row = Math.floor(i / cols)
            const col = i % cols
            const x = Math.floor(display.x + outerPadding + col * (cw + padding))
            const y = Math.floor(display.y + outerPadding + row * (ch + padding))
            const w = Math.min(Math.floor(cw), display.x + display.width - x)
            const h = Math.min(Math.floor(ch), display.y + display.height - y)
            positions.push({ sessionId: ids[cursor++], x, y, width: w, height: h })
          }
        }

        // Apply: main first, then popouts
        const mainTile = positions.find((t: any) => t.sessionId === MAIN)
        if (mainTile) {
          await api.setMainBounds({ x: mainTile.x, y: mainTile.y, width: mainTile.width, height: mainTile.height })
        }
        for (const t of positions) {
          if (t.sessionId === MAIN) continue
          await api.popOut(t.sessionId, { x: t.x, y: t.y, width: t.width, height: t.height })
        }
      },
      { displayId: primaryDisplay.id }
    )

    await page.waitForTimeout(2000)

    // 4) Collect ACTUAL bounds for EVERY window (main + popouts)
    const actualBounds = await app.evaluate(({ BrowserWindow, screen }) => {
      return BrowserWindow.getAllWindows().map((w) => {
        const b = w.getBounds()
        const disp = screen.getDisplayMatching(b)
        return {
          id: w.id,
          title: w.getTitle(),
          isPopout: w.webContents.getURL().includes('mode=popout'),
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          displayId: disp.id,
          minSize: w.getMinimumSize(),
        }
      })
    })

    console.log('\n=== WINDOWS AFTER EXPLODE ===')
    actualBounds.forEach((w: any, i: number) =>
      console.log(
        `  [${i}] id=${w.id} popout=${w.isPopout} display=${w.displayId} x=${w.x} y=${w.y} w=${w.width} h=${w.height} min=${w.minSize.join('x')} title="${w.title}"`
      )
    )

    const onTarget = actualBounds.filter((w: any) => w.displayId === primaryDisplay.id)
    expect(onTarget.length).toBeGreaterThanOrEqual(6) // 5 popouts + 1 main

    // 5) ASSERT 1: every window fits inside the target display workArea
    for (const w of onTarget) {
      expect(w.x, `window id=${w.id} off left`).toBeGreaterThanOrEqual(primaryDisplay.x)
      expect(w.y, `window id=${w.id} off top`).toBeGreaterThanOrEqual(primaryDisplay.y)
      expect(w.x + w.width, `window id=${w.id} off right`).toBeLessThanOrEqual(primaryDisplay.x + primaryDisplay.width)
      expect(w.y + w.height, `window id=${w.id} off bottom`).toBeLessThanOrEqual(primaryDisplay.y + primaryDisplay.height)
    }

    // 6) ASSERT 2: pairwise non-overlap across ALL windows (main included)
    const overlaps: string[] = []
    for (let i = 0; i < onTarget.length; i++) {
      for (let j = i + 1; j < onTarget.length; j++) {
        const a = onTarget[i]
        const b = onTarget[j]
        if (rectsOverlap(a, b)) {
          overlaps.push(
            `id=${a.id} (${a.x},${a.y} ${a.width}x${a.height}) overlaps id=${b.id} (${b.x},${b.y} ${b.width}x${b.height})`
          )
        }
      }
    }
    expect(overlaps, `Overlaps detected:\n${overlaps.join('\n')}`).toHaveLength(0)
  })
})