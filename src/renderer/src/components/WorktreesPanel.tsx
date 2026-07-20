import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { WorktreeEntry } from '@shared/types'
import { GuardedButton } from './GuardedButton'

function classifyWorktree(entry: WorktreeEntry): { label: string; removable: boolean; requiresConfirm: boolean } {
  if (entry.inUse) return { label: 'in use', removable: false, requiresConfirm: false }
  if (entry.dirty) return { label: 'uncommitted changes', removable: true, requiresConfirm: true }
  return { label: 'clean', removable: true, requiresConfirm: false }
}

function groupByProject(entries: WorktreeEntry[]): Array<{
  projectId: string
  projectName: string
  entries: WorktreeEntry[]
}> {
  const groups = new Map<string, { projectId: string; projectName: string; entries: WorktreeEntry[] }>()
  for (const entry of entries) {
    const group = groups.get(entry.projectId) ?? {
      projectId: entry.projectId,
      projectName: entry.projectName,
      entries: []
    }
    group.entries.push(entry)
    groups.set(entry.projectId, group)
  }
  return [...groups.values()]
}

/**
 * Cleanup view for the git worktrees Vibechemy created for isolated agents (product-prefixed branches).
 * Lists them per project with clean/dirty/in-use status and a guarded Remove. The main process
 * re-checks every guard, so the worst a stale click can do is get a refusal message back.
 */
export function WorktreesPanel({ onClose }: { onClose: () => void; projectId?: string | null }): React.JSX.Element {
  const [entries, setEntries] = useState<WorktreeEntry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // path currently being removed
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    api.listWorktrees().then(setEntries)
  }, [])
  useEffect(() => load(), [load])
  const refresh = useCallback(() => {
    load()
  }, [load])

  const remove = async (e: WorktreeEntry, force: boolean): Promise<void> => {
    setBusy(e.path)
    setMsg('')
    const r = await api.removeWorktree(e.path, force)
    setMsg(r.message)
    setBusy(null)
    refresh()
  }

  const groups = entries ? groupByProject(entries) : []

  return (
    <div className="wt-panel">
      <div className="wt-head">
        <span className="wt-title">Worktrees</span>
        <button className="wt-btn" title="Refresh" onClick={refresh}>
          ↻
        </button>
        <button className="wt-btn" title="Hide panel" onClick={onClose} style={{ marginLeft: 'auto' }}>
          ✕
        </button>
      </div>

      {!entries ? (
        <div className="wt-empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="wt-empty">
          No agent worktrees on disk. Isolated agents (🌿) create one each; they show up here to review or prune.
        </div>
      ) : (
        <div className="wt-body">
          {groups.map((g) => (
            <div key={g.projectId ?? '∅'} className="wt-group">
              <div className="wt-group-head">
                {g.projectName} · {g.entries.length}
              </div>
              {g.entries.map((e) => {
                const c = classifyWorktree(e)
                const statusClass = e.inUse ? 'inuse' : e.dirty ? 'dirty' : ''
                return (
                  <div key={e.path} className="wt-row">
                    <div className="wt-row-main">
                      <span className="wt-branch" title={e.path}>
                        {e.branch}
                      </span>
                      <span className={'wt-status ' + statusClass}>
                        {e.inUse && e.sessionTitle ? `in use — ${e.sessionTitle}` : c.label}
                      </span>
                    </div>
                    <GuardedButton
                      key={String(c.requiresConfirm)}
                      className="wt-rm"
                      disabled={!c.removable || busy === e.path}
                      title={c.removable ? 'Remove this worktree and its branch' : c.label}
                      label={busy === e.path ? '…' : 'Remove'}
                      confirmLabel="Discard?"
                      requiresConfirmation={c.requiresConfirm}
                      onConfirm={() => void remove(e, c.requiresConfirm)}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {msg && <div className="wt-msg">{msg}</div>}
    </div>
  )
}
