/**
 * User-defined custom agents: add ANY terminal agent from Settings —
 * no code change, no release. Each row (label + command line) becomes a spawnable
 * preset live, exactly like the OpenCode model roster. The CLI itself must already be
 * installed/authed on the machine (BYOK — the app never manages third-party credentials).
 */
import type { Preset } from '../types'

export const CUSTOM_AGENTS_KEY = 'custom.agents'

export interface CustomAgent {
  /** Preset id — 'custom-' + slug (stable; sessions and chips reference it). */
  id: string
  /** Chip / pane label ("Grok"). */
  label: string
  /** Launch line, split on whitespace ("grok" or "grok --model grok-4"). */
  command: string
}

export function customIdFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `custom-${slug || 'agent'}`
}

/** Parse the persisted setting; malformed input degrades to no custom agents. */
export function parseCustomAgents(raw: string | null | undefined): CustomAgent[] {
  if (!raw || !raw.trim()) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: CustomAgent[] = []
    const seen = new Set<string>()
    for (const e of arr) {
      const r = e as Partial<CustomAgent>
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      const command = typeof r.command === 'string' ? r.command.trim() : ''
      if (!label || !command) continue
      const id = typeof r.id === 'string' && /^custom-[a-z0-9-]{1,32}$/.test(r.id) ? r.id : customIdFor(label)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, label, command })
    }
    return out
  } catch {
    return []
  }
}

const COLORS = ['#e2b714', '#4dd0a6', '#c084fc', '#60a5fa', '#f472b6']

/** Materialize as spawnable presets. Simple whitespace arg split — quoted args are a
 *  known v1 limitation (wrap complex launches in a tiny shell script instead). */
export function presetsFromCustomAgents(agents: CustomAgent[]): Preset[] {
  return agents.map((a, i) => {
    const [command, ...args] = a.command.split(/\s+/)
    return {
      id: a.id,
      name: a.label,
      command,
      args,
      env: {},
      isSeed: false,
      color: COLORS[i % COLORS.length]
    }
  })
}
