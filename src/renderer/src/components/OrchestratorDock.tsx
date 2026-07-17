import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { TerminalPane } from './TerminalPane'
import { TombstonePane } from './TombstonePane'
import type { Preset, SessionRecord } from '@shared/types'
import type { Tombstone } from '../tombstones'
import { groupOrchestratorFamilies } from '@shared/agents/families'
import { LEGACY_PERSONAL_AGENT_IDS, PERSONAL_AGENT_PRESET_ID } from '@shared/agents/personalAgent'
import { useDragAffordanceClear } from '../hooks/useDragAffordanceClear'
import { PRODUCT_IDENTITY } from '@shared/product'

function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * The left-rail orchestrator dock: a tabbed home for your "leads". Each tab is one
 * orchestrator (Claude / Codex / a personal agent / a promoted worker); switch tabs to change who
 * you're talking to. Summon more from the ＋ picker — so if one runs out of credits you
 * spin up another to review and ship. Dragging a worker pane here hands it to the active tab.
 */
export function OrchestratorDock({
  orchestrators,
  activeOrch,
  leadIds,
  presets,
  onSelectOrch,
  onCloseOrch,
  onSummon,
  tombstones = [],
  presetLabel = (pid) => pid,
  onReviveTombstone = () => {},
  onDismissTombstone = () => {},
  pin = 'left',
  onSetPin
}: {
  orchestrators: SessionRecord[]
  activeOrch: SessionRecord | null
  leadIds: string[]
  presets: Preset[]
  onSelectOrch: (id: string) => void
  onCloseOrch: (s: SessionRecord) => void
  onSummon: (presetId: string) => void
  tombstones?: Tombstone[] // unexpectedly-exited leads — revivable ⏻ tabs
  presetLabel?: (presetId: string) => string
  onReviveTombstone?: (id: string) => void
  onDismissTombstone?: (id: string) => void
  /** Where the orchestrator column is pinned: in the sidebar (left) or floating center/right —
   *  a huge-monitor affordance that centers the lead with work on both sides. */
  pin?: 'left' | 'center' | 'right'
  onSetPin?: (p: 'left' | 'center' | 'right') => void
}): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  // Family accordion state: multi-variant families (Claude accounts,
  // OpenCode models) collapse under one row; this tracks which are expanded. Reset on menu close.
  const [openFams, setOpenFams] = useState<string[]>([])
  // A selected tombstone tab (⏻). Live-tab selection stays App-owned (activeOrch);
  // an explicit tombstone click overrides it until the tombstone resolves or a live tab is picked.
  const [tombTabId, setTombTabId] = useState<string | null>(null)
  const activeTomb =
    tombstones.find((t) => t.session.id === tombTabId) ??
    // with no live lead, surface the newest tombstone so a dead orchestrator is impossible to miss
    (orchestrators.length === 0 && tombstones.length > 0 ? tombstones[tombstones.length - 1] : null)

  // Recently-closed orchestrators you can one-click reopen — respawns the pane (restoring its
  // product MCP tools) and resumes the conversation. Collapsed into a single "↩ Reopen (N)" tray so
  // the tab strip stays clean; refetched when the live-lead set changes, so a reopened one drops off.
  const [closed, setClosed] = useState<SessionRecord[]>([])
  const [closedAt, setClosedAt] = useState(0) // clock snapshot → pure "ago" labels (no Date.now in render)
  const [trayOpen, setTrayOpen] = useState(false)
  const trayRef = useRef<HTMLDivElement>(null)
  const refreshClosed = useCallback((): void => {
    void api.orchestratorsClosed().then((rows) => {
      setClosed(rows)
      setClosedAt(Date.now())
    })
  }, [])
  useEffect(() => {
    refreshClosed()
  }, [orchestrators.length, refreshClosed])
  const reopen = (id: string): void => {
    setTrayOpen(false)
    void api.reopenOrchestrator(id).then((r) => {
      if (!r.ok) window.alert(`Reopen failed: ${r.message ?? 'unknown'}`)
      refreshClosed()
    })
  }
  const dismissClosed = (id: string): void => {
    void api.dismissClosedOrchestrator(id).then(refreshClosed)
  }
  // Close the reopen tray on an outside click (mirrors the summon picker).
  useEffect(() => {
    if (!trayOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (trayRef.current && !trayRef.current.contains(e.target as Node)) setTrayOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [trayOpen])
  const [dropActive, setDropActive] = useState(false)
  // Same stuck-affordance guard as the Sidebar: dragleave alone is unreliable, and dragend fires
  // on the drag SOURCE (another app for Finder/screenshot drags — this window never sees it). The
  // shared hook also clears on capture-phase drop + buttons-free mousemove.
  const clearDropActive = useCallback((): void => setDropActive(false), [])
  useDragAffordanceClear(dropActive, clearDropActive)
  const [handoff, setHandoff] = useState<Array<{ id: string; label: string; branch: string }>>([])
  const [handoffText, setHandoffText] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  const presetById = new Map(presets.map((p) => [p.id, p]))
  const personalAgent = presetById.get(PERSONAL_AGENT_PRESET_ID)
  if (personalAgent) {
    for (const id of LEGACY_PERSONAL_AGENT_IDS) presetById.set(id, personalAgent)
  }
  // Once named Claude account profiles exist, the generic seed Claude/Fable orchestrator chips hide
  // from the picker — the accounts take over the
  // family (role decides the model). Delete all profiles and the seeds return.
  const hasClaudeAccounts = presets.some((p) => p.id.startsWith('profile-') && p.isOrchestrator)
  const summonable = presets.filter(
    (p) =>
      p.isOrchestrator &&
      !p.comingSoon &&
      !(hasClaudeAccounts && (p.id === 'orchestrator' || p.id === 'orchestrator-fable'))
  )
  const tabLabel = (s: SessionRecord): string => presetById.get(s.presetId)?.name ?? s.presetId
  const tabColor = (s: SessionRecord): string => presetById.get(s.presetId)?.color ?? '#8b8b8b'
  // the working folder's basename — what disambiguates two closed "Claude" orchestras in the tray.
  const folderName = (s: SessionRecord): string => s.cwd.split('/').filter(Boolean).pop() ?? s.cwd

  // Close the picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  // Guard the DESTRUCTIVE orchestrator close (the ✕ that kills the terminal). You keep hitting it by
  // accident; returning a promoted worker to the grid stays one click (non-destructive, no prompt).
  const confirmOrchClose = (): boolean =>
    window.confirm(
      'Close this orchestrator?\n\nThe terminal will close. Its conversation is saved on disk — you can resume it later (codex resume / claude /resume).'
    )

  const sendHandoff = (): void => {
    if (!activeOrch || handoff.length === 0) return
    const list = handoff.map((w) => `"${w.id}"${w.branch ? ` [${w.branch}]` : ''} (${w.label})`).join(', ')
    const ask =
      handoffText.trim() ||
      (handoff.length > 1
        ? 'Compare them: for each, run get_diff + read_output (and run_check if useful), then tell me how they differ and which to keep.'
        : 'Review it: run get_diff and read_output on it, then tell me what it did and what is left.')
    const noun = handoff.length === 1 ? 'Worker' : `${handoff.length} workers`
    const msg = `[Handoff from Vibechemy] ${noun}: ${list}. ${ask}`
    // Route through paneType (tmux send-keys: type → 300ms pause → discrete Enter), NOT a raw
    // api.write(msg + '\r'): a text+Enter burst trips the CLI's paste heuristic and the Enter folds
    // into the paste, so the prompt stages but never submits without a separate Enter.
    void api.paneType(activeOrch.id, msg, true)
    setHandoff([])
    setHandoffText('')
  }

  return (
    <div
      className={'side-orch' + (dropActive ? ' drop-active' : '')}
      onDragOver={(e) => {
        if (activeOrch && e.dataTransfer.types.includes('application/mc-handoff')) {
          e.preventDefault()
          setDropActive(true)
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
        const raw = e.dataTransfer.getData('application/mc-handoff')
        if (!raw || !activeOrch) return
        try {
          const w = JSON.parse(raw) as { id: string; label: string; branch: string }
          if (w.id === activeOrch.id) return // can't hand a lead to itself
          // Accumulate: dropping more workers ADDS them (dedup by id) rather than replacing.
          setHandoff((prev) => (prev.some((x) => x.id === w.id) ? prev : [...prev, w]))
        } catch {
          /* ignore malformed drop */
        }
      }}
    >
      <div className="orch-bar">
        <div className="orch-tabs">
          {orchestrators.map((s) => {
            const promoted = leadIds.includes(s.id) // a worker elevated via ⇤, not a summoned lead
            return (
              <button
                key={s.id}
                className={'orch-tab' + (activeOrch?.id === s.id && !activeTomb ? ' active' : '')}
                title={tabLabel(s)}
                onClick={() => {
                  setTombTabId(null) // a live tab click always leaves the tombstone view
                  onSelectOrch(s.id)
                }}
              >
                <span className="sdot" style={{ background: tabColor(s) }} />
                <span className="orch-tab-name">{tabLabel(s)}</span>
                <span
                  className="orch-tab-x"
                  title={promoted ? 'Return this worker to the grid' : 'Close this orchestrator'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!promoted && !confirmOrchClose()) return // guard the kill, not the demote
                    onCloseOrch(s)
                  }}
                >
                  {promoted ? (
                    // chevron back out to the grid (demote, keeps the worker alive)
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 6l6 6-6 6" strokeLinejoin="round" strokeLinecap="round" />
                      <path d="M19 5v14" strokeLinecap="round" />
                    </svg>
                  ) : (
                    // ✕ closes (kills) a summoned orchestrator
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  )}
                </span>
              </button>
            )
          })}
          {tombstones.map((t) => (
            // A dead lead's tab persists as ⏻ until revived or dismissed — an Esc mishap
            // in the orchestrator can no longer silently evaporate it.
            <button
              key={t.session.id}
              className={'orch-tab tomb' + (activeTomb?.session.id === t.session.id ? ' active' : '')}
              title={`${presetLabel(t.session.presetId)} — exited, revivable`}
              onClick={() => setTombTabId(t.session.id)}
            >
              <span className="sdot" style={{ background: 'var(--amber)' }} />
              <span className="orch-tab-name">⏻ {presetLabel(t.session.presetId)}</span>
            </button>
          ))}
        </div>
        {closed.length > 0 && (
          // Recently-CLOSED orchestrators, collapsed into one tray (kept OUTSIDE .orch-tabs, whose
          // overflow-x would clip the drop-down). A row respawns its agent (restoring the product MCP
          // tools) and resumes the conversation — /resume for Claude, `codex resume` for Codex. The
          // ✕ banishes a slot without reopening it.
          <div className="orch-reopen" ref={trayRef}>
            <button
              className={'orch-tab reopen' + (trayOpen ? ' on' : '')}
              title="Reopen a recently closed orchestrator"
              onClick={() => setTrayOpen((v) => !v)}
            >
              <span className="orch-tab-name">↩ Reopen ({closed.length})</span>
            </button>
            {trayOpen && (
              <div className="orch-reopen-menu">
                <div className="orch-reopen-head">Recently closed</div>
                {closed.map((s) => (
                  <div key={`reopen-${s.id}`} className="orch-reopen-row">
                    <button
                      className="orch-reopen-open"
                      title={`Reopen ${tabLabel(s)} in ${folderName(s)} — respawns it and resumes the conversation`}
                      onClick={() => reopen(s.id)}
                    >
                      <span className="sdot" style={{ background: tabColor(s) }} />
                      <span className="orch-reopen-agent">{tabLabel(s)}</span>
                      <span className="orch-reopen-folder">{folderName(s)}</span>
                      <span className="orch-reopen-ago">{formatAgo(s.lastSeenAt, closedAt)}</span>
                    </button>
                    <button
                      className="orch-reopen-x"
                      title="Remove from this list (won't reopen it)"
                      onClick={() => dismissClosed(s.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {onSetPin && (
          <div className="orch-pinbtns">
            {(['left', 'center', 'right'] as const).map((p) => (
              <button
                key={p}
                className={'orch-pinbtn' + (pin === p ? ' on' : '')}
                title={p === 'left' ? 'Dock in the sidebar' : `Pin the orchestrator column ${p}`}
                onClick={() => onSetPin(p)}
              >
                {p === 'left' ? '◧' : p === 'center' ? '▣' : '◨'}
              </button>
            ))}
          </div>
        )}
        <div className="orch-picker" ref={pickerRef}>
          <button
            className={'orch-summon' + (pickerOpen ? ' on' : '')}
            title="Summon an orchestrator"
            onClick={() => setPickerOpen((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
          {pickerOpen && (
            <div className="orch-menu">
              <div className="orch-menu-head">Summon orchestrator</div>
              {groupOrchestratorFamilies(summonable).map((fam) =>
                fam.items.length === 1 ? (
                  // Single-variant family — plain one-click row, exactly as before.
                  <button
                    key={fam.items[0].id}
                    className="orch-menu-item"
                    onClick={() => {
                      onSummon(fam.items[0].id)
                      setPickerOpen(false)
                      setOpenFams([])
                    }}
                  >
                    <span className="sdot" style={{ background: fam.items[0].color ?? '#8b8b8b' }} />
                    {fam.items[0].name}
                    {fam.items[0].free && <span className="free-tag">free</span>}
                  </button>
                ) : (
                  <div key={fam.command} className="orch-fam">
                    <button
                      className="orch-menu-item orch-fam-head"
                      title={`${fam.items.length} ${fam.label} orchestrators`}
                      onClick={() =>
                        setOpenFams((prev) =>
                          prev.includes(fam.command) ? prev.filter((c) => c !== fam.command) : [...prev, fam.command]
                        )
                      }
                    >
                      <span className="sdot" style={{ background: fam.color }} />
                      {fam.label}
                      <span className="orch-fam-count">{fam.items.length}</span>
                      <span className={'orch-fam-chev' + (openFams.includes(fam.command) ? ' open' : '')}>›</span>
                    </button>
                    {openFams.includes(fam.command) &&
                      fam.items.map((p) => (
                        <button
                          key={p.id}
                          className="orch-menu-item orch-fam-sub"
                          onClick={() => {
                            onSummon(p.id)
                            setPickerOpen(false)
                            setOpenFams([])
                          }}
                        >
                          <span className="sdot" style={{ background: p.color ?? fam.color }} />
                          {p.name}
                          {p.free && <span className="free-tag">free</span>}
                        </button>
                      ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {handoff.length > 0 && (
        <div className="handoff">
          <div className="handoff-title">
            Hand {handoff.length === 1 ? 'off' : `over ${handoff.length}`} →{' '}
            <b>{activeOrch ? tabLabel(activeOrch) : 'orchestrator'}</b>
          </div>
          <div className="handoff-chips">
            {handoff.map((w) => (
              <span className="handoff-chip" key={w.id}>
                {w.label}
                {w.branch
                  ? ` · ${
                      w.branch.startsWith(PRODUCT_IDENTITY.worktreeBranchPrefix)
                        ? w.branch.slice(PRODUCT_IDENTITY.worktreeBranchPrefix.length)
                        : w.branch
                    }`
                  : ''}
                <span
                  className="handoff-chip-x"
                  title="Remove"
                  onClick={() => setHandoff((prev) => prev.filter((x) => x.id !== w.id))}
                >
                  ✕
                </span>
              </span>
            ))}
          </div>
          <input
            autoFocus
            placeholder={
              handoff.length > 1
                ? 'What should it do with these? (blank = compare them)'
                : 'What do you need? (blank = review it)'
            }
            value={handoffText}
            onChange={(e) => setHandoffText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendHandoff()
              if (e.key === 'Escape') {
                setHandoff([])
                setHandoffText('')
              }
            }}
          />
          <div className="handoff-row">
            <button onClick={sendHandoff}>Send</button>
            <button
              onClick={() => {
                setHandoff([])
                setHandoffText('')
              }}
            >
              Cancel
            </button>
          </div>
          <div className="handoff-hint">drop more workers here to add them</div>
        </div>
      )}

      {activeTomb ? (
        <div className="side-orch-body">
          <TombstonePane
            t={activeTomb}
            presetLabel={presetLabel(activeTomb.session.presetId)}
            onRevive={onReviveTombstone}
            onDismiss={(id) => {
              setTombTabId(null)
              onDismissTombstone(id)
            }}
          />
        </div>
      ) : activeOrch ? (
        <div className="side-orch-body">
          {/* key by id so switching tabs attaches a fresh terminal to the right session.
              Route the pane ✕ through the same close logic as the tab (kill a summoned
              orchestrator / demote a promoted worker) so it can't accidentally kill a lead. */}
          <TerminalPane
            key={activeOrch.id}
            session={activeOrch}
            presetLabel={presetLabel(activeOrch.presetId)}
            onClose={() => {
              if (!leadIds.includes(activeOrch.id) && !confirmOrchClose()) return // guard the kill, not the demote
              onCloseOrch(activeOrch)
            }}
            closeTitle={leadIds.includes(activeOrch.id) ? 'Return this worker to the grid' : 'Close this orchestrator'}
          />
        </div>
      ) : (
        <button className="orch-empty" onClick={() => setPickerOpen(true)}>
          <span className="orch-empty-star">★</span>
          <span className="orch-empty-title">Summon an orchestrator</span>
          <span className="orch-empty-sub">Claude · Codex · Personal Agent — any can review &amp; ship</span>
        </button>
      )}
    </div>
  )
}
