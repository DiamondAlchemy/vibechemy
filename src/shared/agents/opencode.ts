/**
 * User-editable OpenCode model roster: the `opencode.models` setting
 * drives the opencode-* preset family — change a model's slug or add new models from
 * Settings without touching code. The two built-ins keep their historical preset ids so
 * command aliases ("glm", "minimax") and existing sessions stay valid.
 */
import type { Preset } from '../types'

export const OPENCODE_MODELS_KEY = 'opencode.models'

export interface OpencodeModel {
  /** Preset id — 'opencode-' + slug. Stable ids matter for sessions and aliases. */
  id: string
  /** Chip / pane label ("GLM", "Kimi K3"). */
  label: string
  /** The opencode -m slug (provider/model). */
  model: string
}

export const DEFAULT_OPENCODE_MODELS: OpencodeModel[] = [
  { id: 'opencode-glm', label: 'GLM', model: 'zai-coding-plan/glm-5.2' },
  { id: 'opencode-minimax', label: 'MiniMax', model: 'minimax/MiniMax-M3' }
]

/** 'Kimi K3' → 'opencode-kimi-k3'; conservative charset (preset ids reach tmux names). */
export function opencodeIdFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `opencode-${slug || 'model'}`
}

/** Parse the persisted setting; malformed/empty input falls back to the defaults. */
export function parseOpencodeModels(raw: string | null | undefined): OpencodeModel[] {
  if (!raw || !raw.trim()) return DEFAULT_OPENCODE_MODELS
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return DEFAULT_OPENCODE_MODELS
    const out: OpencodeModel[] = []
    const seen = new Set<string>()
    for (const e of arr) {
      const r = e as Partial<OpencodeModel>
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      const model = typeof r.model === 'string' ? r.model.trim() : ''
      if (!label || !model) continue
      const id = typeof r.id === 'string' && /^opencode-[a-z0-9-]{1,32}$/.test(r.id) ? r.id : opencodeIdFor(label)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, label, model })
    }
    return out.length ? out : DEFAULT_OPENCODE_MODELS
  } catch {
    return DEFAULT_OPENCODE_MODELS
  }
}

const KNOWN_COLORS: Record<string, string> = { 'opencode-glm': '#7c5cff', 'opencode-minimax': '#ff5c8a' }
const CUSTOM_COLORS = ['#5cd6ff', '#ffb65c', '#7dff8f', '#d98fff', '#ffd75c']

/** Materialize the family as spawnable presets (exact shape of the historical seeds). */
export function presetsFromModels(models: OpencodeModel[]): Preset[] {
  let custom = 0
  return models.map((m) => ({
    id: m.id,
    name: `OpenCode · ${m.label}`,
    command: 'opencode',
    args: ['-m', m.model],
    env: {},
    isSeed: true,
    color: KNOWN_COLORS[m.id] ?? CUSTOM_COLORS[custom++ % CUSTOM_COLORS.length]
  }))
}
