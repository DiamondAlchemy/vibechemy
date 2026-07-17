import type { Preset } from '../types'
import { PRODUCT_IDENTITY } from '../product'

export const PA_KEYS = {
  command: 'agent.personal.command',
  args: 'agent.personal.args',
  label: 'agent.personal.label',
  color: 'agent.personal.color'
} as const

export const PA_INPUT_LIMITS = {
  label: 60,
  command: 200,
  args: 500
} as const

export const PERSONAL_AGENT_PRESET_ID = 'personal-agent'
export const LEGACY_PERSONAL_AGENT_IDS: readonly string[] = [PERSONAL_AGENT_PRESET_ID]

export function isPersonalAgentPresetId(id: string): boolean {
  return LEGACY_PERSONAL_AGENT_IDS.includes(id)
}

export function canonicalPersonalAgentPresetId(id: string): string {
  return isPersonalAgentPresetId(id) ? PERSONAL_AGENT_PRESET_ID : id
}

export function resolvePersonalAgentPreset<T extends { id: string }>(id: string, presets: readonly T[]): T | undefined {
  return (
    presets.find((preset) => preset.id === id) ??
    (isPersonalAgentPresetId(id) ? presets.find((preset) => preset.id === PERSONAL_AGENT_PRESET_ID) : undefined)
  )
}

export interface PersonalAgentConfig {
  command: string
  args: string[]
  label: string
  color: string
}

const DEFAULT_COLOR = '#22d3ee'

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function parsePersonalAgent(get: (key: string) => string | null): PersonalAgentConfig | null {
  const command = get(PA_KEYS.command)?.trim() ?? ''
  if (!command || command.length > PA_INPUT_LIMITS.command) return null

  const argsRaw = get(PA_KEYS.args)?.trim() ?? ''
  const configuredLabel = singleLine(get(PA_KEYS.label) ?? '')
  const label = configuredLabel || 'Personal Agent'
  if (argsRaw.length > PA_INPUT_LIMITS.args || label.length > PA_INPUT_LIMITS.label) return null
  const color = get(PA_KEYS.color)?.trim() || DEFAULT_COLOR

  return {
    command,
    args: argsRaw ? argsRaw.split(/\s+/) : [],
    label,
    color
  }
}

export function buildPaOrchestratorBriefing(label: string): string {
  return `You are ${singleLine(label)}, but in THIS session you are operating as the Vibechemy desktop orchestrator. Drive the fleet ONLY through the ${PRODUCT_IDENTITY.mcpServerName} MCP tools: spawn every worker with spawn_worker (isolate:true for code work) so it opens as a visible Vibechemy pane the user can watch and control; steer a running worker with send_to_worker. NEVER use your own agent orchestration, sub-agents, background terminals, or shell-spawned processes to create workers — anything spawned that way is invisible to the user and outside Vibechemy. Merges are local; never push or deploy unprompted, and report check results honestly. Reply with a one-line readiness check, then wait for my first instruction.`
}

export function buildPaOversightBriefing(label: string): string {
  return `[Vibechemy — end-of-day hand-off] You are ${singleLine(label)}, operating as the Vibechemy overseer for this session — not driving the fleet. Call get_day_digest to see what shipped, what features were added, and what bugs were fixed today, and use list_knowledge / search_knowledge to know what we have built and what bugs are still open. Then update your own memory of where each project stands and give me a short situational summary. You CURATE the knowledge base AND the coding standards: log_outcome / update_outcome to reconcile any features or bugs that were not captured and keep the open-bug list honest; and from recurring patterns or repeated mistakes in the day digest, propose coding standards (get_standards for the current set; log_standard / update_standard to add or retire) — rule-first, one concept each, skip the obvious, token-tight (they inject into every worker), and confirm with me before adding. You do NOT spawn workers or merge. Absorb the state, tidy the record, and report.`
}

export function personalAgentPreset(cfg: PersonalAgentConfig): Preset {
  return {
    id: PERSONAL_AGENT_PRESET_ID,
    name: cfg.label,
    command: cfg.command,
    args: cfg.args,
    env: {},
    isSeed: true,
    color: cfg.color,
    isOrchestrator: true,
    openingPrompt: buildPaOrchestratorBriefing(cfg.label)
  }
}
