import { describe, it, expect } from 'vitest'
import { groupOrchestratorFamilies, familyLabel } from './families'

const P = (
  id: string,
  name: string,
  command: string,
  color?: string
): { id: string; name: string; command: string; color?: string } => ({
  id,
  name,
  command,
  color
})

describe('groupOrchestratorFamilies', () => {
  it('collapses claude seeds + profiles into one family, keeps singles separate', () => {
    const fams = groupOrchestratorFamilies([
      P('orchestrator', 'Claude', 'claude', '#d97757'),
      P('orchestrator-fable', 'Claude · Fable', 'claude'),
      P('orchestrator-codex', 'Codex', 'codex', '#74aa9c'),
      P('orchestrator-opencode-glm', 'OpenCode · GLM', 'opencode'),
      P('orchestrator-opencode-minimax', 'OpenCode · MiniMax', 'opencode'),
      P('profile-p1-orch', 'Work Claude', 'claude'),
      P('orchestrator-grok', 'Grok', 'grok')
    ])
    expect(fams.map((f) => `${f.label}:${f.items.length}`)).toEqual(['Claude:3', 'Codex:1', 'OpenCode:2', 'Grok:1'])
    // in-family order preserved (profiles after seeds, as given)
    expect(fams[0].items.map((i) => i.id)).toEqual(['orchestrator', 'orchestrator-fable', 'profile-p1-orch'])
    // family color = first member's color; falls back per family
    expect(fams[0].color).toBe('#d97757')
  })
  it('unknown commands get a capitalized label and their own family', () => {
    const fams = groupOrchestratorFamilies([P('custom-x-orch', 'My Bot', 'mybot')])
    expect(fams[0].label).toBe('Mybot')
  })
  it('familyLabel maps the known CLIs', () => {
    expect(familyLabel('opencode')).toBe('OpenCode')
  })
  it('derives the personal-agent family label from configuration with a neutral fallback', () => {
    const configured = groupOrchestratorFamilies([P('personal-agent', 'Example Agent', 'custom-pa')])
    const neutral = groupOrchestratorFamilies([P('personal-agent', '', 'custom-pa')])

    expect(configured[0].label).toBe('Example Agent')
    expect(neutral[0].label).toBe('Personal Agent')
  })
})
