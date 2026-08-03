import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { ArtifactFile, ArtifactList, ArtifactType } from '@shared/types'
import type { ArtifactShare } from '@shared/ipc'
import { expiresInLabel } from '@shared/artifacts/share'

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
  // Share = hand this file to another device. The link is short-lived, so the countdown is
  // part of the UI, not a detail: the operator must see that it dies. The result carries the
  // path it belongs to, so selecting another file simply stops matching — no effect needed to
  // clear it (the link itself stays live until it expires or is revoked).
  const [share, setShare] = useState<(ArtifactShare & { forPath: string }) | null>(null)
  const [sharing, setSharing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const shown = share && selected && share.forPath === selected.path ? share : null
  useEffect(() => {
    if (!shown?.expiresAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [shown?.expiresAt])

  const doShare = useCallback(async (path: string) => {
    setSharing(true)
    const r = await api.shareArtifact(path).catch(() => ({ ok: false, message: 'Share failed.' }) as ArtifactShare)
    setSharing(false)
    setNow(Date.now())
    setShare({ ...r, forPath: path })
  }, [])

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
            ) : (
              <>
                <div className="artifact-actions">
                  <span className="artifact-sel-name" title={selected.path}>
                    {selected.name}
                  </span>
                  <button className="artifact-btn" onClick={() => void api.openPath(selected.path)}>
                    Open
                  </button>
                  <button className="artifact-btn" disabled={sharing} onClick={() => void doShare(selected.path)}>
                    {sharing ? 'Sharing…' : '↗ Share'}
                  </button>
                </div>
                {shown && (
                  <div className={'artifact-share' + (shown.ok ? '' : ' bad')}>
                    {!shown.ok ? (
                      <span className="artifact-share-msg">{shown.message}</span>
                    ) : (
                      <>
                        {shown.qr && <img className="artifact-qr" src={shown.qr} alt="QR code for the share link" />}
                        <div className="artifact-share-body">
                          <div className="artifact-share-hint">
                            {shown.qr
                              ? 'Scan with your phone, or send this link to another computer.'
                              : 'Send this link to another device.'}
                          </div>
                          <input
                            className="artifact-share-url"
                            readOnly
                            value={shown.url}
                            onFocus={(e) => e.target.select()}
                          />
                          <div className="artifact-share-row">
                            <button
                              className="artifact-btn"
                              onClick={() => shown.url && api.clipboardWriteText(shown.url)}
                            >
                              Copy link
                            </button>
                            <button
                              className="artifact-btn"
                              onClick={() => {
                                if (shown.token) void api.revokeArtifactShare(shown.token)
                                setShare(null)
                              }}
                            >
                              Revoke
                            </button>
                            <span className="artifact-share-ttl">
                              expires in {expiresInLabel(shown.expiresAt ?? 0, now)}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {selected.type !== 'other' &&
                  React.createElement('webview', {
                    key: selected.path,
                    src: selected.url,
                    style: { position: 'absolute', inset: 0, top: 'auto', border: 'none', background: '#fff' },
                    className: 'artifact-preview'
                  })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
