// Role→model mapping as settings, per agent family: model names
// (and codex effort tiers) are free-text settings edited in Settings → Agents, never code. A lead
// (orchestrator) and a worker of the same family can run different models/efforts, e.g. Codex lead
// on sol/ultra while codex workers run sol/xhigh or luna.

export type ModelFamily = 'claude' | 'codex'
export type ModelRole = 'lead' | 'worker'

export const MODEL_SETTING_PREFIX = 'agent.model.'
export const EFFORT_SETTING_PREFIX = 'agent.effort.'

export function modelSettingKey(family: ModelFamily, role: ModelRole): string {
  return `${MODEL_SETTING_PREFIX}${family}.${role}`
}
export function effortSettingKey(family: ModelFamily, role: ModelRole): string {
  return `${EFFORT_SETTING_PREFIX}${family}.${role}`
}

/** Placeholder/default per field — shown in the Settings inputs; empty codex = the CLI's default. */
export const MODEL_DEFAULTS: Record<string, string> = {
  [modelSettingKey('claude', 'lead')]: 'claude-fable-5',
  [modelSettingKey('claude', 'worker')]: 'opus',
  [modelSettingKey('codex', 'lead')]: '',
  [modelSettingKey('codex', 'worker')]: ''
}

/** codex CLI argv for a model + reasoning-effort choice: `-m <model>` and the config override
 *  `-c model_reasoning_effort="<effort>"`. Either part optional; effort is quoted as a TOML string. */
export function codexModelArgs(model?: string | null, effort?: string | null): string[] {
  const args: string[] = []
  const m = model?.trim()
  const e = effort?.trim()
  if (m) args.push('-m', m)
  if (e) args.push('-c', `model_reasoning_effort="${e.replace(/"/g, '')}"`)
  return args
}

/** Drop `flag <value>` pairs (and, when `prefix` given, `-c <prefix...>` overrides) from argv. */
function stripFlagPairs(args: string[], flags: string[], cPrefix?: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i]) && i + 1 < args.length) {
      i++ // skip the flag's value too
      continue
    }
    if (cPrefix && args[i] === '-c' && i + 1 < args.length && args[i + 1].startsWith(cPrefix)) {
      i++
      continue
    }
    out.push(args[i])
  }
  return out
}

/**
 * Rewrite a preset's argv to run a specific model for a spawn_worker model/effort override. Strips the
 * preset's own model flags first so the override always wins, then appends the family's flag
 * shape. Returns null for a CLI we don't know how to override (caller raises a clear error).
 * Effort is honored for codex; other CLIs have no effort flag and ignore it.
 */
export function applyModelToArgs(
  command: string,
  args: string[],
  model?: string | null,
  effort?: string | null
): string[] | null {
  const m = model?.trim()
  switch (command) {
    case 'claude': {
      const base = stripFlagPairs(args, ['--model'])
      return m ? [...base, '--model', m] : base
    }
    case 'codex': {
      const base = stripFlagPairs(args, ['-m', '--model'], 'model_reasoning_effort=')
      return [...base, ...codexModelArgs(m, effort)]
    }
    case 'opencode':
    case 'grok': {
      const base = stripFlagPairs(args, ['-m', '--model'])
      return m ? [...base, '-m', m] : base
    }
    default:
      return null
  }
}
