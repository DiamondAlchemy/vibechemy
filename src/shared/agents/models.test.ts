import { describe, it, expect } from 'vitest'
import { modelSettingKey, effortSettingKey, codexModelArgs, applyModelToArgs, MODEL_DEFAULTS } from './models'

describe('model settings', () => {
  it('keys are namespaced per family+role', () => {
    expect(modelSettingKey('codex', 'lead')).toBe('agent.model.codex.lead')
    expect(effortSettingKey('codex', 'worker')).toBe('agent.effort.codex.worker')
    expect(MODEL_DEFAULTS[modelSettingKey('claude', 'lead')]).toBe('claude-fable-5')
  })
  it('codexModelArgs: model + effort → -m and the reasoning-effort override', () => {
    expect(codexModelArgs('gpt-5.6-sol', 'ultra')).toEqual(['-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="ultra"'])
  })
  it('codexModelArgs: blank/absent parts are omitted; quotes are stripped from effort', () => {
    expect(codexModelArgs('', '')).toEqual([])
    expect(codexModelArgs(null, 'xhigh')).toEqual(['-c', 'model_reasoning_effort="xhigh"'])
    expect(codexModelArgs('luna', ' x"high ')).toEqual(['-m', 'luna', '-c', 'model_reasoning_effort="xhigh"'])
  })
})

describe('applyModelToArgs (spawn_worker model override)', () => {
  it('claude: replaces the preset --model, keeps everything else', () => {
    expect(applyModelToArgs('claude', ['--model', 'opus'], 'sonnet')).toEqual(['--model', 'sonnet'])
    expect(applyModelToArgs('claude', ['--mcp-config', '/x.json', '--model', 'opus'], 'haiku')).toEqual([
      '--mcp-config',
      '/x.json',
      '--model',
      'haiku'
    ])
  })
  it('codex: replaces -m and the reasoning-effort -c override', () => {
    expect(
      applyModelToArgs('codex', ['-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="ultra"'], 'gpt-5.6-terra', 'xhigh')
    ).toEqual(['-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort="xhigh"'])
    // other -c overrides (mcp wiring) survive untouched
    expect(applyModelToArgs('codex', ['-c', 'mcp_servers.vibechemy.url="http://x"'], 'luna')).toEqual([
      '-c',
      'mcp_servers.vibechemy.url="http://x"',
      '-m',
      'luna'
    ])
  })
  it('opencode/grok use -m; unknown CLIs return null (caller raises a clear error)', () => {
    expect(applyModelToArgs('opencode', ['-m', 'zai-coding-plan/glm-5.2'], 'minimax/MiniMax-M3')).toEqual([
      '-m',
      'minimax/MiniMax-M3'
    ])
    expect(applyModelToArgs('grok', [], 'grok-4.5')).toEqual(['-m', 'grok-4.5'])
    expect(applyModelToArgs('cursor-agent', [], 'anything')).toBeNull()
  })
})
