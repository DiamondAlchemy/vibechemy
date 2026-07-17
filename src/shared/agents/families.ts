// Pure grouping for the orchestrator summon picker: the flat list outgrew
// itself once account profiles landed (Claude + Claude·Fable + N profile accounts + 3 OpenCode
// models…). Group presets into AGENT FAMILIES keyed by the launch `command` — profiles and seed
// variants of one CLI collapse under one family row; single-variant families stay one-click.

import { isPersonalAgentPresetId } from './personalAgent'

export interface FamilyPreset {
  id: string
  name: string
  command: string
  color?: string
  free?: boolean
}

export interface OrchestratorFamily<P extends FamilyPreset = FamilyPreset> {
  /** Family key = the launch command ('claude', 'opencode', …). */
  command: string
  /** Display label for the family row. */
  label: string
  /** Color for the family dot (first member's color). */
  color: string
  /** Members in original preset order. */
  items: P[]
}

const FAMILY_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  grok: 'Grok',
  kimi: 'Kimi'
}

/** Human label for a family command — mapped names for the known CLIs, capitalized otherwise. */
export function familyLabel(command: string): string {
  return FAMILY_LABELS[command] ?? (command ? command.charAt(0).toUpperCase() + command.slice(1) : 'Other')
}

/**
 * Group summonable orchestrator presets into families by launch command, preserving first-seen
 * family order and in-family preset order. The caller decides rendering: a 1-item family is a
 * plain summon row; a 2+ family is an expandable group.
 */
export function groupOrchestratorFamilies<P extends FamilyPreset>(presets: P[]): OrchestratorFamily<P>[] {
  const byCommand = new Map<string, OrchestratorFamily<P>>()
  for (const p of presets) {
    const key = p.command || 'other'
    const fam = byCommand.get(key)
    if (fam) {
      fam.items.push(p)
      if (isPersonalAgentPresetId(p.id)) fam.label = p.name.trim() || 'Personal Agent'
    } else {
      byCommand.set(key, {
        command: key,
        label: isPersonalAgentPresetId(p.id) ? p.name.trim() || 'Personal Agent' : familyLabel(key),
        color: p.color ?? '#8b8b8b',
        items: [p]
      })
    }
  }
  return [...byCommand.values()]
}
