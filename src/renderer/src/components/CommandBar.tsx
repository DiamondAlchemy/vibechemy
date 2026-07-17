import React, { useEffect, useState } from 'react'
import { groupOrchestratorFamilies } from '@shared/agents/families'
import type { Preset } from '@shared/types'
import { api } from '../api'

export function CommandBar({ projectId, onRan }: { projectId: string | null; onRan: () => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [openFamily, setOpenFamily] = useState<string | null>(null) // one expanded family chip at a time
  const [agentsOpen, setAgentsOpen] = useState(false) // the Agents bubble: all agent chips collapse behind it
  const [isolate, setIsolate] = useState(!!projectId)
  const [lastProject, setLastProject] = useState(projectId)
  const [error, setError] = useState<string | null>(null)

  if (projectId !== lastProject) {
    setLastProject(projectId)
    setIsolate(!!projectId)
  }

  useEffect(() => {
    void api.listPresets().then(setPresets)
  }, [])

  const spawn = async (presetId: string): Promise<void> => {
    try {
      await api.spawnSession(presetId, projectId, isolate)
      setValue('')
      setError(null)
      onRan()
    } catch (spawnError) {
      setError((spawnError as Error).message.replace(/^Error:\s*/, ''))
    }
  }

  const query = value.trim().toLowerCase()
  const workers = presets.filter((preset) => !preset.isOrchestrator && preset.id !== 'shell')
  const matches = query
    ? workers.filter((preset) =>
        [preset.id, preset.name, preset.command].some((candidate) => candidate.toLowerCase().includes(query))
      )
    : workers
  const families = groupOrchestratorFamilies(matches)

  const submit = (): void => {
    const exact = workers.find(
      (preset) => preset.id.toLowerCase() === query || preset.name.toLowerCase() === query
    )
    const selected = exact ?? (matches.length === 1 ? matches[0] : null)
    if (!query) {
      setAgentsOpen(true)
      setError('Choose an agent to spawn.')
      return
    }
    if (!selected) {
      setAgentsOpen(true)
      setError(matches.length ? 'Choose one matching agent.' : `No spawnable agent matches “${value.trim()}”.`)
      return
    }
    void spawn(selected.id)
  }

  return (
    <>
      <div className="cmdbar">
        <div className="cmd-input">
          <span className="ps1">❯</span>
          <input
            placeholder="find an agent…"
            title="Filter by agent name, command, or preset id; press Enter to spawn a unique match"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
              if (e.target.value.trim()) setAgentsOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>
        <div className="chips">
          {/* Two bubbles keep the bar clean: Shell | Agents. The Agents bubble expands to the
              family-grouped agent chips through the same shared seam as the orchestrator picker;
              the input selects a preset and every launch stays on the typed spawnSession path. */}
          {presets.some((preset) => preset.id === 'shell') && (
            <button className="chip" onClick={() => void spawn('shell')}>
              <span
                className="cdot"
                style={{ background: presets.find((preset) => preset.id === 'shell')?.color ?? 'var(--text-dim)' }}
              />
              Shell
            </button>
          )}
          <button
            className={'chip chip-family' + (agentsOpen ? ' open' : '')}
            aria-expanded={agentsOpen}
            title="The spawnable agent fleet"
            onClick={() =>
              setAgentsOpen((open) => {
                if (open) setOpenFamily(null)
                return !open
              })
            }
          >
            <span className="cdot" style={{ background: 'var(--accent)' }} />
            Agents
          </button>
          {agentsOpen &&
            families.map((family) =>
              family.items.length === 1 ? (
                <button
                  key={family.items[0].id}
                  className="chip chip-member"
                  onClick={() => void spawn(family.items[0].id)}
                >
                  <span className="cdot" style={{ background: family.items[0].color ?? 'var(--text-dim)' }} />
                  {family.items[0].name}
                </button>
              ) : (
                <React.Fragment key={family.command}>
                  <button
                    className={'chip chip-family chip-member' + (openFamily === family.command ? ' open' : '')}
                    aria-expanded={openFamily === family.command}
                    title={`${family.label}: ${family.items.length} variants`}
                    onClick={() => setOpenFamily((open) => (open === family.command ? null : family.command))}
                  >
                    <span className="cdot" style={{ background: family.color }} />
                    {family.label}
                    <span className="chip-count">{family.items.length}</span>
                  </button>
                  {openFamily === family.command &&
                    family.items.map((preset) => (
                      <button
                        key={preset.id}
                        className="chip chip-member"
                        onClick={() => void spawn(preset.id)}
                      >
                        <span className="cdot" style={{ background: preset.color ?? 'var(--text-dim)' }} />
                        {preset.name}
                      </button>
                    ))}
                </React.Fragment>
              )
            )}
        </div>
        <label
          className={'iso-toggle' + (isolate ? ' on' : '')}
          title="Spawn in an isolated git worktree"
          onClick={() => setIsolate((value) => !value)}
        >
          <span className="leaf">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M11 20A7 7 0 0 1 9.8 6.1C16 5 17 3 18 2c1 1 1 8-1 12a7 7 0 0 1-6 6Z" strokeLinejoin="round" />
              <path d="M2 22c1.5-2.5 3.5-4 7-5" />
            </svg>
          </span>
          Isolate
          <span className="switch">
            <span className="knob" />
          </span>
        </label>
        <button className="run-btn" onClick={submit}>
          Spawn
          <span className="ret">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 10 4 15l5 5" />
              <path d="M4 15h11a5 5 0 0 0 5-5V4" />
            </svg>
          </span>
        </button>
      </div>
      {error && <div className="cmd-err">{error}</div>}
    </>
  )
}
