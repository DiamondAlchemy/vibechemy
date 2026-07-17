import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { api } from './api'
import { tombstonesReducer } from './tombstones'
import { PaneGrid } from './components/PaneGrid'
import { FreePaneLayout } from './components/FreePaneLayout'
import { CommandBar } from './components/CommandBar'
import { Sidebar } from './components/Sidebar'
import { RightDock } from './components/RightDock'
import { SessionsPanel } from './components/SessionsPanel'
import { LayoutPicker } from './components/LayoutPicker'
import { ActivityStrip } from './components/ActivityStrip'
import { Settings } from './components/Settings'
import { layoutsFor } from './layouts'
import { usePaneView, readLS } from './usePaneView'
import { useCockpitBackground, bgFileUrl } from './useCanvasDecor'
import { useBackgroundMotion } from './useBackgroundMotion'
import { useNow } from './hooks/useNow'
import type { Preset, SessionRecord } from '@shared/types'
import { LEGACY_PERSONAL_AGENT_IDS, PERSONAL_AGENT_PRESET_ID } from '@shared/agents/personalAgent'
function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function useClock(): string {
  return fmtTime(useNow(30_000))
}

function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const cockpitBg = useCockpitBackground(currentProjectId)
  const { backgroundMotion, setBackgroundMotion } = useBackgroundMotion()
  const [projectName, setProjectName] = useState('Scratch')
  const [presets, setPresets] = useState<Preset[]>([])
  // Workers explicitly promoted into the dock. Persisted so a restart/deploy no longer silently
  // demotes them back to the grid (stale ids for gone sessions are inert — the orchestrator filter
  // only matches live sessions).
  const [leadIds, setLeadIds] = useState<string[]>(() =>
    readLS<string[]>('mc.leadIds', [], (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'))
  )
  const [activeOrchId, setActiveOrchId] = useState<string | null>(null) // which dock tab is shown
  const [hiddenIds, setHiddenIds] = useState<string[]>([]) // worker panes hidden from the grid (tmux stays alive → reopenable)
  const [sessionsOpen, setSessionsOpen] = useState(false) // the Sessions popover
  const [settingsOpen, setSettingsOpen] = useState(false) // the Settings modal
  // Worker-grid layout id; null = auto grid, 'free' = the freeform canvas. Persisted so the choice
  // survives restarts.
  const [selectedLayout, setSelectedLayout] = useState<string | null>(() =>
    readLS<string | null>('mc.layout', 'free', (v): v is string | null => v === null || typeof v === 'string')
  )
  useEffect(() => {
    try {
      localStorage.setItem('mc.layout', JSON.stringify(selectedLayout))
    } catch {
      /* storage full/unavailable → in-memory only */
    }
  }, [selectedLayout])
  const [leftovers, setLeftovers] = useState<SessionRecord[]>([]) // ended isolated worktrees still on disk (cleanup)
  // Panes whose CLI exited UNEXPECTEDLY this run — kept visible as revivable tombstones
  // (deliberate closes never land here; see SessionExitEvent.expected).
  const [tombstones, dispatchTombstone] = useReducer(tombstonesReducer, [])
  const sessionsRef = useRef<SessionRecord[]>([]) // sync snapshot for the exit handler
  const time = useClock()
  // Control-section pin: the whole [workspaces + orchestrator] sidebar locks left (default),
  // right (in-flow, canvas fills the left), or center — the huge-monitor mode (section floats
  // dead-center, canvas work flanks it on both sides). Persisted per machine.
  const [orchPin, setOrchPin] = useState<'left' | 'center' | 'right'>(() =>
    readLS<'left' | 'center' | 'right'>(
      'mc.orchpin',
      'left',
      (v): v is 'left' | 'center' | 'right' => v === 'left' || v === 'center' || v === 'right'
    )
  )
  const setPin = useCallback((p: 'left' | 'center' | 'right') => {
    setOrchPin(p)
    localStorage.setItem('mc.orchpin', JSON.stringify(p))
  }, [])
  // The docked column's DOM element, measured by the free canvas so panes never rest hidden
  // behind it (the pin-center column floats near-opaque OVER the board).
  const dockColumnRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem('mc.leadIds', JSON.stringify(leadIds))
    } catch {
      /* storage full/unavailable → in-memory only */
    }
  }, [leadIds])
  // Per-pane grid order + accent colors (localStorage-backed view state).
  const { reconcile, orderedShown, colorFor, swap, setColor, forget } = usePaneView()
  useEffect(() => {
    api.listPresets().then(setPresets)
  }, [])

  // Agent-CLI availability on THIS machine (Agents roster): drives the first-run banner.
  // Re-probed when Settings closes so an install/login done there flips state without a restart.
  const [noAgents, setNoAgents] = useState(false)
  useEffect(() => {
    if (settingsOpen) return
    void api
      .agentsStatus()
      .then((rows) => setNoAgents(rows.length > 0 && rows.every((r) => !r.installed)))
      .catch(() => {})
  }, [settingsOpen])

  const refresh = useCallback(
    () =>
      api.listSessions(currentProjectId).then((s) => {
        reconcile(s) // assign order slot + color to any new pane before it renders
        setSessions(s)
        sessionsRef.current = s
      }),
    [currentProjectId, reconcile]
  )

  useEffect(() => {
    refresh()
    const offExit = api.onExit((ev) => {
      if (!ev.expected) {
        // The CLI died on its own (Esc mishap / crash) — keep the pane as a revivable
        // tombstone instead of letting it silently vanish. If the preset's CLI isn't
        // even installed (fresh machine), say THAT instead of offering a revive that
        // can only fail again.
        const rec = sessionsRef.current.find((s) => s.id === ev.id)
        if (rec)
          dispatchTombstone({
            type: 'exited',
            session: rec,
            at: Date.now(),
            missingCli: false
          })
      }
      setHiddenIds((h) => h.filter((x) => x !== ev.id)) // a now-ended session can't be "hidden" — drop it
      forget(ev.id) // drop its grid slot + color so the view-state maps don't accumulate dead ids
      refresh()
    })
    const offChanged = api.onMcEvent((e) => {
      if (e.kind === 'sessions') refresh() // MCP-spawned workers → refresh so their panes appear
      if (e.kind === 'presets') void api.listPresets().then(setPresets) // opencode roster edits
    })
    return () => {
      offExit()
      offChanged()
    }
  }, [refresh, forget])

  const latestProjectId = useRef<string | null>(null)
  const selectProject = useCallback(async (id: string | null, name: string) => {
    latestProjectId.current = id
    if (id) await api.openProject(id) // reconcile that project's sessions before showing them
    if (latestProjectId.current === id) {
      // ignore stale rapid-click responses
      setCurrentProjectId(id)
      setProjectName(name)
    }
  }, [])

  // Restore the last-selected project after reload (the renderer resets to Scratch otherwise).
  useEffect(() => {
    const stored = readLS<{ id: string; name: string } | null>(
      'mc.project',
      null,
      (v): v is { id: string; name: string } | null =>
        v === null ||
        (typeof v === 'object' &&
          v !== null &&
          typeof (v as { id?: unknown }).id === 'string' &&
          typeof (v as { name?: unknown }).name === 'string')
    )
    if (stored) void selectProject(stored.id, stored.name).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(
        'mc.project',
        JSON.stringify(currentProjectId ? { id: currentProjectId, name: projectName } : null)
      )
    } catch {
      /* storage full/unavailable → in-memory only */
    }
  }, [currentProjectId, projectName])

  // Orchestrators live in the left-rail dock as tabs; everything else tiles in the grid.
  // A session is an orchestrator if its preset is one (Claude/Codex/personal agent…) OR it was
  // explicitly promoted from the grid (⇤). You can keep several leads and switch tabs.
  const orchPresetIds = useMemo(() => {
    const ids = new Set(presets.filter((p) => p.isOrchestrator && !p.comingSoon).map((p) => p.id))
    if (ids.has(PERSONAL_AGENT_PRESET_ID)) {
      for (const id of LEGACY_PERSONAL_AGENT_IDS) ids.add(id)
    }
    return ids
  }, [presets])
  const orchestrators = sessions.filter((s) => orchPresetIds.has(s.presetId) || leadIds.includes(s.id))
  const activeOrch = orchestrators.find((s) => s.id === activeOrchId) ?? orchestrators[orchestrators.length - 1] ?? null
  const workers = sessions.filter((s) => !orchestrators.some((o) => o.id === s.id))
  // Tombstones partition like live sessions (orchestrator presets → dock, rest → grid),
  // scoped to the current project so a workspace switch doesn't drag them along.
  const projectTombstones = tombstones.filter((t) => (t.session.projectId ?? null) === (currentProjectId ?? null))
  const orchTombstones = projectTombstones.filter((t) => orchPresetIds.has(t.session.presetId))
  const workerTombstones = projectTombstones.filter((t) => !orchPresetIds.has(t.session.presetId))
  // Hiding a worker pane just drops it from the grid — its TerminalPane unmounts, which
  // detaches the pty viewer while the tmux session keeps running, so "Show" reattaches it.
  const shownWorkers = workers.filter((w) => !hiddenIds.includes(w.id))
  const hiddenWorkers = workers.filter((w) => hiddenIds.includes(w.id))
  const freeMode = selectedLayout === 'free'
  // Resolve the chosen TEMPLATE layout (Free and Auto are not templates). Falls back to Auto.
  const activeLayout =
    selectedLayout && !freeMode ? (layoutsFor(shownWorkers.length).find((l) => l.id === selectedLayout) ?? null) : null
  // Panes laid out in the user's chosen order (drag-to-reorder); keyed by id so reordering
  // relocates a pane without remounting its terminal.
  const gridSessions = orderedShown(shownWorkers)

  const hideSession = useCallback((id: string) => setHiddenIds((h) => (h.includes(id) ? h : [...h, id])), [])
  const showSession = useCallback((id: string) => setHiddenIds((h) => h.filter((x) => x !== id)), [])

  const endSession = useCallback((id: string) => {
    setHiddenIds((h) => h.filter((x) => x !== id))
    void api.killSession(id) // actually end it (onExit refresh drops it from the list)
  }, [])

  // Revive a tombstone: respawn the dead pane in place (claude CLIs land in the /resume picker).
  const reviveTombstone = useCallback(
    (id: string) => {
      dispatchTombstone({ type: 'reviveStart', id })
      void api
        .reviveSession(id)
        .then((r) => {
          if (r.ok) {
            dispatchTombstone({ type: 'reviveOk', id })
            refresh()
          } else {
            dispatchTombstone({ type: 'reviveFailed', id, message: r.message ?? 'revive failed' })
          }
        })
        .catch((err) => dispatchTombstone({ type: 'reviveFailed', id, message: String(err) }))
    },
    [refresh]
  )
  const dismissTombstone = useCallback((id: string) => dispatchTombstone({ type: 'dismiss', id }), [])
  const presetLabel = useCallback(
    (pid: string): string =>
      presets.find((p) => p.id === pid)?.name ??
      (LEGACY_PERSONAL_AGENT_IDS.some((id) => id === pid)
        ? presets.find((p) => p.id === PERSONAL_AGENT_PRESET_ID)?.name
        : undefined) ??
      pid,
    [presets]
  )

  // Leftover worktrees (ended sessions whose worktree is still on disk) — fetched lazily
  // when the Sessions panel opens (and after a cleanup), so the user can reclaim that space.
  const refreshLeftovers = useCallback(() => {
    const pid = currentProjectId
    return api.listLeftovers(pid).then((rows) => {
      if (latestProjectId.current === pid) setLeftovers(rows) // ignore a response that landed after a project switch
    })
  }, [currentProjectId])
  useEffect(() => {
    if (sessionsOpen) refreshLeftovers()
  }, [sessionsOpen, refreshLeftovers])
  const mergeLeftover = useCallback(
    async (id: string) => {
      await api.sessionMerge(id)
      await refreshLeftovers()
      refresh()
    },
    [refreshLeftovers, refresh]
  )
  const discardLeftover = useCallback(
    async (id: string) => {
      // Always re-sync the list afterward, even if discard throws — a silently-swallowed
      // failure would otherwise leave the row looking un-discardable.
      try {
        await api.sessionDiscard(id)
      } catch (e) {
        console.error('[discard] failed for', id, e)
      } finally {
        await refreshLeftovers()
        refresh()
      }
    },
    [refreshLeftovers, refresh]
  )

  const makeLead = useCallback((id: string) => {
    setLeadIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setActiveOrchId(id)
  }, [])

  // Closing a dock tab: a summoned orchestrator preset is killed; a promoted worker is
  // just demoted back to the grid (kept alive). If we closed the active tab, fall to a
  // sibling tab (or the empty state if it was the last one).
  const closeOrch = useCallback(
    (s: SessionRecord) => {
      if (orchPresetIds.has(s.presetId)) void api.killSession(s.id)
      else setLeadIds((prev) => prev.filter((x) => x !== s.id))
      setActiveOrchId((cur) => {
        if (cur !== s.id) return cur
        const rest = orchestrators.filter((o) => o.id !== s.id)
        return rest.length ? rest[rest.length - 1].id : null
      })
    },
    [orchPresetIds, orchestrators]
  )

  const summonOrch = useCallback(
    async (presetId: string) => {
      const spawned = await api.spawnSession(presetId, currentProjectId, false)
      await refresh() // ensure the new session is in `sessions` before we activate its tab (no wrong-tab flash)
      setActiveOrchId(spawned.id)
    },
    [currentProjectId, refresh]
  )

  // End-of-day hand-off: ping a running personal agent (or summon one in oversight mode) to pull
  // the day digest and update its memory; surface its tab so you can watch it absorb the update.
  const handDayToPersonalAgent = useCallback(async () => {
    try {
      const res = await api.handoffToPersonalAgent(currentProjectId)
      if (!res?.ok) return
      await refresh()
      if (res.sessionId) setActiveOrchId(res.sessionId)
    } catch {
      /* handoff failed (e.g. spawn error) — best-effort; the user can retry */
    }
  }, [currentProjectId, refresh])

  const count = sessions.length
  const plural = count === 1 ? '' : 's'

  return (
    <div className="app">
      <div
        className="app-cockpit-background"
        data-bg={cockpitBg.bg}
        data-motion={backgroundMotion}
        aria-hidden
        style={
          cockpitBg.bg === 'image' && cockpitBg.bgImage
            ? { backgroundImage: `url("${bgFileUrl(cockpitBg.bgImage)}")` }
            : undefined
        }
      >
        {cockpitBg.bg === 'starfield' && <div className="app-starfield-depth" />}
      </div>
      <header className="titlebar">
        <div className="brand">
          <span className="logo-glyph">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            </svg>
          </span>
          <span className="wordmark">Vibechemy</span>
          {/* TODO: read from app.getVersion() (IPC handler + preload method) instead of hardcoding */}
          <span className="ver">v0.1</span>
        </div>

        <div className="center">
          <ActivityStrip />
        </div>

        <div className="right">
          <LayoutPicker n={shownWorkers.length} selected={selectedLayout} onSelect={setSelectedLayout} />
          <button
            data-sessions-toggle
            className={'sessions-stat' + (sessionsOpen ? ' on' : '')}
            title="Sessions — show, hide, or end your terminals"
            onClick={() => setSessionsOpen((v) => !v)}
          >
            <b>{count}</b> session{plural}
            {hiddenWorkers.length > 0 && <span className="hidden-pill">{hiddenWorkers.length} hidden</span>}
            <svg
              className="stat-caret"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="icon-btns">
            <button
              className="icon-btn handoff-personal-agent"
              title="Hand today's digest to your personal agent to update its memory (oversight, read-only)"
              onClick={handDayToPersonalAgent}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            </button>
            <button
              data-sessions-toggle
              className={'icon-btn' + (sessionsOpen ? ' on' : '')}
              title="Sessions — show, hide, or end your terminals"
              onClick={() => setSessionsOpen((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="4" y="4" width="7" height="7" rx="1.4" />
                <rect x="13" y="4" width="7" height="7" rx="1.4" />
                <rect x="4" y="13" width="7" height="7" rx="1.4" />
                <rect x="13" y="13" width="7" height="7" rx="1.4" />
              </svg>
            </button>
            <button
              className={'icon-btn' + (settingsOpen ? ' on' : '')}
              title="Settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {noAgents && (
        <div className="agents-banner">
          No agent CLIs are installed on this machine yet — spawn chips will fail until one is set up.
          <button className="layout-btn" onClick={() => setSettingsOpen(true)}>
            Set up in Settings → Agents
          </button>
        </div>
      )}

      {sessionsOpen && (
        <SessionsPanel
          shown={shownWorkers}
          hidden={hiddenWorkers}
          leftovers={leftovers}
          presets={presets}
          onShow={showSession}
          onHide={hideSession}
          onEnd={endSession}
          onMerge={mergeLeftover}
          onDiscard={discardLeftover}
          onClose={() => setSessionsOpen(false)}
        />
      )}

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          backgroundMotion={backgroundMotion}
          setBackgroundMotion={setBackgroundMotion}
          projectId={currentProjectId}
        />
      )}

      <div className="body">
        <Sidebar
          currentProjectId={currentProjectId}
          onSelect={selectProject}
          orchestrators={orchestrators}
          activeOrch={activeOrch}
          leadIds={leadIds}
          presets={presets}
          onSelectOrch={setActiveOrchId}
          onCloseOrch={closeOrch}
          onSummon={summonOrch}
          tombstones={orchTombstones}
          presetLabel={presetLabel}
          onReviveTombstone={reviveTombstone}
          onDismissTombstone={dismissTombstone}
          pin={orchPin}
          onSetPin={setPin}
          measureRef={dockColumnRef}
        />
        <main className="main">
          {freeMode ? (
            <FreePaneLayout
              sessions={gridSessions}
              projectId={currentProjectId}
              active={!settingsOpen}
              colorFor={colorFor}
              onMakeLead={makeLead}
              onEnd={endSession}
              onHide={hideSession}
              onSetColor={setColor}
              tombstones={workerTombstones}
              presetLabel={presetLabel}
              onReviveTombstone={reviveTombstone}
              onDismissTombstone={dismissTombstone}
              orchPin={orchPin}
              dockColumnRef={dockColumnRef}
            />
          ) : (
            <PaneGrid
              sessions={gridSessions}
              onMakeLead={makeLead}
              onEnd={endSession}
              onHide={hideSession}
              layout={activeLayout}
              colorFor={colorFor}
              onReorder={swap}
              onSetColor={setColor}
              tombstones={workerTombstones}
              presetLabel={presetLabel}
              onReviveTombstone={reviveTombstone}
              onDismissTombstone={dismissTombstone}
            />
          )}
          <CommandBar projectId={currentProjectId} onRan={refresh} />
        </main>
        <RightDock projectId={currentProjectId} side={orchPin === 'left' ? 'right' : 'left'} />
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <span className="status-item">
            <span className="ready-dot" />
            <span className="phosphor-green">ready</span>
          </span>
          <span className="vsep" />
          <span className="status-item">
            <b>{projectName}</b>
          </span>
        </div>
        <div className="status-right">
          <span className="status-item">
            {count} active session{plural}
          </span>
          <span className="vsep" />
          <span className="status-item">BYOK</span>
          <span className="vsep" />
          <span className="status-item time">{time}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
