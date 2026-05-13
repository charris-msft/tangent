import * as pty from 'node-pty'
import { EventEmitter } from 'events'

export interface PtyInstance {
  id: string
  process: pty.IPty
}

export class PtyManager extends EventEmitter {
  private instances = new Map<string, pty.IPty>()

  spawn(id: string, cwd: string): pty.IPty {
    const shell = 'pwsh.exe'
    // Advertise hyperlink support so CLIs emit clickable OSC 8 links instead of
    // falling back to "text (url)" duplicates. xterm.js natively renders OSC 8.
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM_PROGRAM: process.env.TERM_PROGRAM || 'Tangent',
      FORCE_HYPERLINK: '1',
      COLORTERM: process.env.COLORTERM || 'truecolor'
    }
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd,
      env
    })

    this.instances.set(id, proc)

    proc.onData((data) => {
      this.emit('data', id, data)
    })

    proc.onExit(({ exitCode }) => {
      this.instances.delete(id)
      this.emit('exit', id, exitCode)
    })

    return proc
  }

  write(id: string, data: string): void {
    this.instances.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.instances.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    const proc = this.instances.get(id)
    if (proc) {
      proc.kill()
      this.instances.delete(id)
    }
  }

  get(id: string): pty.IPty | undefined {
    return this.instances.get(id)
  }

  dispose(): void {
    for (const [, proc] of this.instances) {
      proc.kill()
    }
    this.instances.clear()
  }
}
