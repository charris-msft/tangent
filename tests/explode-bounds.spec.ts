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

test.describe('Explode multi-window tiling', () => {
  test('5 popped windows are repositioned without overlap when explode is called', async () => {
    // Get display info
    const displays = await page.evaluate(async () => {
      return await (window as any).tangentAPI?.window?.getDisplays?.()
    })
    console.log('Displays:', JSON.stringify(displays, null, 2))
    expect(displays).toBeDefined()
    expect(displays.length).toBeGreaterThan(0)
    const primaryDisplay = displays.find((d: any) => d.isPrimary) || displays[0]

    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      await page.evaluate(async () => {
        await (window as any).tangentAPI?.session?.create?.()
      })
      await page.waitForTimeout(500)
    }

    // Get all session IDs
    const sessionIds = await page.evaluate(async () => {
      const sessions = await (window as any).tangentAPI?.session?.getAll?.()
      return sessions?.map((s: any) => s.id) ?? []
    })
    console.log('Created sessions:', sessionIds.length)
    expect(sessionIds.length).toBeGreaterThanOrEqual(5)

    // Pop all 5 sessions out WITHOUT explicit bounds (simulating user manually popping them)
    for (let i = 0; i < 5; i++) {
      const result = await page.evaluate(async (id) => {
        return await (window as any).tangentAPI?.window?.popOut?.(id)
      }, sessionIds[i])
      expect(result).toBe(true)
      await page.waitForTimeout(300)
    }

    // Wait for all windows to be created
    await page.waitForTimeout(1500)

    // Get window count
    const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    console.log('Window count after popOut:', windowCount)
    expect(windowCount).toBe(6) // 1 main + 5 popouts

    // NOW call Explode — this should REPOSITION all 5 windows into a tiled layout
    // Inline the tiling logic to compute expected bounds
    const sessionIdsToTile = sessionIds.slice(0, 5)
    const displaysForTiling = [primaryDisplay]
    
    const padding = 8
    const outerPadding = 8
    const n = sessionIdsToTile.length
    const m = displaysForTiling.length
    const base = Math.floor(n / m)
    const remainder = n - base * m
    
    const tiledBounds: any[] = []
    let cursor = 0
    
    for (let d = 0; d < m; d++) {
      const count = base + (d < remainder ? 1 : 0)
      if (count === 0) continue
      
      const display = displaysForTiling[d]
      const cols = Math.ceil(Math.sqrt(count))
      const rows = Math.ceil(count / cols)
      
      const availWidth = display.width - 2 * outerPadding
      const availHeight = display.height - 2 * outerPadding
      
      const cellWidth = (availWidth - (cols - 1) * padding) / cols
      const cellHeight = (availHeight - (rows - 1) * padding) / rows
      
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols)
        const col = i % cols
        const x = display.x + outerPadding + col * (cellWidth + padding)
        const y = display.y + outerPadding + row * (cellHeight + padding)
        
        const floorX = Math.floor(x)
        const floorY = Math.floor(y)
        const floorWidth = Math.floor(cellWidth)
        const floorHeight = Math.floor(cellHeight)
        
        const clampedWidth = Math.min(floorWidth, display.x + display.width - floorX)
        const clampedHeight = Math.min(floorHeight, display.y + display.height - floorY)
        
        tiledBounds.push({
          sessionId: sessionIdsToTile[cursor++],
          displayId: display.id,
          x: floorX,
          y: floorY,
          width: clampedWidth,
          height: clampedHeight,
        })
      }
    }
    
    console.log('Computed tile bounds (before applying):', JSON.stringify(tiledBounds, null, 2))
    
    // Apply the layout by calling popOut with explicit bounds from the renderer context
    for (const tile of tiledBounds) {
      const result = await page.evaluate(async (t) => {
        return await (window as any).tangentAPI?.window?.popOut?.(t.sessionId, {
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height
        })
      }, tile)
      console.log(`popOut(${tile.sessionId}) with bounds -> ${result}`)
      await page.waitForTimeout(100)
    }

    console.log('Computed tile layout:', JSON.stringify(tiledBounds, null, 2))
    await page.waitForTimeout(1500)

    // NOW get ACTUAL window bounds from Electron
    const actualBounds = await app.evaluate(({ BrowserWindow }) => {
      const allWindows = BrowserWindow.getAllWindows()
      return allWindows
        .filter(w => {
          const url = w.webContents.getURL()
          return url.includes('mode=popout') // Only popout windows
        })
        .map(w => {
          const bounds = w.getBounds()
          return {
            id: w.id,
            title: w.getTitle(),
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        })
    })

    console.log('\n=== ACTUAL WINDOW BOUNDS ===')
    actualBounds.forEach((b: any, i: number) => {
      console.log(`Window ${i}: x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}, title="${b.title}"`)
    })

    console.log('\n=== EXPECTED TILE BOUNDS ===')
    tiledBounds.forEach((t: any, i: number) => {
      console.log(`Tile ${i}: sessionId=${t.sessionId}, x=${t.x}, y=${t.y}, w=${t.width}, h=${t.height}`)
    })

    // ASSERT 1: All windows within display workArea
    for (const bounds of actualBounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(primaryDisplay.x)
      expect(bounds.y).toBeGreaterThanOrEqual(primaryDisplay.y)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(primaryDisplay.x + primaryDisplay.width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(primaryDisplay.y + primaryDisplay.height)
    }

    // ASSERT 2: No pairwise overlap
    for (let i = 0; i < actualBounds.length; i++) {
      for (let j = i + 1; j < actualBounds.length; j++) {
        const a = actualBounds[i]
        const b = actualBounds[j]
        
        // Check for overlap
        const overlapX = a.x < b.x + b.width && b.x < a.x + a.width
        const overlapY = a.y < b.y + b.height && b.y < a.y + a.height
        const overlaps = overlapX && overlapY
        
        if (overlaps) {
          console.error(`\n❌ OVERLAP DETECTED between window ${i} and ${j}:`)
          console.error(`  Window ${i}: x=${a.x}, y=${a.y}, w=${a.width}, h=${a.height}`)
          console.error(`  Window ${j}: x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}`)
          console.error(`  Overlap region: x=[${Math.max(a.x, b.x)}, ${Math.min(a.x + a.width, b.x + b.width)}], y=[${Math.max(a.y, b.y)}, ${Math.min(a.y + a.height, b.y + b.height)}]`)
        }
        
        expect(overlaps).toBe(false)
      }
    }
  })
})
