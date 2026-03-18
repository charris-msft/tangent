/**
 * SdkLineBuffer — Line-editing buffer for SDK sessions.
 *
 * Provides local echo and line editing so the terminal feels like a normal shell.
 * Pure logic layer: calls `onWrite` for terminal output and `onSubmit` when Enter is pressed.
 */
export class SdkLineBuffer {
  private line = ''
  private cursorPos = 0
  private history: string[] = []
  private historyIndex = -1     // -1 = not browsing history
  private savedLine = ''        // saves current input when browsing history

  constructor(
    private onWrite: (data: string) => void,
    private onSubmit: (line: string) => void
  ) {}

  /** Current line content (for testing). */
  getLine(): string {
    return this.line
  }

  /** Current cursor position (for testing). */
  getCursorPos(): number {
    return this.cursorPos
  }

  /** Load prompt history from the context store. */
  setHistory(prompts: string[]): void {
    this.history = prompts
  }

  /** Handle a keystroke from xterm.onData. Returns true if the event was consumed. */
  handleInput(data: string): boolean {
    // Enter — submit the line
    if (data === '\r' || data === '\n') {
      this.onWrite('\r\n')
      const prompt = this.line
      this.line = ''
      this.cursorPos = 0
      this.historyIndex = -1
      this.savedLine = ''
      if (prompt.trim().length > 0) {
        this.history.push(prompt)
        this.onSubmit(prompt)
      }
      return true
    }

    // Ctrl+C — clear current line
    if (data === '\x03') {
      if (this.line.length > 0) {
        this.onWrite('^C\r\n')
        this.line = ''
        this.cursorPos = 0
      }
      return true
    }

    // Backspace
    if (data === '\x7f' || data === '\b') {
      if (this.cursorPos > 0) {
        this.line = this.line.slice(0, this.cursorPos - 1) + this.line.slice(this.cursorPos)
        this.cursorPos--
        const tail = this.line.slice(this.cursorPos)
        this.onWrite('\b' + tail + ' ' + '\b'.repeat(tail.length + 1))
      }
      return true
    }

    // Arrow keys and Home/End (ANSI escape sequences)
    if (data.startsWith('\x1b[')) {
      const code = data.slice(2)
      if (code === 'D') {
        // Left arrow
        if (this.cursorPos > 0) {
          this.cursorPos--
          this.onWrite(data)
        }
        return true
      }
      if (code === 'C') {
        // Right arrow
        if (this.cursorPos < this.line.length) {
          this.cursorPos++
          this.onWrite(data)
        }
        return true
      }
      if (code === 'H' || code === '1~') {
        // Home
        if (this.cursorPos > 0) {
          this.onWrite(`\x1b[${this.cursorPos}D`)
          this.cursorPos = 0
        }
        return true
      }
      if (code === 'F' || code === '4~') {
        // End
        if (this.cursorPos < this.line.length) {
          this.onWrite(`\x1b[${this.line.length - this.cursorPos}C`)
          this.cursorPos = this.line.length
        }
        return true
      }
      if (code === '3~') {
        // Delete key
        if (this.cursorPos < this.line.length) {
          this.line = this.line.slice(0, this.cursorPos) + this.line.slice(this.cursorPos + 1)
          const tail = this.line.slice(this.cursorPos)
          this.onWrite(tail + ' ' + '\b'.repeat(tail.length + 1))
        }
        return true
      }
      // Up arrow — previous history entry
      if (code === 'A') {
        if (this.history.length === 0) return true
        if (this.historyIndex === -1) {
          // Save current input before browsing history
          this.savedLine = this.line
          this.historyIndex = this.history.length - 1
        } else if (this.historyIndex > 0) {
          this.historyIndex--
        } else {
          return true // Already at oldest entry
        }
        this.replaceLine(this.history[this.historyIndex])
        return true
      }
      // Down arrow — next history entry or restore saved input
      if (code === 'B') {
        if (this.historyIndex === -1) return true // Not browsing history
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++
          this.replaceLine(this.history[this.historyIndex])
        } else {
          // Restore saved input
          this.historyIndex = -1
          this.replaceLine(this.savedLine)
          this.savedLine = ''
        }
        return true
      }
      return true
    }

    // Regular printable characters
    if (data >= ' ') {
      if (this.cursorPos === this.line.length) {
        // Append at end
        this.line += data
        this.cursorPos += data.length
        this.onWrite(data)
      } else {
        // Insert in middle
        this.line = this.line.slice(0, this.cursorPos) + data + this.line.slice(this.cursorPos)
        this.cursorPos += data.length
        const tail = this.line.slice(this.cursorPos)
        this.onWrite(data + tail + '\b'.repeat(tail.length))
      }
      return true
    }

    return false
  }

  /** Insert a newline into the buffer (for Shift+Enter multiline input). */
  insertNewline(): void {
    this.line += '\n'
    this.cursorPos = this.line.length
    this.onWrite('\r\n')
  }

  /** Replace the current line content with new text (for history navigation). */
  private replaceLine(text: string): void {
    // Move cursor to start, clear the line, write new text
    if (this.cursorPos > 0) {
      this.onWrite(`\x1b[${this.cursorPos}D`)
    }
    // Clear from cursor to end of line
    this.onWrite('\x1b[K')
    this.line = text
    this.cursorPos = text.length
    this.onWrite(text)
  }
}
