import React, { useCallback, useEffect, useState } from 'react'
import { PA_INPUT_LIMITS, PA_KEYS } from '@shared/agents/personalAgent'
import { BACKGROUND_MOTIONS, type BackgroundMotion } from '@shared/appearance/backgroundMotion'
import { api } from '../api'
import { AgentsSection } from './AgentsSection'
import { readLS } from '../usePaneView'
import type { VoiceStatus } from '@shared/ipc'

// Left-nav categories: one condensed pane per category instead of one long scroll. The active
// tab persists so reopening Settings lands where the user left off.
const SETTINGS_TABS = [
  {
    id: 'agents',
    label: 'Agents',
    title: 'Agents',
    sub: 'Agent CLIs on this machine — installs, models, accounts, and custom agents.'
  },
  {
    id: 'personal-agent',
    label: 'Personal Agent',
    title: 'Personal Agent',
    sub: 'Your PA agent CLI — command, label, and handoff arguments.'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    title: 'Appearance',
    sub: 'Canvas background and motion — how your workspace looks and moves.'
  },
  {
    id: 'voice',
    label: 'Voice',
    title: 'Voice',
    sub: 'Optional on-device push-to-talk dictation for terminal panes.'
  }
] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]['id']
const SETTINGS_TAB_KEY = 'vibechemy.settingsTab'
const isSettingsTab = (value: unknown): value is SettingsTab => SETTINGS_TABS.some((tab) => tab.id === value)

export function Settings({
  onClose,
  backgroundMotion,
  setBackgroundMotion,
  projectId
}: {
  onClose: () => void
  backgroundMotion: BackgroundMotion
  setBackgroundMotion: (motion: BackgroundMotion) => void
  projectId?: string | null
}): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(() => readLS<SettingsTab>(SETTINGS_TAB_KEY, 'agents', isSettingsTab))
  const pickTab = useCallback((nextTab: SettingsTab): void => {
    setTab(nextTab)
    try {
      localStorage.setItem(SETTINGS_TAB_KEY, JSON.stringify(nextTab))
    } catch {
      /* storage full/unavailable → in-memory only */
    }
  }, [])
  const [personalAgent, setPersonalAgent] = useState({ label: '', command: '', args: '' })
  const [loaded, setLoaded] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null)
  const [voiceAutoSubmit, setVoiceAutoSubmit] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null)

  const refreshVoice = useCallback(async (): Promise<void> => {
    try {
      setVoiceStatus(await api.voiceStatus())
    } catch {
      setVoiceStatus({ available: false, reason: 'Could not read voice engine status.' })
    }
  }, [])

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
    let alive = true
    void Promise.all([api.voiceStatus(), api.getSetting('voice.autoSubmit')])
      .then(([status, autoSubmit]) => {
        if (!alive) return
        setVoiceStatus(status)
        setVoiceAutoSubmit(autoSubmit === 'true')
      })
      .catch(() => {
        if (alive) setVoiceStatus({ available: false, reason: 'Could not read voice engine status.' })
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

  // Each category renders only while active; the controls keep their original labels and handlers.
  const renderAgents = (): React.JSX.Element => <AgentsSection projectId={projectId ?? null} />

  const renderPersonalAgent = (): React.JSX.Element => (
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
  )

  const renderAppearance = (): React.JSX.Element => (
    <section className="settings-section">
      <div className="settings-label">Canvas background</div>
      <div className="settings-desc">Choose how quickly live canvas backgrounds move. Changes apply instantly.</div>
      <div className="settings-row">
        <span className="settings-field-label">Motion</span>
        <div className="settings-seg" aria-label="Background motion">
          {BACKGROUND_MOTIONS.map((motion) => (
            <button
              key={motion}
              className={'settings-seg-btn' + (backgroundMotion === motion ? ' on' : '')}
              aria-pressed={backgroundMotion === motion}
              data-bg-motion-value={motion}
              onClick={() => setBackgroundMotion(motion)}
            >
              {motion.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </section>
  )

  const runVoiceDownload = async (): Promise<void> => {
    const status = voiceStatus ?? (await api.voiceStatus().catch(() => null))
    if (!status?.downloadCommand) {
      setVoiceMessage('The model download script is unavailable in this build.')
      return
    }
    try {
      const session = await api.spawnSession('shell', projectId ?? null, false, '~')
      window.setTimeout(() => void api.paneType(session.id, status.downloadCommand!, true), 800)
      setVoiceMessage('Download opened in a visible shell pane — close Settings to watch it, then refresh here.')
    } catch (error) {
      setVoiceMessage(`Could not open a download pane — ${(error as Error).message}.`)
    }
  }

  const renderVoice = (): React.JSX.Element => (
    <section className="settings-section" data-settings-section="voice">
      <div className="settings-label">On-device dictation</div>
      <div className="settings-desc">
        Hold Right-Option anywhere in Vibechemy, speak, then release. Audio is processed locally and never leaves this
        Mac.
      </div>
      <div className="settings-row">
        <span className="settings-field-label">Engine</span>
        <span className={`agent-chip ${voiceStatus?.available ? 'on' : 'off'}`} data-voice-engine-state>
          {voiceStatus === null ? 'checking…' : voiceStatus.available ? 'Parakeet ready' : 'unavailable'}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-field-label">Model</span>
        <span className={`agent-chip ${voiceStatus?.modelInstalled ? 'on' : 'off'}`} data-voice-model-state>
          {voiceStatus === null ? 'checking…' : voiceStatus.modelInstalled ? 'installed' : 'not installed'}
        </span>
        <span className="agent-note">{voiceStatus?.model ?? 'Parakeet TDT 0.6B v3'}</span>
      </div>
      {voiceStatus?.reason && <div className="settings-desc voice-reason">{voiceStatus.reason}</div>}
      {voiceMessage && <div className="agents-ranmsg">{voiceMessage}</div>}
      <div className="settings-row">
        <button className="layout-btn" onClick={() => void runVoiceDownload()}>
          Download model (~600 MB)
        </button>
        <button className="layout-btn" onClick={() => void refreshVoice()}>
          Refresh status
        </button>
      </div>
      <label className={'iso-toggle' + (voiceAutoSubmit ? ' on' : '')}>
        <input
          className="voice-toggle-input"
          type="checkbox"
          checked={voiceAutoSubmit}
          onChange={(event) => {
            const enabled = event.target.checked
            setVoiceAutoSubmit(enabled)
            void api.setSetting('voice.autoSubmit', String(enabled))
          }}
        />
        <span className="switch">
          <span className="knob" />
        </span>
        <span>Auto-submit with a separate Enter after dictation</span>
      </label>
    </section>
  )

  const active = SETTINGS_TABS.find((item) => item.id === tab) ?? SETTINGS_TABS[0]

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-head">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" title="Close settings" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings categories">
            {SETTINGS_TABS.map((item) => (
              <button
                key={item.id}
                className={'settings-nav-btn' + (tab === item.id ? ' on' : '')}
                onClick={() => pickTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-pane">
            <div className="settings-pane-head">
              <h3 className="settings-pane-title">{active.title}</h3>
              <div className="settings-pane-sub">{active.sub}</div>
            </div>
            {tab === 'agents' && renderAgents()}
            {tab === 'personal-agent' && renderPersonalAgent()}
            {tab === 'appearance' && renderAppearance()}
            {tab === 'voice' && renderVoice()}
          </div>
        </div>
      </div>
    </div>
  )
}
