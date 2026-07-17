import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { OrchestratorDock } from './OrchestratorDock'
import { useDragAffordanceClear } from '../hooks/useDragAffordanceClear'
import type { Preset, Project, SessionRecord } from '@shared/types'
import type { Tombstone } from '../tombstones'

const shortHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
const MIN_W = 220
const MAX_W = 680

export function Sidebar({
  currentProjectId,
  onSelect,
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
  onSetPin,
  measureRef
}: {
  currentProjectId: string | null
  onSelect: (id: string | null, name: string) => void
  orchestrators: SessionRecord[]
  activeOrch: SessionRecord | null
  leadIds: string[]
  presets: Preset[]
  onSelectOrch: (id: string) => void
  onCloseOrch: (s: SessionRecord) => void
  onSummon: (presetId: string) => void
  tombstones?: Tombstone[] // unexpectedly-exited leads (dock tombstone tabs)
  presetLabel?: (presetId: string) => string
  onReviveTombstone?: (id: string) => void
  onDismissTombstone?: (id: string) => void
  /** Where the whole [workspaces + orchestrator] section locks: in-flow left (default),
   *  in-flow right (canvas fills the left), or floating dead-center (canvas on both sides). */
  pin?: 'left' | 'center' | 'right'
  onSetPin?: (p: 'left' | 'center' | 'right') => void
  /** App-owned handle to the column's DOM element — the canvas measures it (never a hardcoded
   *  width) to keep panes from resting hidden behind the docked section. */
  measureRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [adding, setAdding] = useState(false)
  const [wsCollapsed, setWsCollapsed] = useState(false) // collapse the workspace list → give the dock the space
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // A missed dragleave (Esc'd drag, drop landing elsewhere) must not leave the dashed drop
  // outline stuck on — HTML5 dragleave is unreliable, and dragend fires on the drag SOURCE (in
  // another app for Finder/screenshot drags, so it never reaches this window). The shared hook
  // clears on dragend + capture-phase drop + the first buttons-free mousemove.
  const clearDragOver = useCallback((): void => setDragOver(false), [])
  useDragAffordanceClear(dragOver, clearDragOver)
  const [width, setWidth] = useState<number | null>(null) // null = CSS default; number = user-resized
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; w: number } | null>(null)
  const asideRef = useRef<HTMLElement>(null)

  const reload = (): void => {
    api.listProjects().then(setProjects)
  }
  useEffect(reload, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent): void => {
      if (!dragRef.current) return
      // Right-pinned, the handle sits on the LEFT edge — dragging left grows the column.
      const dx = (e.clientX - dragRef.current.x) * (pin === 'right' ? -1 : 1)
      setWidth(Math.min(MAX_W, Math.max(MIN_W, dragRef.current.w + dx)))
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, pin])

  const startResize = (e: React.MouseEvent): void => {
    dragRef.current = { x: e.clientX, w: width ?? asideRef.current?.offsetWidth ?? 360 }
    setDragging(true)
    e.preventDefault()
  }

  const browse = async (): Promise<void> => {
    const picked = await api.pickFolder()
    if (picked) {
      setPath(picked)
      if (!name.trim()) setName(picked.split('/').filter(Boolean).pop() ?? '')
    }
  }

  const create = async (): Promise<void> => {
    if (!name.trim() || !path.trim()) return
    try {
      const p = await api.createProject(name.trim(), path.trim())
      setName('')
      setPath('')
      setError('')
      setAdding(false)
      reload()
      onSelect(p.id, p.name)
    } catch (e) {
      setError((e as Error).message.replace(/^Error:\s*/, ''))
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    let lastId: string | null = null
    let lastName = ''
    for (const f of files) {
      const p = api.pathForFile(f)
      if (!p) continue
      const fname = p.split('/').filter(Boolean).pop() ?? 'project'
      try {
        const proj = await api.createProject(fname, p)
        lastId = proj.id
        lastName = proj.name
        setError('')
      } catch (err) {
        setError((err as Error).message.replace(/^Error:\s*/, ''))
      }
    }
    reload()
    if (lastId) onSelect(lastId, lastName)
  }

  // Two-step delete: the X only arms an inline confirm to guard against a stray click deleting a
  // live workspace. If the main-process guard then refuses because agents are still running, the
  // confirm escalates — a third, explicit click force-deletes. Sessions survive in tmux either way.
  const [confirmDel, setConfirmDel] = useState<{ id: string; msg: string; force: boolean } | null>(null)

  const remove = async (id: string, force: boolean): Promise<void> => {
    try {
      await api.deleteProject(id, force ? { force: true } : undefined)
      setConfirmDel(null)
      if (currentProjectId === id) onSelect(null, 'Scratch')
      reload()
    } catch (err) {
      // ipcRenderer.invoke wraps thrown errors: "Error invoking remote method 'project:delete': Error: <msg>"
      const msg = (err as Error).message.replace(/^(Error invoking remote method '[^']+': )?(Error:\s*)?/, '')
      setConfirmDel({ id, msg, force: true })
    }
  }

  // The active workspace — shown on its own when the list is collapsed.
  const activeProject = currentProjectId ? (projects.find((p) => p.id === currentProjectId) ?? null) : null
  const activeName = currentProjectId === null ? 'Scratch' : (activeProject?.name ?? 'Scratch')

  return (
    <aside
      ref={(el) => {
        asideRef.current = el
        if (measureRef) measureRef.current = el
      }}
      className={'sidebar pin-' + pin + (orchestrators.length ? ' has-orch' : '')}
      style={{
        // width carries the user resize when the section floats (pin-center: absolute, so
        // flex-basis is ignored); flex-basis stays authoritative for the in-flow pins.
        ...(width != null ? { flexBasis: width, width } : {}),
        ...(dragOver ? { outline: '2px dashed rgba(127,227,255,0.45)', outlineOffset: -4 } : {})
      }}
      onDragOver={(e) => {
        // Only a file/folder drop creates a project — don't flash the drop affordance or become a
        // drop target for canvas drags (application/mc-image / application/mc-text just passing over).
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div
        className={'side-head' + (wsCollapsed ? ' collapsed' : '')}
        onClick={() => setWsCollapsed((c) => !c)}
        title={wsCollapsed ? 'Show workspaces' : 'Hide workspaces'}
      >
        <span className="label">
          <span className="ws-toggle" aria-hidden="true">
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M2 6h8" />
              <path className="ws-toggle-v" d="M6 2v8" />
            </svg>
          </span>
          Workspaces
        </span>
      </div>

      {wsCollapsed && (
        <nav className="ws-list">
          <div className="ws active" onClick={() => setWsCollapsed(false)} title="Expand to switch workspace">
            <span className="ws-icon">
              {currentProjectId === null ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path
                    d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <div className="ws-meta">
              <div className="ws-name">{activeName}</div>
              {activeProject?.rootPath && <div className="ws-path">{shortHome(activeProject.rootPath)}</div>}
            </div>
          </div>
        </nav>
      )}

      {!wsCollapsed && (
        <>
          <nav className="ws-list">
            <div
              className={'ws' + (currentProjectId === null ? ' active' : '')}
              onClick={() => onSelect(null, 'Scratch')}
            >
              <span className="ws-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                </svg>
              </span>
              <div className="ws-meta">
                <div className="ws-name">Scratch</div>
              </div>
            </div>

            {projects.map((p) =>
              confirmDel?.id === p.id ? (
                <div key={p.id} className="ws ws-confirming" onClick={(e) => e.stopPropagation()}>
                  <div className="ws-meta">
                    <div className="ws-name">Delete “{p.name}”?</div>
                    <div className="ws-path">{confirmDel.msg}</div>
                  </div>
                  <button
                    className="ws-confirm-btn danger"
                    onClick={() => void remove(p.id, confirmDel.force)}
                    title={confirmDel.force ? 'Delete even though agents are running' : 'Delete this workspace'}
                  >
                    {confirmDel.force ? 'Force' : 'Delete'}
                  </button>
                  <button className="ws-confirm-btn" onClick={() => setConfirmDel(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div
                  key={p.id}
                  className={'ws' + (currentProjectId === p.id ? ' active' : '')}
                  title={p.rootPath}
                  onClick={() => onSelect(p.id, p.name)}
                >
                  <span className="ws-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path
                        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="ws-meta">
                    <div className="ws-name">{p.name}</div>
                    <div className="ws-path">{shortHome(p.rootPath)}</div>
                  </div>
                  <span
                    className="ws-del"
                    title="Delete workspace…"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDel({ id: p.id, msg: 'Removes the workspace and its saved layout.', force: false })
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </span>
                </div>
              )
            )}
          </nav>

          <button className="side-add-btn" onClick={() => setAdding((a) => !a)}>
            {adding ? '× Cancel' : '＋ Add workspace'}
          </button>

          {adding && (
            <div className="side-add">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="side-row">
                <input
                  style={{ flex: 1 }}
                  placeholder="/absolute/path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create()
                  }}
                />
                <button onClick={() => void browse()}>Browse…</button>
              </div>
              <button onClick={() => void create()}>Add project</button>
              {error && <div className="side-err">{error}</div>}
            </div>
          )}
        </>
      )}

      <OrchestratorDock
        orchestrators={orchestrators}
        activeOrch={activeOrch}
        leadIds={leadIds}
        presets={presets}
        onSelectOrch={onSelectOrch}
        onCloseOrch={onCloseOrch}
        onSummon={onSummon}
        tombstones={tombstones}
        presetLabel={presetLabel}
        onReviveTombstone={onReviveTombstone}
        onDismissTombstone={onDismissTombstone}
        pin={pin}
        onSetPin={onSetPin}
      />

      <div className="side-foot">
        <span className="byok-badge">
          <span className="lock">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          BYOK <span className="sep">·</span> your keys
        </span>
      </div>

      <div className="sidebar-resize" title="Drag to resize" onMouseDown={startResize} />
      {dragging && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 9999 }} />}
    </aside>
  )
}
