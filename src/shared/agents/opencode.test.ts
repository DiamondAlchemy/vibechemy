import { describe, it, expect } from 'vitest'
import { parseOpencodeModels, presetsFromModels, opencodeIdFor, DEFAULT_OPENCODE_MODELS } from './opencode'

describe('opencode model roster', () => {
  it('falls back to defaults on null/garbage/empty', () => {
    expect(parseOpencodeModels(null)).toEqual(DEFAULT_OPENCODE_MODELS)
    expect(parseOpencodeModels('not json')).toEqual(DEFAULT_OPENCODE_MODELS)
    expect(parseOpencodeModels('[]')).toEqual(DEFAULT_OPENCODE_MODELS)
    expect(parseOpencodeModels('[{"label":"","model":""}]')).toEqual(DEFAULT_OPENCODE_MODELS)
  })

  it('keeps stable ids, generates safe ids for new labels, drops dupes', () => {
    const raw = JSON.stringify([
      { id: 'opencode-glm', label: 'GLM', model: 'zai-coding-plan/glm-5.2' },
      { label: 'Kimi K3!', model: 'moonshot/kimi-k3' },
      { id: 'opencode-glm', label: 'dupe', model: 'x/y' },
      { id: 'BAD ID', label: 'Weird', model: 'a/b' }
    ])
    const models = parseOpencodeModels(raw)
    expect(models.map((m) => m.id)).toEqual(['opencode-glm', 'opencode-kimi-k3', 'opencode-weird'])
  })

  it('materializes presets in the exact historical seed shape', () => {
    const [glm] = presetsFromModels(DEFAULT_OPENCODE_MODELS)
    expect(glm).toEqual({
      id: 'opencode-glm',
      name: 'OpenCode · GLM',
      command: 'opencode',
      args: ['-m', 'zai-coding-plan/glm-5.2'],
      env: {},
      isSeed: true,
      color: '#7c5cff'
    })
  })

  it('id slugs are tmux-safe', () => {
    expect(opencodeIdFor('Ünïcode Model++')).toMatch(/^opencode-[a-z0-9-]+$/)
  })
})
