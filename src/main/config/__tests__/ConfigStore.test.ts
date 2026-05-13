import { describe, it, expect } from 'vitest'
import { parseConfig } from '../ConfigStore'

describe('parseConfig', () => {
  it('extracts known fields with correct types', () => {
    const { known, extra } = parseConfig({
      startFolder: '/home/user',
      editor: 'vim',
      fontSize: 14
    })
    expect(known).toEqual({ startFolder: '/home/user', editor: 'vim', fontSize: 14 })
    expect(extra).toEqual({})
  })

  it('puts unrecognized fields into extra', () => {
    const { known, extra } = parseConfig({
      editor: 'code',
      newFeatureFlag: true,
      experimentalLayout: 'split'
    })
    expect(known).toEqual({ editor: 'code' })
    expect(extra).toEqual({ newFeatureFlag: true, experimentalLayout: 'split' })
  })

  it('ignores known keys with wrong types', () => {
    const { known, extra } = parseConfig({
      fontSize: 'big',
      editor: 42,
      startFolder: true
    })
    expect(known).toEqual({})
    expect(extra).toEqual({})
  })

  it('accepts null/undefined values for known keys', () => {
    const { known } = parseConfig({
      editor: null,
      startFolder: undefined
    })
    expect(known).toEqual({ editor: null, startFolder: undefined })
  })

  it('handles empty object', () => {
    const { known, extra } = parseConfig({})
    expect(known).toEqual({})
    expect(extra).toEqual({})
  })

  it('preserves complex unknown values', () => {
    const nested = { theme: { primary: '#fff', secondary: '#000' }, plugins: ['a', 'b'] }
    const { known, extra } = parseConfig(nested)
    expect(known).toEqual({})
    expect(extra).toEqual(nested)
  })

  it('separates known and unknown fields correctly in mixed input', () => {
    const { known, extra } = parseConfig({
      editor: 'code',
      fontSize: 16,
      defaultAgentCommand: 'copilot',
      defaultAgentArgs: '--verbose',
      futureOption: 'yes',
      anotherNewThing: 99
    })
    expect(known).toEqual({
      editor: 'code',
      fontSize: 16,
      defaultAgentCommand: 'copilot',
      defaultAgentArgs: '--verbose'
    })
    expect(extra).toEqual({ futureOption: 'yes', anotherNewThing: 99 })
  })
})
