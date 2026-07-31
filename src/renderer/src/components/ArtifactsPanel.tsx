import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { ArtifactFile, ArtifactList, ArtifactType } from '@shared/types'

const TYPE_ORDER: ArtifactType[] = ['pdf', 'image', 'html', 'other']
const TYPE_LABEL: Record<ArtifactType, string> = { pdf: 'PDF', image: 'Images', html: 'HTML', other: 'Other' }

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
function ago(ms: number): string {
  const d = Date.now() - ms
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function ArtifactsPanel({ onClose }: { onClose: () => void; projectId?: string | null }): React.JSX.Element {
  const [list, setList] = useState<ArtifactList | null>(null)
  const [selected, setSelected] = useState<ArtifactFile | null>(null)

  const refresh = useCallback(() => {
    api.listArtifacts().then((l) => {
      setList(l)
      setSelected((cur) => (cur && l.files.some((f) => f.path === cur.path) ? cur : null))
    })
  }, [])
  useEffect(() => refresh(), [refresh])

  // Auto-refresh when the main process reports a change in the artifacts dir (fs-watch → bus).
  useEffect(() => {
    return api.onMcEvent((e) => {
      if (e.kind === 'artifacts') refresh()
    })
  }, [refresh])

  // An orchestrator's open_artifact: fetch fresh, then preview the file (or open 'other' externally).
  useEffect(() => {
    return api.onArtifactOpen((path) => {
      api.listArtifacts().then((l) => {
        setList(l)
        const file = l.files.find((f) => f.path === path)
        if (!file) return
        if (file.type === 'other') void api.openPath(file.path)
        else setSelected(file)
      })
    })
  }, [])

  const groups = TYPE_ORDER.map((t) => ({ type: t, files: (list?.files ?? []).filter((f) => f.type === t) })).filter(
    (g) => g.files.length > 0
  )

  return (
    <div className="artifact-panel">
      <div className="artifact-head">
        <span className="artifact-title">Artifacts</span>
        <button className="artifact-btn" title="Refresh" onClick={refresh}>
          ↻
        </button>
        <button className="artifact-btn" title="Hide panel" onClick={onClose} style={{ marginLeft: 'auto' }}>
          ✕
        </button>
      </div>
      {!list ? (
        <div className="artifact-empty">Loading…</div>
      ) : list.dir === null ? (
        <div className="artifact-empty">
          No artifacts directory set — choose one in Settings (gear icon) to see agent-created files here.
        </div>
      ) : list.files.length === 0 ? (
        <div className="artifact-empty">No files in {list.dir} yet.</div>
      ) : (
        <div className="artifact-body">
          <div className="artifact-list">
            {groups.map((g) => (
              <div key={g.type} className="artifact-group">
                <div className="artifact-group-head">
                  {TYPE_LABEL[g.type]} · {g.files.length}
                </div>
                {g.files.map((f) => (
                  <div
                    key={f.path}
                    className={'artifact-row' + (selected?.path === f.path ? ' on' : '')}
                    onClick={() => setSelected(f)}
                    title={f.path}
                  >
                    <span className="artifact-name">{f.name}</span>
                    <span className="artifact-meta">
                      {fmtSize(f.size)} · {ago(f.mtime)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="artifact-view">
            {!selected ? (
              <div className="artifact-empty">Select a file to preview.</div>
            ) : selected.type === 'other' ? (
              <div className="artifact-empty">
                {selected.name}
                <button
                  className="artifact-btn"
                  style={{ marginTop: 12 }}
                  onClick={() => void api.openPath(selected.path)}
                >
                  Open in default app
                </button>
              </div>
            ) : (
              React.createElement('webview', {
                key: selected.path,
                src: selected.url,
                style: { position: 'absolute', inset: 0, border: 'none', background: '#fff' }
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
