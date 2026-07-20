import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { SessionRecord } from '@shared/types'
import { GuardedButton } from './GuardedButton'
import { beginPrecheck, completePrecheck, formatPrecheck, precheckTone, type PrecheckCache } from '../reviewPrecheck'

const PRESET_COLOR: Record<string, string> = {
  'claude-opus': 'amber',
  'personal-agent': 'cyan',
  codex: 'green',
  antigravity: 'blue',
  'opencode-glm': 'violet',
  'opencode-minimax': 'pink',
  shell: 'gray'
}

// One diff line, colored by its leading character (added/removed/hunk header).
function DiffLine({ line }: { line: string }): React.JSX.Element {
  let cls = 'diff-ctx'
  if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add'
  else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-rem'
  else if (line.startsWith('@@')) cls = 'diff-hunk'
  return <div className={cls}>{line || ' '}</div>
}

export function ReviewPanel({
  projectId,
  onClose
}: {
  projectId: string | null
  onClose: () => void
}): React.JSX.Element {
  const [workers, setWorkers] = useState<SessionRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [files, setFiles] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [prechecks, setPrechecks] = useState<PrecheckCache>({})
  const requestedPrechecks = useRef(new Set<string>())

  const reload = useCallback(() => {
    api.listSessions(projectId).then((all) => setWorkers(all.filter((s) => s.branch)))
  }, [projectId])
  useEffect(reload, [reload])

  // Keep the list in sync when a worker exits elsewhere (its pane's close button, or
  // it finishes on its own): drop it from the list and clear it if it was selected.
  useEffect(() => {
    const off = api.onExit((ev) => {
      setSelected((cur) => (cur === ev.id ? null : cur))
      reload()
    })
    return off
  }, [reload])

  useEffect(() => {
    if (!selected || requestedPrechecks.current.has(selected)) return
    requestedPrechecks.current.add(selected)
    setPrechecks((cache) => beginPrecheck(cache, selected))
    void api
      .sessionPrecheck(selected)
      .then((result) => setPrechecks((cache) => completePrecheck(cache, selected, result)))
      .catch((error) =>
        setPrechecks((cache) =>
          completePrecheck(cache, selected, {
            configured: true,
            exitCode: 1,
            output: error instanceof Error ? error.message : String(error)
          })
        )
      )
  }, [selected])

  const select = async (id: string): Promise<void> => {
    setSelected(id)
    setMsg('')
    setDiff('')
    setFiles(0)
    const r = await api.sessionDiff(id)
    if (r.ok) {
      setDiff(r.diff || '(no changes yet)')
      setFiles(r.files)
    } else {
      setMsg(r.message ?? 'No diff available')
    }
  }
  const merge = async (id: string): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await api.sessionMerge(id)
    setBusy(false)
    if (r.ok) {
      setSelected(null)
      setDiff('')
      reload()
    } else {
      setMsg(r.conflict ? `⚠ ${r.message}` : r.message)
    }
  }
  const discard = async (id: string): Promise<void> => {
    setBusy(true)
    await api.sessionDiscard(id)
    setBusy(false)
    setSelected(null)
    setDiff('')
    reload()
  }

  return (
    <div className="review">
      <div className="review-head">
        <span className="label">Review &amp; merge</span>
        <button className="icon-btn" title="Hide panel" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {workers.length === 0 && (
        <div className="review-empty">
          No isolated workers. Spawn an agent with 🌿 Isolate to review &amp; merge its branch here.
        </div>
      )}

      <div className="review-list">
        {workers.map((w) => {
          const color = PRESET_COLOR[w.presetId] ?? 'gray'
          return (
            <button
              key={w.id}
              className={'review-item' + (w.id === selected ? ' active' : '')}
              onClick={() => void select(w.id)}
            >
              <span className={'sdot ' + color} />
              <span className="review-branch">{w.branch}</span>
            </button>
          )
        })}
      </div>

      {selected && (
        <>
          <div className="review-actions">
            <span className="review-files">
              {files} file{files === 1 ? '' : 's'} changed
            </span>
            <GuardedButton
              key={`merge-${selected}`}
              className="run-btn"
              disabled={busy}
              label="Merge"
              confirmLabel="Confirm merge?"
              onConfirm={() => void merge(selected)}
            />
            <GuardedButton
              key={`discard-${selected}`}
              className="chip"
              disabled={busy}
              label="Discard"
              confirmLabel="Confirm discard?"
              onConfirm={() => void discard(selected)}
            />
          </div>
          <div className={`review-check ${precheckTone(prechecks[selected] ?? { phase: 'running' })}`}>
            {formatPrecheck(prechecks[selected] ?? { phase: 'running' })}
          </div>
          {msg && <div className="review-msg">{msg}</div>}
          <div className="review-diff">
            {diff.split('\n').map((l, i) => (
              <DiffLine key={i} line={l} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
