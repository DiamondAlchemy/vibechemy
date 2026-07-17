import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { OPENCODE_MODELS_KEY, parseOpencodeModels, opencodeIdFor, type OpencodeModel } from '@shared/agents/opencode'
import { CUSTOM_AGENTS_KEY, parseCustomAgents, customIdFor, type CustomAgent } from '@shared/agents/custom'
import {
  PROFILES_KEY,
  parseAgentProfiles,
  newProfileId,
  type AgentProfile,
  type ProfileRole
} from '@shared/agents/profiles'
import {
  modelSettingKey,
  effortSettingKey,
  MODEL_DEFAULTS,
  type ModelFamily,
  type ModelRole
} from '@shared/agents/models'

/**
 * User-defined agents: any terminal CLI becomes a spawn chip from
 * here — label + launch command, live, no code change. The CLI must already be
 * installed and signed in on this machine (run its install/auth in a shell pane first).
 */
function CustomAgentsEditor(): React.JSX.Element {
  const [agents, setAgents] = useState<CustomAgent[] | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getSetting(CUSTOM_AGENTS_KEY)
      .then((v) => {
        if (alive) setAgents(parseCustomAgents(v))
      })
      .catch(() => {
        if (alive) setAgents([])
      })
    return () => {
      alive = false
    }
  }, [])

  const save = useCallback((next: CustomAgent[]): void => {
    setAgents(next)
    void api.setSetting(CUSTOM_AGENTS_KEY, JSON.stringify(next))
    setSavedMsg('saved — chip is live')
    window.setTimeout(() => setSavedMsg(null), 2500)
  }, [])

  if (!agents) return <div className="agent-note">loading…</div>
  return (
    <div className="agent-card agent-card-custom">
      <div className="agent-card-head">
        <span className="agent-title">Custom agents</span>
        {savedMsg && <span className="oc-saved">{savedMsg}</span>}
      </div>
      <div className="agent-note">
        Any terminal agent → spawn chip. Install/sign in first (shell pane), then add its launch command here.
      </div>
      {agents.map((a, i) => (
        <div key={a.id} className="oc-model-row">
          <input
            className="oc-input oc-label"
            value={a.label}
            placeholder="Label"
            onChange={(e) => {
              const next = [...agents]
              next[i] = { ...a, label: e.target.value }
              setAgents(next)
            }}
            onBlur={() => save(agents)}
          />
          <input
            className="oc-input oc-slug"
            value={a.command}
            placeholder="launch command (e.g. grok)"
            onChange={(e) => {
              const next = [...agents]
              next[i] = { ...a, command: e.target.value }
              setAgents(next)
            }}
            onBlur={() => save(agents)}
          />
          <button className="agent-row-btn" title="Remove" onClick={() => save(agents.filter((x) => x.id !== a.id))}>
            ✕
          </button>
        </div>
      ))}
      <button
        className="layout-btn"
        onClick={() => {
          const label = `Agent ${agents.length + 1}`
          save([...agents, { id: customIdFor(`${label}-${Date.now() % 10000}`), label, command: '' }])
        }}
      >
        + Add agent
      </button>
    </div>
  )
}

/**
 * Editable OpenCode model roster: each row = one spawn chip. Saving
 * live-swaps the preset family — new panes use the edited slugs immediately; running
 * panes keep the model they launched with. The two built-ins keep their stable ids so
 * "glm"/"minimax" command aliases stay wired.
 */
function OpencodeModelsEditor(): React.JSX.Element {
  const [models, setModels] = useState<OpencodeModel[] | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getSetting(OPENCODE_MODELS_KEY)
      .then((v) => {
        if (alive) setModels(parseOpencodeModels(v))
      })
      .catch(() => {
        if (alive) setModels(parseOpencodeModels(null))
      })
    return () => {
      alive = false
    }
  }, [])

  const save = useCallback((next: OpencodeModel[]): void => {
    setModels(next)
    void api.setSetting(OPENCODE_MODELS_KEY, JSON.stringify(next))
    setSavedMsg('saved — new panes use this roster')
    window.setTimeout(() => setSavedMsg(null), 2500)
  }, [])

  if (!models) return <div className="agent-note">loading models…</div>
  return (
    <div className="oc-models">
      <div className="oc-models-head">
        <span className="agent-note">Models — each row is a spawn chip</span>
        {savedMsg && <span className="oc-saved">{savedMsg}</span>}
      </div>
      {models.map((m, i) => (
        <div key={m.id} className="oc-model-row">
          <input
            className="oc-input oc-label"
            value={m.label}
            placeholder="Label"
            onChange={(e) => {
              const next = [...models]
              next[i] = { ...m, label: e.target.value }
              setModels(next)
            }}
            onBlur={() => save(models)}
          />
          <input
            className="oc-input oc-slug"
            value={m.model}
            placeholder="provider/model (opencode -m slug)"
            onChange={(e) => {
              const next = [...models]
              next[i] = { ...m, model: e.target.value }
              setModels(next)
            }}
            onBlur={() => save(models)}
          />
          <button
            className="agent-row-btn"
            title="Remove this model"
            onClick={() => save(models.filter((x) => x.id !== m.id))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="layout-btn"
        onClick={() => {
          const label = `Model ${models.length + 1}`
          save([...models, { id: opencodeIdFor(`${label}-${Date.now() % 10000}`), label, model: '' }])
        }}
      >
        + Add model
      </button>
      <div className="agent-note">
        Slugs are opencode&apos;s <code>provider/model</code> ids (see <code>opencode models</code> in a pane). The
        provider must be signed in (Log in above) or opencode falls back to its default model.
      </div>
    </div>
  )
}

/**
 * Role→model mapping: which model (and, for codex, reasoning effort) a LEAD vs a WORKER of each
 * family runs. Free-text SETTINGS, not constants, so the user can update a model without a code
 * change; new panes pick it up immediately (presets are
 * re-materialized live on save). Blank codex fields = the CLI's own default.
 */
function ModelsEditor(): React.JSX.Element {
  const ROWS: { family: ModelFamily; role: ModelRole; label: string; effort: boolean }[] = [
    { family: 'claude', role: 'lead', label: 'Claude lead', effort: false },
    { family: 'claude', role: 'worker', label: 'Claude worker', effort: false },
    { family: 'codex', role: 'lead', label: 'Codex lead', effort: true },
    { family: 'codex', role: 'worker', label: 'Codex worker', effort: true }
  ]
  const [vals, setVals] = useState<Record<string, string>>({})
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const keys = ROWS.flatMap((r) => [
      modelSettingKey(r.family, r.role),
      ...(r.effort ? [effortSettingKey(r.family, r.role)] : [])
    ])
    void Promise.all(keys.map((k) => api.getSetting(k).then((v) => [k, v ?? ''] as const))).then((pairs) => {
      if (alive) setVals(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ROWS is a render-stable literal
  }, [])

  const saveKey = (k: string, v: string): void => {
    setVals((prev) => ({ ...prev, [k]: v }))
    void api.setSetting(k, v.trim())
    setSavedMsg('saved — new panes use these models')
    window.setTimeout(() => setSavedMsg(null), 2500)
  }

  return (
    <div className="oc-models">
      <div className="oc-models-head">
        <span className="agent-note">Models — what a lead vs a worker runs (editable, survives model renames)</span>
        {savedMsg && <span className="oc-saved">{savedMsg}</span>}
      </div>
      {ROWS.map((r) => {
        const mk = modelSettingKey(r.family, r.role)
        const ek = effortSettingKey(r.family, r.role)
        return (
          <div key={mk} className="oc-model-row">
            <span className="oc-input oc-label models-role">{r.label}</span>
            <input
              className="oc-input oc-slug"
              value={vals[mk] ?? ''}
              placeholder={MODEL_DEFAULTS[mk] || 'CLI default'}
              onChange={(e) => setVals((prev) => ({ ...prev, [mk]: e.target.value }))}
              onBlur={(e) => saveKey(mk, e.target.value)}
            />
            {r.effort && (
              <input
                className="oc-input models-effort"
                value={vals[ek] ?? ''}
                placeholder="effort (e.g. ultra)"
                onChange={(e) => setVals((prev) => ({ ...prev, [ek]: e.target.value }))}
                onBlur={(e) => saveKey(ek, e.target.value)}
              />
            )}
          </div>
        )
      })}
      <div className="agent-note">
        Leads and workers can differ — e.g. Codex lead on <code>gpt-5.6-sol</code> effort <code>ultra</code>, codex
        workers on <code>xhigh</code>. Blank = the CLI&apos;s default. Applies to newly opened panes.
      </div>
    </div>
  )
}

/**
 * Account profiles: run MORE THAN ONE account of an agent. Each row = a named
 * chip in the ＋ summon picker (and a worker chip too for role 'both'), backed by an ISOLATED creds
 * dir so your main login is untouched. v1: Claude only. Empty roster = no chips (default).
 */
function AccountProfilesEditor(): React.JSX.Element {
  const [profiles, setProfiles] = useState<AgentProfile[] | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api
      .getSetting(PROFILES_KEY)
      .then((v) => alive && setProfiles(parseAgentProfiles(v)))
      .catch(() => alive && setProfiles([]))
    return () => {
      alive = false
    }
  }, [])

  const save = useCallback((next: AgentProfile[]): void => {
    setProfiles(next)
    void api.setSetting(PROFILES_KEY, JSON.stringify(next))
    setSavedMsg('saved — chips updated')
    window.setTimeout(() => setSavedMsg(null), 2500)
  }, [])

  if (!profiles) return <div className="agent-note">loading accounts…</div>
  return (
    <div className="oc-models">
      <div className="oc-models-head">
        <span className="agent-note">Extra Claude accounts — each becomes a named chip</span>
        {savedMsg && <span className="oc-saved">{savedMsg}</span>}
      </div>
      {profiles.map((p, i) => (
        <div key={p.id} className="oc-model-row">
          <input
            className="oc-input oc-label"
            value={p.label}
            placeholder="Name (e.g. Work Claude)"
            onChange={(e) => {
              const next = [...profiles]
              next[i] = { ...p, label: e.target.value }
              setProfiles(next)
            }}
            onBlur={() => save(profiles)}
          />
          <select
            className="oc-input oc-slug"
            value={p.role}
            onChange={(e) => {
              const next = [...profiles]
              next[i] = { ...p, role: e.target.value as ProfileRole }
              save(next)
            }}
          >
            <option value="orchestrator">Orchestrator only</option>
            <option value="both">Orchestrator + worker</option>
          </select>
          <button
            className="agent-row-btn"
            title="Remove this account"
            onClick={() => save(profiles.filter((x) => x.id !== p.id))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="layout-btn"
        onClick={() =>
          save([
            ...profiles,
            { id: newProfileId(), agentId: 'claude', label: `Claude ${profiles.length + 1}`, role: 'orchestrator' }
          ])
        }
      >
        + Add account
      </button>
      <div className="agent-note">Account entries materialize isolated orchestrator and worker presets.</div>
    </div>
  )
}

/** Settings → Agents roster for model roles, account profiles, and custom agent presets. */
export function AgentsSection(): React.JSX.Element {
  return (
    <section className="settings-section">
      <div className="settings-label">Agent roster</div>
      <div className="settings-desc">
        Configure the model roles and preset chips used for new terminal sessions. Authentication remains BYOK in each
        vendor CLI.
      </div>
      <ModelsEditor />
      <div className="agents-grid">
        <OpencodeModelsEditor />
        <AccountProfilesEditor />
        <CustomAgentsEditor />
      </div>
    </section>
  )
}
