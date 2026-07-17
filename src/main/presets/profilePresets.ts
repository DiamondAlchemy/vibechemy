import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Preset } from '@shared/types'
import { type AgentProfile, profilePresetIds } from '@shared/agents/profiles'
import { MODEL_DEFAULTS, modelSettingKey } from '@shared/agents/models'

const DEFAULT_CLAUDE_LEAD_MODEL = MODEL_DEFAULTS[modelSettingKey('claude', 'lead')]
const DEFAULT_CLAUDE_WORKER_MODEL = MODEL_DEFAULTS[modelSettingKey('claude', 'worker')]
import { ORCHESTRATOR_BRIEFING } from '../orchestrator/setup'

/**
 * The isolated CREDENTIAL dir for a profile. For Claude only CLAUDE_SECURESTORAGE_CONFIG_DIR points
 * here — the token (billing account) is isolated, but CLAUDE_CONFIG_DIR is left DEFAULT so the
 * projects/sessions dir (~/.claude/projects) is SHARED across accounts. That is deliberate: one
 * Vibechemy workspace, different billing subs. It also enables sub failover — a conversation
 * started on sub A lives in the shared projects dir, so `claude --continue`/`--resume` under sub B's
 * creds picks it up with full context (no re-ingest). Created on demand (idempotent).
 */
export function profileCredsDir(baseDir: string, id: string): string {
  const dir = join(baseDir, 'profiles', id)
  mkdirSync(dir, { recursive: true })
  return dir
}

const CLAUDE_COLOR = '#d97757'

/**
 * Materialize the account-profile roster into presets. v1 handles agentId 'claude': each profile
 * becomes an orchestrator lead (product MCP via the shared --mcp-config; isolated creds via
 * CLAUDE_CONFIG_DIR + CLAUDE_SECURESTORAGE_CONFIG_DIR), and role 'both' also yields a spawnable
 * worker on that same account. Unknown agentIds are skipped (added incrementally). Rewritten on
 * boot + live on the settingsSet for `agent.profiles`.
 */
export function presetsFromProfiles(
  profiles: AgentProfile[],
  opts: { mcpConfigPath: string; baseDir: string; leadModel?: string; workerModel?: string }
): Preset[] {
  const out: Preset[] = []
  for (const p of profiles) {
    if (p.agentId !== 'claude') continue // v1: Claude only
    const dir = profileCredsDir(opts.baseDir, p.id)
    // Creds-only isolation: swap ONLY the credential store; share the projects/sessions dir so a
    // conversation is resumable across subs (failover) and the workspace stays unified.
    const env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: dir }
    const ids = profilePresetIds(p)
    // ROLE DECIDES THE MODEL: an account summoned as a lead uses
    // the LEAD model (Fable), spawned as a worker the WORKER model (Opus) — every account, no
    // exceptions and no per-account pin. The mapping is SETTINGS (claude lead/worker) so a renamed
    // model is a UI edit, never code. (A worker's model is then changeable per-spawn or via /model.)
    const orchModel = opts.leadModel ?? DEFAULT_CLAUDE_LEAD_MODEL
    const workerModel = opts.workerModel ?? DEFAULT_CLAUDE_WORKER_MODEL
    out.push({
      id: ids.orch,
      name: p.label,
      command: 'claude',
      args: ['--model', orchModel, '--mcp-config', opts.mcpConfigPath, '--append-system-prompt', ORCHESTRATOR_BRIEFING],
      env,
      isSeed: true,
      isOrchestrator: true,
      color: CLAUDE_COLOR
    })
    if (p.role === 'both') {
      out.push({
        id: ids.worker,
        name: p.label,
        command: 'claude',
        args: ['--model', workerModel],
        env,
        isSeed: true,
        color: CLAUDE_COLOR
      })
    }
  }
  return out
}
