import React, { useEffect, useRef, useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { ReviewPanel } from './ReviewPanel'
import { UsagePanel } from './UsagePanel'
import { WorktreesPanel } from './WorktreesPanel'

const MIN_W = 280
const MAX_W = 1400

type DockMode = 'review' | 'usage' | 'worktrees'

interface DockPanelDef {
  id: DockMode
  title: string
  icon: React.JSX.Element
  render: (context: { onClose: () => void; projectId: string | null }) => React.JSX.Element
}

const PANELS: DockPanelDef[] = [
  {
    id: 'review',
    title: 'Review & merge',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="6" cy="6" r="2.4" />
        <circle cx="6" cy="18" r="2.4" />
        <circle cx="18" cy="9" r="2.4" />
        <path d="M6 8.4v7.2M8.4 6h6.2a2 2 0 0 1 2 2v.8" />
      </svg>
    ),
    render: ({ onClose, projectId }) => <ReviewPanel projectId={projectId} onClose={onClose} />
  },
  {
    id: 'usage',
    title: 'Usage — plan quota left per agent',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 3a9 9 0 1 0 9 9" />
        <path d="M12 3v9l6.5 3.5" />
      </svg>
    ),
    render: ({ onClose }) => <UsagePanel onClose={onClose} />
  },
  {
    id: 'worktrees',
    title: 'Worktrees',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="6" cy="4" r="2.2" />
        <path d="M6 6.2v11.6" />
        <circle cx="6" cy="20" r="2.2" />
        <circle cx="18" cy="8" r="2.2" />
        <path d="M16.2 9.4 8 17M16 8H9a3 3 0 0 0-3 3" />
      </svg>
    ),
    render: ({ onClose }) => <WorktreesPanel onClose={onClose} />
  }
]

export function RightDock({
  projectId,
  side = 'right'
}: {
  projectId: string | null
  /** Which screen edge the rail+panel hug. App flips it to 'left' while the orchestrator column
   *  is pinned center/right so the two never fight over the right edge.
   *  Same mounted node either way (CSS order flips it) — the browser webview never reloads. */
  side?: 'left' | 'right'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DockMode>('review')
  const [width, setWidth] = useState(560)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent): void => {
      if (!dragRef.current) return
      const delta = side === 'left' ? e.clientX - dragRef.current.x : dragRef.current.x - e.clientX
      setWidth(Math.min(MAX_W, Math.max(MIN_W, dragRef.current.w + delta)))
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, side])

  const onRail = (id: DockMode): void => {
    if (open && mode === id) {
      setOpen(false)
      return
    }
    setMode(id)
    setOpen(true)
  }
  const active = PANELS.find((panel) => panel.id === mode) ?? PANELS[0]

  return (
    <div className={'dock' + (side === 'left' ? ' dock-left' : '')}>
      {open && (
        <div className="dock-panel" style={{ width }}>
          <div
            className="drag-handle"
            title="Drag to resize"
            onMouseDown={(event) => {
              dragRef.current = { x: event.clientX, w: width }
              setDragging(true)
              event.preventDefault()
            }}
          />
          <div className="dock-panel-inner">
            <ErrorBoundary key={mode} label={active.title}>
              {active.render({ onClose: () => setOpen(false), projectId })}
            </ErrorBoundary>
          </div>
        </div>
      )}

      <nav className="dock-rail">
        {PANELS.map((panel) => (
          <button
            key={panel.id}
            className={'dock-railbtn tip-left' + (open && mode === panel.id ? ' active' : '')}
            data-tip={panel.title}
            aria-label={panel.title}
            onClick={() => onRail(panel.id)}
          >
            {panel.icon}
          </button>
        ))}
      </nav>
      {dragging && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 9999 }} />}
    </div>
  )
}
