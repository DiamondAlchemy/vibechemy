import { describe, it, expect } from 'vitest'
import { PresetRegistry } from './PresetRegistry'
import type { Preset } from '@shared/types'
import { PERSONAL_AGENT_PRESET_ID } from '@shared/agents/personalAgent'

const presets: Preset[] = [
  { id: 'shell', name: 'Shell', command: 'zsh', args: [], env: {} },
  { id: 'claude-opus', name: 'Claude', command: 'claude', args: ['--model', 'opus'], env: {} },
  {
    id: 'oc-glm',
    name: 'OpenCode GLM',
    command: 'opencode',
    args: ['-m', 'zai/glm-4.6'],
    env: { OPENCODE_THEME: 'dark mode' } // value with a space → must be quoted
  }
]

describe('PresetRegistry', () => {
  const reg = PresetRegistry.from(presets)

  it('lists and gets presets and exposes id set', () => {
    expect(reg.list()).toHaveLength(3)
    expect(reg.get('claude-opus')?.command).toBe('claude')
    expect(reg.ids().has('oc-glm')).toBe(true)
  })

  it('builds a plain launch command with no env', () => {
    const p = reg.get('claude-opus')!
    expect(reg.buildLaunchCommand(p)).toBe('claude --model opus')
  })

  it('prefixes env and shell-quotes values containing spaces', () => {
    const p = reg.get('oc-glm')!
    expect(reg.buildLaunchCommand(p)).toBe("env OPENCODE_THEME='dark mode' opencode -m zai/glm-4.6")
  })
})

describe('PresetRegistry.resolve (forgiving spawn-id resolution)', () => {
  const reg = PresetRegistry.from([
    { id: 'shell', name: 'Shell', command: 'zsh', args: [], env: {} },
    { id: 'claude-opus', name: 'Claude', command: 'claude', args: [], env: {} },
    { id: 'codex', name: 'Codex', command: 'codex', args: [], env: {} },
    { id: 'opencode-glm', name: 'GLM', command: 'opencode', args: [], env: {} },
    { id: 'opencode-minimax', name: 'MiniMax', command: 'opencode', args: [], env: {} },
    {
      id: PERSONAL_AGENT_PRESET_ID,
      name: 'Personal Agent',
      command: 'custom-pa',
      args: [],
      env: {},
      isOrchestrator: true
    }
  ])

  it('returns the exact preset when the id matches', () => {
    expect(reg.resolve('claude-opus').id).toBe('claude-opus')
    expect(reg.resolve('codex').id).toBe('codex')
  })

  it('resolves a unique case-insensitive substring (claude → claude-opus, GLM → opencode-glm)', () => {
    expect(reg.resolve('claude').id).toBe('claude-opus')
    expect(reg.resolve('GLM').id).toBe('opencode-glm')
    expect(reg.resolve('minimax').id).toBe('opencode-minimax')
    expect(reg.resolve('opus').id).toBe('claude-opus')
  })

  it('throws a listing error on an unknown id', () => {
    expect(() => reg.resolve('gpt5')).toThrow(/Unknown preset.*Available presets/)
  })

  it('throws on an ambiguous match (opencode → glm + minimax)', () => {
    expect(() => reg.resolve('opencode')).toThrow(/Ambiguous/)
  })

  it('excludes orchestrator leads from fuzzy resolution + spawnable(), but exact ids still resolve', () => {
    expect(reg.spawnable().map((p) => p.id)).not.toContain(PERSONAL_AGENT_PRESET_ID)
    expect(() => reg.resolve('personal')).toThrow(/Unknown preset/) // fuzzy never reaches an orchestrator
    expect(reg.resolve(PERSONAL_AGENT_PRESET_ID).id).toBe(PERSONAL_AGENT_PRESET_ID)
  })
})

describe('PresetRegistry personal-agent registration', () => {
  const reg = PresetRegistry.from([
    {
      id: PERSONAL_AGENT_PRESET_ID,
      name: 'Personal Agent',
      command: 'custom-pa',
      args: ['chat'],
      env: {},
      isOrchestrator: true
    }
  ])

  it('resolves the configured personal-agent preset by its canonical id', () => {
    expect(reg.get(PERSONAL_AGENT_PRESET_ID)?.id).toBe(PERSONAL_AGENT_PRESET_ID)
    expect(reg.resolve(PERSONAL_AGENT_PRESET_ID).id).toBe(PERSONAL_AGENT_PRESET_ID)
  })

  it('includes the canonical id in validation without adding a duplicate chip', () => {
    expect(reg.validationIds().has(PERSONAL_AGENT_PRESET_ID)).toBe(true)
    expect(reg.list().map((preset) => preset.id)).toEqual([PERSONAL_AGENT_PRESET_ID])
  })
})
