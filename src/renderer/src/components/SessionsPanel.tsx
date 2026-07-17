import React, { useEffect, useRef } from 'react'
import type { Preset, SessionRecord } from '@shared/types'
import { LEGACY_PERSONAL_AGENT_IDS, PERSONAL_AGENT_PRESET_ID } from '@shared/agents/personalAgent'

/**
 * The Sessions popover (title-bar ⊞ button): see every worker terminal in the workspace —
 * Open ones (Hide them), Hidden ones (Show them back; they kept running in tmux), and End
 * (actually kill) any of them. Orchestrators live in the rail dock, so they're not listed here.
 */
export function SessionsPanel({
  shown,
  hidden,
  leftovers,
  presets,
  onShow,
  onHide,
  onEnd,
  onMerge,
  onDiscard,
  onClose
}: {
  shown: SessionRecord[]
  hidden: SessionRecord[]
  leftovers: SessionRecord[]
  presets: Preset[]
  onShow: (id: string) => void
  onHide: (id: string) => void
  onEnd: (id: string) => void
  onMerge: (id: string) => void
  onDiscard: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const presetById = new Map(presets.map((p) => [p.id, p]))
  const personalAgent = presetById.get(PERSONAL_AGENT_PRESET_ID)
  if (personalAgent) {
    for (const id of LEGACY_PERSONAL_AGENT_IDS) presetById.set(id, personalAgent)
  }
  const label = (s: SessionRecord): string => presetById.get(s.presetId)?.name ?? s.presetId
  const color = (s: SessionRecord): string => presetById.get(s.presetId)?.color ?? '#8b8b8b'

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      // Ignore clicks on the toggle button — it owns open/close itself (else mousedown-close
      // here would race the button's click-reopen and the popover would never close).
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-sessions-toggle]')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const total = shown.length + hidden.length + leftovers.length

  const row = (s: SessionRecord, isHidden: boolean): React.JSX.Element => (
    <div className="sess-row" key={s.id}>
      <span className="sdot" style={{ background: color(s) }} />
      <div className="sess-meta">
        <span className="sess-name">{label(s)}</span>
        {s.branch && <span className="sess-branch">{s.branch}</span>}
      </div>
      <div className="sess-actions">
        {isHidden ? (
          <button className="sess-btn show" onClick={() => onShow(s.id)}>
            Show
          </button>
        ) : (
          <button className="sess-btn" onClick={() => onHide(s.id)}>
            Hide
          </button>
        )}
        <button className="sess-btn end" onClick={() => onEnd(s.id)}>
          End
        </button>
      </div>
    </div>
  )

  return (
    <div className="sessions-pop" ref={ref}>
      <div className="sessions-pop-head">
        <span>Terminals</span>
        <span className="sessions-pop-sub">{total} here · orchestrators live in the rail</span>
      </div>
      {total === 0 && <div className="sessions-empty">No worker terminals in this workspace yet.</div>}
      {shown.length > 0 && (
        <div className="sess-group">
          <div className="sess-group-label">Open</div>
          {shown.map((s) => row(s, false))}
        </div>
      )}
      {hidden.length > 0 && (
        <div className="sess-group">
          <div className="sess-group-label">Hidden — still running, reopenable</div>
          {hidden.map((s) => row(s, true))}
        </div>
      )}
      {leftovers.length > 0 && (
        <div className="sess-group">
          <div className="sess-group-label">Closed — work not merged ({leftovers.length})</div>
          {leftovers.map((s) => (
            <div className="sess-row" key={s.id}>
              <span className="sdot" style={{ background: color(s) }} />
              <div className="sess-meta">
                <span className="sess-name">{label(s)}</span>
                {s.branch && <span className="sess-branch">{s.branch}</span>}
              </div>
              <div className="sess-actions">
                <button
                  className="sess-btn show"
                  title="Merge this branch into the project, then remove the worktree"
                  onClick={() => onMerge(s.id)}
                >
                  Merge
                </button>
                <button
                  className="sess-btn end"
                  title="Delete the worktree + branch (discard this work)"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Discard ${label(s)}${s.branch ? ` (${s.branch})` : ''}?\n\nThis permanently deletes its worktree and branch, including any uncommitted work. This can't be undone.`
                      )
                    )
                      onDiscard(s.id)
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
