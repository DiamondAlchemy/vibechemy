import { describe, it, expect } from 'vitest'
import { applyConfigAction, agentConfigSnapshot } from './configOps'
import { OPENCODE_MODELS_KEY } from './opencode'
import { CUSTOM_AGENTS_KEY } from './custom'
import { PROFILES_KEY } from './profiles'

const store = (init: Record<string, string> = {}): { read: (k: string) => string | null; map: Map<string, string> } => {
  const map = new Map(Object.entries(init))
  return { read: (k) => map.get(k) ?? null, map }
}

describe('applyConfigAction', () => {
  it('set_model writes the model and/or effort keys', () => {
    const { read } = store()
    const r = applyConfigAction(read, { action: 'set_model', family: 'codex', role: 'lead', model: 'gpt-5.6-sol', effort: 'ultra' })
    expect(r.writes).toEqual([
      { key: 'agent.model.codex.lead', value: 'gpt-5.6-sol' },
      { key: 'agent.effort.codex.lead', value: 'ultra' }
    ])
    expect(() => applyConfigAction(read, { action: 'set_model', family: 'claude', role: 'lead' })).toThrow(/provide model/)
  })
  it('add_opencode_model appends to the DEFAULT roster; duplicate slug rejected; remove by label', () => {
    const s = store()
    const add = applyConfigAction(s.read, { action: 'add_opencode_model', label: 'GLM 6', slug: 'zai-coding-plan/glm-6' })
    expect(add.writes[0].key).toBe(OPENCODE_MODELS_KEY)
    // unset roster = the two built-in defaults (GLM/MiniMax) — the add lands on top of them
    const afterAdd = JSON.parse(add.writes[0].value) as { label: string }[]
    expect(afterAdd).toHaveLength(3)
    expect(afterAdd[2].label).toBe('GLM 6')
    s.map.set(OPENCODE_MODELS_KEY, add.writes[0].value)
    expect(() =>
      applyConfigAction(s.read, { action: 'add_opencode_model', label: 'dupe', slug: 'zai-coding-plan/glm-6' })
    ).toThrow(/already exists/)
    const rm = applyConfigAction(s.read, { action: 'remove_opencode_model', ref: 'glm 6' })
    expect((JSON.parse(rm.writes[0].value) as { label: string }[]).map((m) => m.label)).not.toContain('GLM 6')
  })
  it('custom agent add/remove round-trip', () => {
    const s = store()
    const add = applyConfigAction(s.read, { action: 'add_custom_agent', label: 'Aider', command: 'aider' })
    s.map.set(CUSTOM_AGENTS_KEY, add.writes[0].value)
    const rm = applyConfigAction(s.read, { action: 'remove_custom_agent', ref: 'aider' })
    expect(JSON.parse(rm.writes[0].value)).toEqual([])
    expect(() => applyConfigAction(s.read, { action: 'remove_custom_agent', ref: 'ghost' })).toThrow(/not found/)
  })
  it('account add/rename/role/remove — sign-in stays a human step (summary says so)', () => {
    const s = store()
    const add = applyConfigAction(s.read, { action: 'add_account', label: 'Work Claude', accountRole: 'both' })
    expect(add.summary).toMatch(/Sign in/)
    s.map.set(PROFILES_KEY, add.writes[0].value)
    const ren = applyConfigAction(s.read, { action: 'rename_account', ref: 'work claude', label: 'Team Claude' })
    s.map.set(PROFILES_KEY, ren.writes[0].value)
    const role = applyConfigAction(s.read, { action: 'set_account_role', ref: 'Team Claude', accountRole: 'orchestrator' })
    s.map.set(PROFILES_KEY, role.writes[0].value)
    const parsed = JSON.parse(s.map.get(PROFILES_KEY)!)
    expect(parsed[0].label).toBe('Team Claude')
    expect(parsed[0].role).toBe('orchestrator')
    const rm = applyConfigAction(s.read, { action: 'remove_account', ref: 'team claude' })
    expect(JSON.parse(rm.writes[0].value)).toEqual([])
  })
})

describe('agentConfigSnapshot', () => {
  it('reports effective models (settings override defaults) + rosters', () => {
    const s = store({ 'agent.model.claude.lead': 'claude-successor-6' })
    const snap = agentConfigSnapshot(s.read)
    expect(snap.models.find((m) => m.family === 'claude' && m.role === 'lead')!.model).toBe('claude-successor-6')
    expect(snap.models.find((m) => m.family === 'claude' && m.role === 'worker')!.model).toBe('opus')
    expect(Array.isArray(snap.opencodeModels)).toBe(true)
    expect(snap.accounts).toEqual([])
  })
})
