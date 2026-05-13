import { describe, expect, it, vi } from 'vitest'
import { TaskTimelineStore } from '../TaskTimelineStore'

describe('TaskTimelineStore', () => {
  it('records prompts newest-first and emits add/update events', () => {
    const store = new TaskTimelineStore()
    const onAdded = vi.fn()
    const onUpdated = vi.fn()
    store.on('item-added', onAdded)
    store.on('item-updated', onUpdated)

    const first = store.recordPrompt('s1', 'first prompt', 'terminal', 'copilot-cli')
    const second = store.recordPrompt('s1', 'second prompt', 'terminal', 'copilot-cli')

    expect(onAdded).toHaveBeenCalledTimes(2)
    expect(onAdded).toHaveBeenNthCalledWith(1, first)
    expect(onAdded).toHaveBeenNthCalledWith(2, second)
    expect(store.getTimeline('s1').map(item => item.promptText)).toEqual([
      'second prompt',
      'first prompt'
    ])

    store.appendOutput('s1', '\x1b[32mDone with second prompt\x1b[0m\r\n')
    const completed = store.completeLatest('s1', 'success')

    expect(completed?.status).toBe('success')
    expect(completed?.responseSummary).toBe('Done with second prompt')
    expect(completed?.fullResponse).toBe('Done with second prompt\n')
    expect(onUpdated).toHaveBeenCalledWith(completed)
  })

  it('fails in-progress items and clears session state', () => {
    const store = new TaskTimelineStore()

    store.recordPrompt('s1', 'unfinished prompt', 'terminal', 'copilot-cli')
    store.failInProgress('s1', 'Session exited')

    const failed = store.getTimeline('s1')[0]
    expect(failed.status).toBe('error')
    expect(failed.errorMessage).toBe('Session exited')
    expect(failed.interrupted).toBe(true)

    store.clearSession('s1')
    expect(store.getTimeline('s1')).toEqual([])
  })

  it('keeps full responses bounded while preserving a useful summary', () => {
    const store = new TaskTimelineStore()
    const longResponse = `Meaningful result\n${'x'.repeat(20 * 1024)}`

    store.recordPrompt('s1', 'long prompt', 'terminal', 'copilot-cli')
    store.appendOutput('s1', longResponse)
    const completed = store.completeLatest('s1', 'success')

    expect(completed?.responseSummary).toBe('Meaningful result')
    expect(completed?.fullResponse?.length).toBeLessThanOrEqual(10 * 1024)
  })

  it('strips complex terminal controls from prompts and responses', () => {
    const store = new TaskTimelineStore()

    store.recordPrompt('s1', '\x1b[?1006h\x1b[A summarize this \x1b[?1006l', 'terminal', 'copilot-cli')
    store.appendOutput(
      's1',
      '\x1b]0;title\x07\x1b[1;32;1mSuccess\x1b[0m\x1b[K\r\n\x1b[?1002hDetails are clean\x1b[?1002l'
    )
    const completed = store.completeLatest('s1', 'success')

    expect(completed?.promptText).toBe('summarize this')
    expect(completed?.responseSummary).toBe('Details are clean')
    expect(completed?.fullResponse).toContain('Success')
    expect(completed?.fullResponse).toContain('Details are clean')
    expect(completed?.fullResponse).not.toContain('\x1b')
    expect(completed?.fullResponse).not.toContain('?1002')
  })

  it('updates in-progress items with a live sanitized response preview', () => {
    const store = new TaskTimelineStore()
    const onUpdated = vi.fn()
    store.on('item-updated', onUpdated)

    store.recordPrompt('s1', 'show progress', 'terminal', 'copilot-cli')
    store.appendOutput('s1', '\x1b[32mWorking on the answer\x1b[0m\r\n')

    const item = store.getTimeline('s1')[0]
    expect(item.status).toBe('in-progress')
    expect(item.responseSummary).toBe('Working on the answer')
    expect(item.fullResponse).toBe('Working on the answer\n')
    expect(onUpdated).toHaveBeenCalledWith(item)
  })
})
