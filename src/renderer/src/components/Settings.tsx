import React, { useCallback, useEffect, useState } from 'react'
import { PA_INPUT_LIMITS, PA_KEYS } from '@shared/agents/personalAgent'
import { api } from '../api'
import { AgentsSection } from './AgentsSection'

export function Settings({ onClose, projectId }: { onClose: () => void; projectId?: string | null }): React.JSX.Element {
  const [personalAgent, setPersonalAgent] = useState({ label: '', command: '', args: '' })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      api.getSetting(PA_KEYS.label).catch(() => null),
      api.getSetting(PA_KEYS.command).catch(() => null),
      api.getSetting(PA_KEYS.args).catch(() => null)
    ]).then(([label, command, args]) => {
      if (!alive) return
      setPersonalAgent({ label: label ?? '', command: command ?? '', args: args ?? '' })
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updatePersonalAgent = useCallback((field: 'label' | 'command' | 'args', value: string) => {
    setPersonalAgent((current) => ({ ...current, [field]: value }))
    void api
      .setSetting(PA_KEYS[field], value)
      .catch((error) => console.error('[settings] personal agent save failed', error))
  }, [])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-head">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" title="Close settings" onClick={onClose}>
            ×
          </button>
        </div>

        <AgentsSection projectId={projectId ?? null} />

        <section className="settings-section">
          <div className="settings-label">Personal agent</div>
          <div className="settings-desc">Your PA agent CLI — summoned from the dock and used for day handoffs.</div>
          {!loaded ? (
            <div className="settings-desc">Loading…</div>
          ) : (
            <>
              <div className="settings-row">
                <span className="settings-field-label">Label</span>
                <input
                  className="settings-select"
                  value={personalAgent.label}
                  maxLength={PA_INPUT_LIMITS.label}
                  placeholder="Defaults to Personal Agent"
                  onChange={(event) => updatePersonalAgent('label', event.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-field-label">Command</span>
                <input
                  className="settings-select"
                  value={personalAgent.command}
                  maxLength={PA_INPUT_LIMITS.command}
                  placeholder="Path or CLI command"
                  onChange={(event) => updatePersonalAgent('command', event.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-field-label">Args</span>
                <input
                  className="settings-select"
                  value={personalAgent.args}
                  maxLength={PA_INPUT_LIMITS.args}
                  placeholder="Whitespace-separated arguments"
                  onChange={(event) => updatePersonalAgent('args', event.target.value)}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
