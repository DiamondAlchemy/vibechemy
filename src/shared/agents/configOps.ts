// Agent configuration operations mutate ONLY the deliberately malleable operational settings —
// the role→model table, the OpenCode model roster, custom agent
// chips, and account-profile labels/roles. Nothing else is reachable through this seam: no tokens,
// no system settings, and account SIGN-IN stays a human step in Settings.
//
// Pure: reads via the injected getter, returns the writes to perform + a spoken-back summary.
// The caller (ControlPlane.configureAgents) persists the writes through the SAME writeSetting
// path the Settings UI uses, so live preset re-materialization fires identically.

import { modelSettingKey, effortSettingKey, MODEL_DEFAULTS, type ModelFamily, type ModelRole } from './models'
import { OPENCODE_MODELS_KEY, parseOpencodeModels, opencodeIdFor, type OpencodeModel } from './opencode'
import { CUSTOM_AGENTS_KEY, parseCustomAgents, customIdFor, type CustomAgent } from './custom'
import { PROFILES_KEY, parseAgentProfiles, newProfileId, type AgentProfile, type ProfileRole } from './profiles'

export type AgentConfigAction =
  | { action: 'set_model'; family: ModelFamily; role: ModelRole; model?: string; effort?: string }
  | { action: 'add_opencode_model'; label: string; slug: string }
  | { action: 'remove_opencode_model'; ref: string }
  | { action: 'add_custom_agent'; label: string; command: string }
  | { action: 'remove_custom_agent'; ref: string }
  | { action: 'add_account'; label: string; accountRole?: ProfileRole }
  | { action: 'rename_account'; ref: string; label: string }
  | { action: 'set_account_role'; ref: string; accountRole: ProfileRole }
  | { action: 'remove_account'; ref: string }

export interface ConfigWrite {
  key: string
  value: string
}

export interface AgentConfigSnapshot {
  models: { family: ModelFamily; role: ModelRole; model: string; effort: string | null }[]
  opencodeModels: OpencodeModel[]
  customAgents: CustomAgent[]
  accounts: { id: string; label: string; role: ProfileRole }[]
}

type Read = (key: string) => string | null

/** The current operational config before or after a change. */
export function agentConfigSnapshot(read: Read): AgentConfigSnapshot {
  const families: ModelFamily[] = ['claude', 'codex']
  const roles: ModelRole[] = ['lead', 'worker']
  const models = families.flatMap((family) =>
    roles.map((role) => ({
      family,
      role,
      model: read(modelSettingKey(family, role))?.trim() || MODEL_DEFAULTS[modelSettingKey(family, role)] || '(CLI default)',
      effort: family === 'codex' ? read(effortSettingKey(family, role))?.trim() || null : null
    }))
  )
  return {
    models,
    opencodeModels: parseOpencodeModels(read(OPENCODE_MODELS_KEY)),
    customAgents: parseCustomAgents(read(CUSTOM_AGENTS_KEY)),
    accounts: parseAgentProfiles(read(PROFILES_KEY)).map((p) => ({ id: p.id, label: p.label, role: p.role }))
  }
}

const norm = (s: string): string => s.trim().toLowerCase()

function findByRef<T extends { id: string; label: string }>(list: T[], ref: string, what: string): T {
  const r = norm(ref ?? '')
  const hit = list.find((e) => norm(e.id) === r || norm(e.label) === r)
  if (!hit) {
    const names = list.map((e) => e.label).join(', ') || '(none)'
    throw new Error(`${what} "${ref}" not found — current: ${names}`)
  }
  return hit
}

/** Apply one action → the setting writes to persist + a short confirmation for the user. */
export function applyConfigAction(read: Read, a: AgentConfigAction): { writes: ConfigWrite[]; summary: string } {
  switch (a.action) {
    case 'set_model': {
      const writes: ConfigWrite[] = []
      if (a.model !== undefined) writes.push({ key: modelSettingKey(a.family, a.role), value: a.model.trim() })
      if (a.effort !== undefined) writes.push({ key: effortSettingKey(a.family, a.role), value: a.effort.trim() })
      if (!writes.length) throw new Error('set_model: provide model and/or effort')
      const eff = a.effort !== undefined ? ` effort "${a.effort.trim() || '(default)'}"` : ''
      const mod = a.model !== undefined ? ` model "${a.model.trim() || '(default)'}"` : ''
      return { writes, summary: `${a.family} ${a.role} →${mod}${eff}` }
    }
    case 'add_opencode_model': {
      const label = (a.label ?? '').trim()
      const slug = (a.slug ?? '').trim()
      if (!label || !slug) throw new Error('add_opencode_model: label and slug are required')
      const list = parseOpencodeModels(read(OPENCODE_MODELS_KEY))
      if (list.some((m) => norm(m.model) === norm(slug)))
        throw new Error(`opencode model with slug "${slug}" already exists`)
      const next = [...list, { id: opencodeIdFor(`${label}-${slug}`), label, model: slug }]
      return {
        writes: [{ key: OPENCODE_MODELS_KEY, value: JSON.stringify(next) }],
        summary: `added OpenCode model "${label}" (${slug}) — it's a spawn chip now`
      }
    }
    case 'remove_opencode_model': {
      const list = parseOpencodeModels(read(OPENCODE_MODELS_KEY))
      const r = norm(a.ref ?? '')
      const hit = list.find((m) => norm(m.id) === r || norm(m.label) === r || norm(m.model) === r)
      if (!hit) throw new Error(`opencode model "${a.ref}" not found — current: ${list.map((m) => m.label).join(', ')}`)
      return {
        writes: [{ key: OPENCODE_MODELS_KEY, value: JSON.stringify(list.filter((m) => m.id !== hit.id)) }],
        summary: `removed OpenCode model "${hit.label}"`
      }
    }
    case 'add_custom_agent': {
      const label = (a.label ?? '').trim()
      const command = (a.command ?? '').trim()
      if (!label || !command) throw new Error('add_custom_agent: label and command are required')
      const list = parseCustomAgents(read(CUSTOM_AGENTS_KEY))
      const next = [...list, { id: customIdFor(label), label, command }]
      return {
        writes: [{ key: CUSTOM_AGENTS_KEY, value: JSON.stringify(next) }],
        summary: `added agent "${label}" (${command}) — it's a spawn chip now`
      }
    }
    case 'remove_custom_agent': {
      const list = parseCustomAgents(read(CUSTOM_AGENTS_KEY))
      const hit = findByRef(list, a.ref, 'custom agent')
      return {
        writes: [{ key: CUSTOM_AGENTS_KEY, value: JSON.stringify(list.filter((e) => e.id !== hit.id)) }],
        summary: `removed agent "${hit.label}"`
      }
    }
    case 'add_account': {
      const label = (a.label ?? '').trim()
      if (!label) throw new Error('add_account: label is required')
      const list = parseAgentProfiles(read(PROFILES_KEY))
      const next: AgentProfile[] = [
        ...list,
        { id: newProfileId(), agentId: 'claude', label, role: a.accountRole ?? 'orchestrator' }
      ]
      return {
        writes: [{ key: PROFILES_KEY, value: JSON.stringify(next) }],
        summary: `added Claude account "${label}" (${a.accountRole ?? 'orchestrator'}) — NOT signed in yet: the operator must hit Sign in on it in Settings → Agents`
      }
    }
    case 'rename_account': {
      const list = parseAgentProfiles(read(PROFILES_KEY))
      const hit = findByRef(list, a.ref, 'account')
      const label = (a.label ?? '').trim()
      if (!label) throw new Error('rename_account: new label is required')
      const next = list.map((p) => (p.id === hit.id ? { ...p, label } : p))
      return {
        writes: [{ key: PROFILES_KEY, value: JSON.stringify(next) }],
        summary: `renamed account "${hit.label}" → "${label}" (its sign-in is untouched)`
      }
    }
    case 'set_account_role': {
      const list = parseAgentProfiles(read(PROFILES_KEY))
      const hit = findByRef(list, a.ref, 'account')
      const next = list.map((p) => (p.id === hit.id ? { ...p, role: a.accountRole } : p))
      return {
        writes: [{ key: PROFILES_KEY, value: JSON.stringify(next) }],
        summary: `account "${hit.label}" role → ${a.accountRole}`
      }
    }
    case 'remove_account': {
      const list = parseAgentProfiles(read(PROFILES_KEY))
      const hit = findByRef(list, a.ref, 'account')
      return {
        writes: [{ key: PROFILES_KEY, value: JSON.stringify(list.filter((p) => p.id !== hit.id)) }],
        summary: `removed account "${hit.label}" (its chips are gone; its saved login stays in the Keychain, harmless)`
      }
    }
  }
}
