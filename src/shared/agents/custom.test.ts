import { describe, it, expect } from 'vitest'
import { parseCustomAgents, presetsFromCustomAgents, customIdFor } from './custom'

describe('custom agents', () => {
  it('degrades to empty on null/garbage; drops incomplete rows and dupes', () => {
    expect(parseCustomAgents(null)).toEqual([])
    expect(parseCustomAgents('nope')).toEqual([])
    const raw = JSON.stringify([
      { label: 'Grok', command: 'grok' },
      { label: '', command: 'x' },
      { label: 'NoCmd', command: '' },
      { id: 'custom-grok', label: 'dupe', command: 'y' }
    ])
    const agents = parseCustomAgents(raw)
    expect(agents).toEqual([{ id: 'custom-grok', label: 'Grok', command: 'grok' }])
  })

  it('materializes presets with whitespace arg-splitting', () => {
    const [p] = presetsFromCustomAgents([{ id: 'custom-grok', label: 'Grok', command: 'grok --model grok-4' }])
    expect(p).toMatchObject({ id: 'custom-grok', name: 'Grok', command: 'grok', args: ['--model', 'grok-4'] })
  })

  it('generates tmux-safe ids', () => {
    expect(customIdFor('My Wild Agent!!')).toBe('custom-my-wild-agent')
  })
})
