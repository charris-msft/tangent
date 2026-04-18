import { ipcMain, screen } from 'electron'
import type { WindowManager, PopoutBounds } from '../window/WindowManager'
import type { DisplayBounds } from '../../shared/tiling'

export function registerWindowHandlers(windowManager: WindowManager): void {
  ipcMain.handle('window:popOut', (_, sessionId: string, bounds?: PopoutBounds) => {
    try {
      const win = windowManager.popOut(sessionId, bounds)
      return !!win
    } catch (err) {
      console.error('[Tangent] window:popOut failed:', err)
      return false
    }
  })

  ipcMain.handle('window:setMainBounds', (_, bounds: PopoutBounds) => {
    try {
      return windowManager.setMainBounds(bounds)
    } catch (err) {
      console.error('[Tangent] window:setMainBounds failed:', err)
      return false
    }
  })

  ipcMain.handle('window:pullBack', (_, sessionId: string) => {
    windowManager.pullBack(sessionId)
  })

  ipcMain.handle('window:collapseAll', () => {
    windowManager.collapseAll()
  })

  ipcMain.handle('window:isPoppedOut', (_, sessionId: string) => {
    return windowManager.isPoppedOut(sessionId)
  })

  ipcMain.handle('window:getPoppedSessionIds', () => {
    return windowManager.getPoppedSessionIds()
  })

  ipcMain.handle('window:getDisplays', (): DisplayBounds[] => {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    return displays.map((d) => {
      const area = d.workArea
      return {
        id: d.id,
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        isPrimary: d.id === primaryId,
        label: d.label
      }
    })
  })

  windowManager.on('popped-out', (sessionId: string) => {
    windowManager.broadcast('window:popped-out', sessionId)
  })
  windowManager.on('pulled-back', (sessionId: string) => {
    windowManager.broadcast('window:pulled-back', sessionId)
  })
  windowManager.on('collapsed-all', () => {
    windowManager.broadcast('window:collapsed-all')
  })
}
