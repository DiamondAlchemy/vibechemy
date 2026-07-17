/**
 * User-editable AGENT ACCOUNT profiles: the `agent.profiles` setting drives the
 * `profile-*` preset family — one named chip per additional account of an agent (e.g. two Claude
 * subs). Mirrors the OpenCode model roster, with two deliberate differences: (1) NO defaults — an
 * empty roster means NO chips (the operator's main login is untouched until they add a profile);
 * (2) the `id` is STABLE and assigned at creation, never derived from `label`, because the label is
 * renamable and the id names the isolated credential dir (`~/.vibechemy/profiles/<id>/`).
 */
export const PROFILES_KEY = 'agent.profiles'

export type ProfileRole = 'orchestrator' | 'both'

export interface AgentProfile {
  id: string // stable slug (assigned at creation, NOT derived from the renamable label)
  agentId: string // base agent: 'claude' (v1). Later: 'grok' | 'opencode' | 'codex'
  label: string // operator's custom name — "Claude Work 1", "Team Claude"
  role: ProfileRole // orchestrator = summon chip only; both = + a worker spawn chip
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

/** Parse the persisted roster. Empty/malformed → [] (no chips until the operator adds one). Each row
 *  needs a valid stable id + a non-empty label; agentId defaults 'claude', role defaults 'orchestrator'. */
export function parseAgentProfiles(raw: string | null | undefined): AgentProfile[] {
  if (!raw || !raw.trim()) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: AgentProfile[] = []
    const seen = new Set<string>()
    for (const e of arr) {
      const r = e as Partial<AgentProfile>
      const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : ''
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      if (!id || !label || seen.has(id)) continue
      seen.add(id)
      const agentId = typeof r.agentId === 'string' && r.agentId.trim() ? r.agentId.trim() : 'claude'
      const role: ProfileRole = r.role === 'both' ? 'both' : 'orchestrator'
      // A legacy per-profile `model` (from the removed dropdown) is deliberately DROPPED: ROLE
      // decides the model uniformly (lead = Fable, worker = Opus). An account never pins a model —
      // a stored pin would break the rule by forcing Fable even when the account runs as a worker.
      out.push({ id, agentId, label, role })
    }
    return out
  } catch {
    return []
  }
}

/** The generated preset ids for a profile — an orchestrator lead and (for role 'both') a worker. */
export function profilePresetIds(p: Pick<AgentProfile, 'id'>): { orch: string; worker: string } {
  return { orch: `profile-${p.id}-orch`, worker: `profile-${p.id}` }
}

/** A fresh stable id for a NEW profile (UI helper only — never derive from the renamable label). */
export function newProfileId(): string {
  return 'p' + Math.random().toString(36).slice(2, 8)
}

/**
 * Claude-profile ids present in the PREVIOUS roster but gone from the NEXT — the set whose
 * credentials must be PURGED: removing a profile must not orphan its scoped Keychain OAuth token
 * and creds dir, because re-adding the same id would silently reuse the old login.
 */
export function removedProfileIds(prevRaw: string | null | undefined, nextRaw: string | null | undefined): string[] {
  const next = new Set(parseAgentProfiles(nextRaw).map((p) => p.id))
  return parseAgentProfiles(prevRaw)
    .filter((p) => p.agentId === 'claude' && !next.has(p.id))
    .map((p) => p.id)
}
