import type { Preset } from '@shared/types'
import { LEGACY_PERSONAL_AGENT_IDS, PERSONAL_AGENT_PRESET_ID } from '@shared/agents/personalAgent'

function canonicalPresetId(id: string): string {
  return LEGACY_PERSONAL_AGENT_IDS.some((candidate) => candidate === id) ? PERSONAL_AGENT_PRESET_ID : id
}

function shellQuote(s: string): string {
  if (s.length > 0 && /^[A-Za-z0-9_/.:=@%+,-]+$/.test(s)) return s
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

export class PresetRegistry {
  private constructor(private presets: Map<string, Preset>) {}

  static from(list: Preset[]): PresetRegistry {
    return new PresetRegistry(new Map(list.map((p) => [p.id, p])))
  }

  get(id: string): Preset | undefined {
    return this.presets.get(id) ?? this.presets.get(canonicalPresetId(id))
  }

  list(): Preset[] {
    return [...this.presets.values()]
  }

  ids(): Set<string> {
    return new Set(this.presets.keys())
  }

  /** Preset ids accepted by command parsing. Compatibility aliases are validation-only and never listed as chips. */
  validationIds(): Set<string> {
    const ids = this.ids()
    if (ids.has(PERSONAL_AGENT_PRESET_ID)) {
      for (const id of LEGACY_PERSONAL_AGENT_IDS) ids.add(id)
    }
    return ids
  }

  /** The spawnable worker presets (excludes orchestrator leads). */
  spawnable(): Preset[] {
    return this.list().filter((p) => !p.isOrchestrator)
  }

  /**
   * Replace every preset whose id starts with `prefix` with `next` (user-editable
   * families, e.g. opencode.models → 'opencode-'). Orchestrator ids use their own
   * 'orchestrator-' prefix, so a family swap can never touch a lead.
   */
  replaceFamily(prefix: string, next: Preset[]): void {
    for (const id of [...this.presets.keys()]) {
      if (id.startsWith(prefix)) this.presets.delete(id)
    }
    for (const p of next) this.presets.set(p.id, p)
  }

  /**
   * Resolve a preset id forgivingly for the agent/MCP spawn path: exact id first, else a UNIQUE
   * case-insensitive substring match among spawnable presets — so "claude" → "claude-opus", "glm" →
   * "opencode-glm". Throws a clear, listing error on no/ambiguous match so an orchestrator can
   * self-correct. Exact ids (including every UI spawn) are unaffected.
   */
  resolve(id: string): Preset {
    const exact = this.get(id)
    if (exact) return exact
    const spawnable = this.spawnable()
    const avail = spawnable.map((p) => p.id).join(', ')
    const q = id.trim().toLowerCase()
    if (!q) throw new Error(`No preset id given. Available presets: ${avail}`)
    const matches = spawnable.filter((p) => p.id.toLowerCase().includes(q))
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) throw new Error(`Unknown preset "${id}". Available presets: ${avail}`)
    throw new Error(`Ambiguous preset "${id}" — matches ${matches.map((p) => p.id).join(', ')}. Use the exact id.`)
  }

  /** Returns a single shell-string suitable as tmux's `sh -c` launch command. */
  buildLaunchCommand(preset: Preset): string {
    const parts: string[] = []
    const env = preset.env ?? {}
    const keys = Object.keys(env)
    if (keys.length > 0) {
      parts.push('env')
      for (const k of keys) parts.push(`${k}=${shellQuote(env[k])}`)
    }
    parts.push(shellQuote(preset.command))
    for (const a of preset.args ?? []) parts.push(shellQuote(a))
    return parts.join(' ')
  }
}
