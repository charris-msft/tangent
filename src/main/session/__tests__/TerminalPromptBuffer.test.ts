import { describe, expect, it } from 'vitest'
import { TerminalPromptBuffer } from '../TerminalPromptBuffer'

describe('TerminalPromptBuffer', () => {
  it('ignores cursor navigation and mouse tracking escape sequences', () => {
    const buffer = new TerminalPromptBuffer()

    expect(buffer.process('\x1b[A\x1b[C\x1b[?1006h\r')).toEqual([])
    expect(buffer.process('tell me about this project\x1b[D\x1b[C\r')).toEqual([
      'tell me about this project'
    ])
  })

  it('ignores known slash commands that are terminal UI controls, not tasks', () => {
    const buffer = new TerminalPromptBuffer()

    expect(buffer.process('/clear\r/tasks\r')).toEqual([])
  })

  it('handles split escape sequences across terminal writes', () => {
    const buffer = new TerminalPromptBuffer()

    expect(buffer.process('\x1b[')).toEqual([])
    expect(buffer.process('Awrite a useful summary\r')).toEqual(['write a useful summary'])
  })
})
