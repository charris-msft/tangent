import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { join } from 'path'
import { existsSync } from 'fs'

export interface PopoutBounds {
  x?: number
  y?: number
  width: number
  height: number
}

const DEFAULT_POPOUT_WIDTH = 800
const DEFAULT_POPOUT_HEIGHT = 600

/**
 * WindowManager — owns the main BrowserWindow and any popout windows
 * created for individual sessions. Provides routing helpers so other
 * modules can broadcast IPC events to the right set of windows.
 *
 * Events:
 *  - 'popped-out'   (sessionId: string)
 *  - 'pulled-back'  (sessionId: string)
 *  - 'collapsed-all'
 */
export class WindowManager extends EventEmitter {
  private mainWindow: BrowserWindow | null = null
  private popouts: Map<string, BrowserWindow> = new Map()

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
    win.on('closed', () => {
      if (this.mainWindow === win) {
        this.mainWindow = null
      }
    })
  }

  getMainWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow
    }
    return null
  }

  isPoppedOut(sessionId: string): boolean {
    const win = this.popouts.get(sessionId)
    return !!(win && !win.isDestroyed())
  }

  getPoppedSessionIds(): string[] {
    const ids: string[] = []
    for (const [id, win] of this.popouts) {
      if (!win.isDestroyed()) ids.push(id)
    }
    return ids
  }

  /**
   * Create a popout BrowserWindow for the given session. If one already
   * exists for the session, it is repositioned (if bounds provided) and focused.
   */
  popOut(sessionId: string, bounds?: PopoutBounds): BrowserWindow {
    const existing = this.popouts.get(sessionId)
    if (existing && !existing.isDestroyed()) {
      try {
        if (existing.isMinimized()) existing.restore()
        // If explicit bounds provided, reposition the window (for Explode tiling)
        if (bounds) {
          existing.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          })
        }
        existing.focus()
      } catch (err) {
        console.error('[WindowManager] Failed to focus/reposition existing popout:', err)
      }
      return existing
    }

    const main = this.getMainWindow()
    const preloadPath = join(__dirname, '../preload/index.js')
    const iconPath = join(__dirname, '../../assets/tangent.ico')

    const win = new BrowserWindow({
      title: 'Tangent 2',
      x: bounds?.x,
      y: bounds?.y,
      width: bounds?.width ?? DEFAULT_POPOUT_WIDTH,
      height: bounds?.height ?? DEFAULT_POPOUT_HEIGHT,
      minWidth: 400,
      minHeight: 300,
      backgroundColor: '#0d1117',
      autoHideMenuBar: true,
      icon: existsSync(iconPath) ? iconPath : undefined,
      parent: main ?? undefined,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    this.popouts.set(sessionId, win)

    const encoded = encodeURIComponent(sessionId)
    const query = `mode=popout&sessionId=${encoded}`

    try {
      if (process.env.ELECTRON_RENDERER_URL) {
        const base = process.env.ELECTRON_RENDERER_URL
        const sep = base.includes('?') ? '&' : '?'
        win.loadURL(`${base}${sep}${query}`)
      } else {
        const htmlPath = join(__dirname, '../renderer/index.html')
        win.loadFile(htmlPath, { search: query })
      }
    } catch (err) {
      console.error('[WindowManager] Failed to load popout URL:', err)
    }

    win.on('closed', () => {
      const tracked = this.popouts.get(sessionId)
      if (tracked === win) {
        this.popouts.delete(sessionId)
        this.emit('pulled-back', sessionId)
      }
    })

    this.emit('popped-out', sessionId)
    return win
  }

  /**
   * Close the popout for a session (if any). Idempotent.
   */
  pullBack(sessionId: string): void {
    const win = this.popouts.get(sessionId)
    if (!win) return
    this.popouts.delete(sessionId)
    try {
      if (!win.isDestroyed()) {
        win.close()
      }
    } catch (err) {
      console.error('[WindowManager] Failed to close popout:', err)
    }
    this.emit('pulled-back', sessionId)
  }

  /**
   * Close all popouts and focus the main window.
   */
  collapseAll(): void {
    const ids = this.getPoppedSessionIds()
    for (const id of ids) {
      const win = this.popouts.get(id)
      this.popouts.delete(id)
      if (win && !win.isDestroyed()) {
        try {
          win.close()
        } catch (err) {
          console.error('[WindowManager] Failed to close popout during collapseAll:', err)
        }
      }
      this.emit('pulled-back', id)
    }

    const main = this.getMainWindow()
    if (main) {
      try {
        if (main.isMinimized()) main.restore()
        main.focus()
      } catch (err) {
        console.error('[WindowManager] Failed to focus main window:', err)
      }
    }

    this.emit('collapsed-all')
  }

  /**
   * Send an IPC event to the main window and every popout window.
   */
  broadcast(channel: string, ...args: unknown[]): void {
    const main = this.getMainWindow()
    if (main) {
      try {
        main.webContents.send(channel, ...args)
      } catch (err) {
        console.error('[WindowManager] broadcast to main failed:', err)
      }
    }
    for (const [id, win] of this.popouts) {
      if (win.isDestroyed()) {
        this.popouts.delete(id)
        continue
      }
      try {
        win.webContents.send(channel, ...args)
      } catch (err) {
        console.error('[WindowManager] broadcast to popout failed:', err)
      }
    }
  }

  /**
   * Send an IPC event to the main window AND the popout window for the
   * given session (if it is currently popped out).
   */
  sendToSession(sessionId: string, channel: string, ...args: unknown[]): void {
    const main = this.getMainWindow()
    if (main) {
      try {
        main.webContents.send(channel, ...args)
      } catch (err) {
        console.error('[WindowManager] sendToSession (main) failed:', err)
      }
    }
    const popout = this.popouts.get(sessionId)
    if (popout && !popout.isDestroyed()) {
      try {
        popout.webContents.send(channel, ...args)
      } catch (err) {
        console.error('[WindowManager] sendToSession (popout) failed:', err)
      }
    }
  }

  /**
   * Send an IPC event only to the main window.
   */
  sendToMain(channel: string, ...args: unknown[]): void {
    const main = this.getMainWindow()
    if (!main) return
    try {
      main.webContents.send(channel, ...args)
    } catch (err) {
      console.error('[WindowManager] sendToMain failed:', err)
    }
  }
}
