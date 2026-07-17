import React, { useCallback, useRef, useState } from 'react'
import { TerminalPane } from './TerminalPane'
import { TombstonePane } from './TombstonePane'
import { colsOf, rowsOf, responsiveCols, type LayoutDef } from '../layouts'
import type { SessionRecord } from '@shared/types'
import type { Tombstone } from '../tombstones'

export function PaneGrid({
  sessions,
  onMakeLead,
  onEnd,
  onHide,
  layout,
  colorFor,
  onReorder,
  onSetColor,
  tombstones = [],
  presetLabel = (pid) => pid,
  onReviveTombstone = () => {},
  onDismissTombstone = () => {}
}: {
  sessions: SessionRecord[]
  onMakeLead: (id: string) => void
  onEnd: (id: string) => void
  onHide: (id: string) => void
  layout?: LayoutDef | null // null/undefined = Auto (√n); else a template (areas → spanning, or uniform cols)
  colorFor: (id: string) => string // per-pane accent color
  onReorder: (draggedId: string, targetId: string) => void // drop pane A onto pane B → swap slots
  onSetColor: (id: string, hex: string) => void // pin a pane to a chosen color
  tombstones?: Tombstone[] // unexpectedly-exited panes shown as revivable cells after the live ones
  presetLabel?: (presetId: string) => string
  onReviveTombstone?: (id: string) => void
  onDismissTombstone?: (id: string) => void
}): React.JSX.Element {
  const n = sessions.length + tombstones.length

  // Measure the grid's own width so Auto can pick a column count that fits the window (CNVS-style
  // dynamic reflow) instead of a fixed √n. A callback ref + ResizeObserver re-attaches cleanly
  // across the empty↔populated transition. Changing the column count doesn't change the container's
  // width (the parent sets that), so there's no measure→relayout feedback loop.
  const [gridWidth, setGridWidth] = useState(0)
  const roRef = useRef<ResizeObserver | null>(null)
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!node) return
    setGridWidth(node.clientWidth)
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setGridWidth(e.contentRect.width)
    })
    ro.observe(node)
    roRef.current = ro
  }, [])

  if (n === 0) {
    return (
      <div className="empty">
        No sessions yet. Try <code>spawn 2 claude-opus + 1 codex</code>
      </div>
    )
  }

  // areas → explicit template (panes can span); cols → uniform N columns; neither → Auto, which is
  // now WIDTH-RESPONSIVE: columns are chosen from the measured grid width so resizing the window
  // reflows the panes (no manual layout pick needed).
  const useAreas = !!layout?.areas
  let style: React.CSSProperties
  if (useAreas) {
    style = {
      gridTemplateColumns: `repeat(${colsOf(layout!)}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rowsOf(layout!)}, minmax(0, 1fr))`,
      gridTemplateAreas: layout!.areas!.map((r) => `"${r}"`).join(' ')
    }
  } else {
    const cols = layout?.cols ? Math.min(Math.max(1, layout.cols), n) : responsiveCols(gridWidth, n)
    const rows = Math.max(1, Math.ceil(n / cols))
    style = {
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
    }
  }

  return (
    <div className="grid" ref={gridRef} style={style}>
      {sessions.map((s, i) => (
        // Fixed cell. min-width/height:0 stops the terminal's content from inflating
        // its own grid track; overflow:hidden clips. Together with explicit 1fr rows
        // this gives every pane a stable, content-independent size — which breaks the
        // fit -> grow -> redraw -> grow feedback loop that caused the lag/jump.
        <div
          key={s.id}
          style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', gridArea: useAreas ? `p${i}` : undefined }}
        >
          <TerminalPane
            session={s}
            presetLabel={presetLabel(s.presetId)}
            accent={colorFor(s.id)}
            onToggleLead={() => onMakeLead(s.id)}
            onClose={() => onEnd(s.id)}
            onHide={() => onHide(s.id)}
            onReorderDrop={(draggedId) => onReorder(draggedId, s.id)}
            onSetColor={(hex) => onSetColor(s.id, hex)}
          />
        </div>
      ))}
      {tombstones.map((t, j) => (
        // Tombstones occupy trailing grid cells (excluded from drag/reorder — they're not live panes).
        <div
          key={t.session.id}
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            gridArea: useAreas ? `p${sessions.length + j}` : undefined
          }}
        >
          <TombstonePane
            t={t}
            presetLabel={presetLabel(t.session.presetId)}
            onRevive={onReviveTombstone}
            onDismiss={onDismissTombstone}
          />
        </div>
      ))}
    </div>
  )
}
