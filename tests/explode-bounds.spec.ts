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
  test('main window is NOT moved; popouts tile around it without overlap', async () => {
    // 1) Capture main window bounds BEFORE explode
    const mainBefore = await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(
        (w) => !w.webContents.getURL().includes('mode=popout')
      )
      if (!main) return null
      const b = main.getBounds()
      return { id: main.id, x: b.x, y: b.y, width: b.width, height: b.height }
    })
    expect(mainBefore).toBeTruthy()

    // 2) Target display info (workArea)
    const displays = await page.evaluate(async () => {
      return await (window as any).tangentAPI?.window?.getDisplays?.()
    })
    expect(displays.length).toBeGreaterThan(0)
    const primaryDisplay = displays.find((d: any) => d.isPrimary) || displays[0]

    // 3) Create 5 sessions
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
    expect(sessionIds.length).toBeGreaterThanOrEqual(5)

    // 4) Drive the REAL useExplode flow: compute layout with main bounds as
    //    exclusion, pop out each session. (Mirrors useExplode.ts logic so the
    //    test exercises production IPC.)
    await page.evaluate(
      async (args: { displayId: number }) => {
        const api = (window as any).tangentAPI.window
        const allDisplays = await api.getDisplays()
        const target = allDisplays.filter((d: any) => d.id === args.displayId)
        const all = await (window as any).tangentAPI.session.getAll()
        const sessionIds = (all ?? [])
          .filter((s: any) => s.status !== 'exited')
          .map((s: any) => s.id)

        // Fetch main bounds; use as exclusion if on target display.
        const mb = await api.getMainBounds()
        let exclusions: any[] = []
        if (mb) {
          const host = target.find((d: any) => {
            const cx = mb.x + mb.width / 2
            const cy = mb.y + mb.height / 2
            return cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height
          })
          if (host) exclusions = [{ displayId: host.id, ...mb }]
        }

        // Inline computeTileLayout with exclusion support
        function rectsOverlap(a: any, b: any) {
          return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        }
        function generateCells(totalCells: number, display: any, pad: number, outer: number) {
          const cols = Math.ceil(Math.sqrt(totalCells))
          const rows = Math.ceil(totalCells / cols)
          const aW = display.width - 2 * outer
          const aH = display.height - 2 * outer
          const cW = (aW - (cols - 1) * pad) / cols
          const cH = (aH - (rows - 1) * pad) / rows
          const out: any[] = []
          for (let i = 0; i < totalCells; i++) {
            const row = Math.floor(i / cols)
            const col = i % cols
            const x = Math.floor(display.x + outer + col * (cW + pad))
            const y = Math.floor(display.y + outer + row * (cH + pad))
            const w = Math.min(Math.floor(cW), display.x + display.width - x)
            const h = Math.min(Math.floor(cH), display.y + display.height - y)
            out.push({ x, y, width: w, height: h })
          }
          return out
        }

        const padding = 8
        const outerPadding = 8
        const n = sessionIds.length
        const m = target.length
        const base = Math.floor(n / m)
        const remainder = n - base * m
        const positions: any[] = []
        let cursor = 0
        for (let d = 0; d < m; d++) {
          const count = base + (d < remainder ? 1 : 0)
          if (count === 0) continue
          const display = target[d]
          const myEx = exclusions.filter((e: any) => e.displayId === display.id)
          let totalCells = count
          let usable: any[] = []
          for (let attempt = 0; attempt < 8; attempt++) {
            const cells = generateCells(totalCells, display, padding, outerPadding)
            usable = myEx.length === 0 ? cells : cells.filter((c: any) => !myEx.some((ex: any) => rectsOverlap(c, ex)))
            if (usable.length >= count) break
            totalCells = totalCells + (count - usable.length) + 1
          }
          for (let i = 0; i < count && i < usable.length; i++) {
            positions.push({ sessionId: sessionIds[cursor++], ...usable[i] })
          }
        }

        for (const t of positions) {
          await api.popOut(t.sessionId, { x: t.x, y: t.y, width: t.width, height: t.height })
        }
      },
      { displayId: primaryDisplay.id }
    )

    await page.waitForTimeout(2000)

    // 5) Collect ACTUAL bounds for EVERY window (main + popouts) — no filtering
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

    // 6) ASSERT 1: main window bounds UNCHANGED
    const mainAfter = actualBounds.find((w: any) => !w.isPopout)
    expect(mainAfter, 'main window must still exist').toBeTruthy()
    expect(mainAfter!.id).toBe(mainBefore!.id)
    expect(mainAfter!.x).toBe(mainBefore!.x)
    expect(mainAfter!.y).toBe(mainBefore!.y)
    expect(mainAfter!.width).toBe(mainBefore!.width)
    expect(mainAfter!.height).toBe(mainBefore!.height)

    const popouts = actualBounds.filter((w: any) => w.isPopout && w.displayId === primaryDisplay.id)
    expect(popouts.length).toBeGreaterThanOrEqual(5)

    // 7) ASSERT 2: every popout fits inside the target display workArea
    for (const w of popouts) {
      expect(w.x, `popout id=${w.id} off left`).toBeGreaterThanOrEqual(primaryDisplay.x)
      expect(w.y, `popout id=${w.id} off top`).toBeGreaterThanOrEqual(primaryDisplay.y)
      expect(w.x + w.width, `popout id=${w.id} off right`).toBeLessThanOrEqual(primaryDisplay.x + primaryDisplay.width)
      expect(w.y + w.height, `popout id=${w.id} off bottom`).toBeLessThanOrEqual(primaryDisplay.y + primaryDisplay.height)
    }

    // 8) ASSERT 3: pairwise non-overlap across ALL windows (main included).
    //    Skip only when main is on a different display than the popouts.
    const onTarget = actualBounds.filter((w: any) => w.displayId === primaryDisplay.id)
    const overlaps: string[] = []
    for (let i = 0; i < onTarget.length; i++) {
      for (let j = i + 1; j < onTarget.length; j++) {
        const a = onTarget[i]
        const b = onTarget[j]
        if (rectsOverlap(a, b)) {
          overlaps.push(
            `id=${a.id} popout=${a.isPopout} (${a.x},${a.y} ${a.width}x${a.height}) overlaps id=${b.id} popout=${b.isPopout} (${b.x},${b.y} ${b.width}x${b.height})`
          )
        }
      }
    }
    expect(overlaps, `Overlaps detected:\n${overlaps.join('\n')}`).toHaveLength(0)
  })
})
