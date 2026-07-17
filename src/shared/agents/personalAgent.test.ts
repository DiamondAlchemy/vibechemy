import { describe, expect, it } from 'vitest'
import {
  PA_KEYS,
  PA_INPUT_LIMITS,
  PERSONAL_AGENT_PRESET_ID,
  buildPaOrchestratorBriefing,
  buildPaOversightBriefing,
  parsePersonalAgent,
  personalAgentPreset
} from './personalAgent'

function settings(values: Partial<Record<(typeof PA_KEYS)[keyof typeof PA_KEYS], string>>) {
  return (key: string): string | null => values[key as keyof typeof values] ?? null
}

describe('personal agent', () => {
  it('is unconfigured when the command is unset or blank', () => {
    expect(parsePersonalAgent(settings({}))).toBeNull()
    expect(parsePersonalAgent(settings({ [PA_KEYS.command]: '   ' }))).toBeNull()
  })

  it('parses whitespace-separated args and configured presentation', () => {
    expect(
      parsePersonalAgent(
        settings({
          [PA_KEYS.command]: '  my-pa  ',
          [PA_KEYS.args]: ' chat   --resume ',
          [PA_KEYS.label]: '  My PA  ',
          [PA_KEYS.color]: ' #22d3ee '
        })
      )
    ).toEqual({ command: 'my-pa', args: ['chat', '--resume'], label: 'My PA', color: '#22d3ee' })
  })

  it('uses a neutral default label', () => {
    expect(parsePersonalAgent(settings({ [PA_KEYS.command]: '/opt/agents/my-pa' }))).toEqual({
      command: '/opt/agents/my-pa',
      args: [],
      label: 'Personal Agent',
      color: '#22d3ee'
    })
  })

  it('rejects oversized configured fields', () => {
    expect(
      parsePersonalAgent(
        settings({ [PA_KEYS.command]: 'agent', [PA_KEYS.label]: 'a'.repeat(PA_INPUT_LIMITS.label + 1) })
      )
    ).toBeNull()
    expect(parsePersonalAgent(settings({ [PA_KEYS.command]: 'a'.repeat(PA_INPUT_LIMITS.command + 1) }))).toBeNull()
    expect(
      parsePersonalAgent(settings({ [PA_KEYS.command]: 'agent', [PA_KEYS.args]: 'a'.repeat(PA_INPUT_LIMITS.args + 1) }))
    ).toBeNull()
  })

  it('normalizes a configured label to one line before enforcing its limit', () => {
    expect(
      parsePersonalAgent(settings({ [PA_KEYS.command]: 'agent', [PA_KEYS.label]: '  My\n\t Personal   Agent  ' }))
        ?.label
    ).toBe('My Personal Agent')
  })

  it('builds single-line label-aware briefings', () => {
    const orchestrator = buildPaOrchestratorBriefing('My PA')
    const oversight = buildPaOversightBriefing('My PA')

    expect(orchestrator).toContain('You are My PA')
    expect(oversight).toContain('You are My PA')
    expect(orchestrator).not.toMatch(/[\r\n]/)
    expect(oversight).not.toMatch(/[\r\n]/)
  })

  it('keeps a relabeled personal-agent briefing generic', () => {
    const briefing = buildPaOrchestratorBriefing('Nova')

    expect(briefing).toContain('You are Nova')
    expect(briefing).toContain('your own agent orchestration')
  })

  it('materializes the orchestrator preset contract', () => {
    const preset = personalAgentPreset({
      command: 'my-pa',
      args: ['chat'],
      label: 'My PA',
      color: '#123456'
    })

    expect(preset).toEqual({
      id: PERSONAL_AGENT_PRESET_ID,
      name: 'My PA',
      command: 'my-pa',
      args: ['chat'],
      env: {},
      isSeed: true,
      color: '#123456',
      isOrchestrator: true,
      openingPrompt: buildPaOrchestratorBriefing('My PA')
    })
  })
})
