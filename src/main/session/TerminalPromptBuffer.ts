const IGNORED_SLASH_COMMANDS = new Set(['/clear', '/tasks', '/help'])

type EscapeMode = 'normal' | 'escape' | 'csi' | 'osc' | 'osc-escape'

export class TerminalPromptBuffer {
  private buffer = ''
  private escapeMode: EscapeMode = 'normal'

  process(data: string): string[] {
    const prompts: string[] = []

    for (const ch of data) {
      if (this.escapeMode !== 'normal') {
        this.consumeEscape(ch)
        continue
      }

      if (ch === '\x1b') {
        this.escapeMode = 'escape'
        continue
      }

      if (ch === '\r' || ch === '\n') {
        const prompt = this.cleanPrompt(this.buffer)
        if (prompt) prompts.push(prompt)
        this.buffer = ''
        continue
      }

      if (ch === '\x7f' || ch === '\b') {
        this.buffer = this.buffer.slice(0, -1)
        continue
      }

      if (ch.charCodeAt(0) >= 32) {
        this.buffer += ch
      }
    }

    return prompts
  }

  private consumeEscape(ch: string): void {
    switch (this.escapeMode) {
      case 'escape':
        if (ch === '[') {
          this.escapeMode = 'csi'
        } else if (ch === ']') {
          this.escapeMode = 'osc'
        } else {
          this.escapeMode = 'normal'
        }
        return

      case 'csi':
        if (ch.charCodeAt(0) >= 0x40 && ch.charCodeAt(0) <= 0x7e) {
          this.escapeMode = 'normal'
        }
        return

      case 'osc':
        if (ch === '\x07') {
          this.escapeMode = 'normal'
        } else if (ch === '\x1b') {
          this.escapeMode = 'osc-escape'
        }
        return

      case 'osc-escape':
        this.escapeMode = ch === '\\' ? 'normal' : 'osc'
        return

      default:
        this.escapeMode = 'normal'
    }
  }

  private cleanPrompt(text: string): string | null {
    const prompt = text
      .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!prompt) return null
    if (IGNORED_SLASH_COMMANDS.has(prompt.toLowerCase())) return null
    if (!/[a-zA-Z]/.test(prompt) && prompt.length < 4) return null

    return prompt
  }
}
