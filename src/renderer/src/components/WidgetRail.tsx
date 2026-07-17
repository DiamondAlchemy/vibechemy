import React, { useEffect, useRef, useState } from 'react'
import { WIDGET_CATALOG, WIDGET_IDS, widgetActive, type WidgetId } from '@shared/widgets/catalog'
import { WIDGETS_MENU_EVENT, type Widgets } from '../useWidgets'
import { slotForX } from './tabReorder'
import { WidgetBody } from './WidgetCards'
import './widgets.css'

// Floating widget-card rail on the Free canvas: glanceable readouts docked to the right edge as a
// vertical stack. The rail LAYER is pointer-events:none (empty space falls through to panes/decor —
// the canvas-layer discipline); only the cards/menu/strip capture events. Sits above the
// .free-surface stacking context (z1) and geometrically clear of the in-flow toolbar.
// The ＋ Widgets toolbar button reaches the add-menu via the WIDGETS_MENU_EVENT window event, so
// FreePaneLayout's edit stays one line.
// The `widgets` state instance is OWNED by FreePaneLayout (one hook instance shared with the
// floating canvas cards) — a card detached via the head's ⇱ handle leaves this rail and rides
// an application/mc-widget drag to the surface, which places it.

const DRAG_THRESHOLD_PX = 4

export function WidgetRail({
  projectId,
  widgets
}: {
  projectId: string | null
  widgets: Widgets
}): React.JSX.Element | null {
  const { state, add, remove, toggleCard, toggleRail, move } = widgets
  const [menuOpen, setMenuOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<WidgetId | null>(null)
  const cardEls = useRef<Partial<Record<WidgetId, HTMLDivElement | null>>>({})
  const drag = useRef<{ id: WidgetId; startY: number; started: boolean } | null>(null)

  useEffect(() => {
    const onMenu = (): void => setMenuOpen((v) => !v)
    window.addEventListener(WIDGETS_MENU_EVENT, onMenu)
    return () => window.removeEventListener(WIDGETS_MENU_EVENT, onMenu)
  }, [])

  // Drag-to-reorder within the rail — a pointer-capture strip drag, turned vertical: slotForX's
  // center-count math is axis-agnostic, so each card's top/height feeds its left/width.
  const onGripPointerDown = (id: WidgetId, e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    drag.current = { id, startY: e.clientY, started: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onGripPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    if (e.buttons === 0) {
      // A swallowed pointerup (e.g. released over a webview pane) must not glue the card to the cursor.
      endDrag()
      return
    }
    if (!d.started) {
      if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.started = true
      setDraggingId(d.id)
    }
    const others = state.open
      .filter((id) => id !== d.id)
      .map((id) => {
        const r = cardEls.current[id]?.getBoundingClientRect()
        return { left: r?.top ?? 0, width: r?.height ?? 0 }
      })
    const slot = slotForX(others, e.clientY)
    move(state.open.indexOf(d.id), slot)
  }
  const endDrag = (): void => {
    drag.current = null
    setDraggingId(null)
  }

  if (state.open.length === 0 && !menuOpen) return null

  return (
    <div className="widget-rail">
      {menuOpen && (
        <div className="widget-menu">
          <div className="widget-menu-head">
            <span>Widgets</span>
            <button className="wc-ctrl" onClick={() => setMenuOpen(false)} title="Close">
              ✕
            </button>
          </div>
          {WIDGET_IDS.map((id) => {
            const on = widgetActive(state, id) // rail or floating — either counts as "on the board"
            return (
              <button
                key={id}
                className={`widget-menu-item${on ? ' on' : ''}`}
                onClick={() => (on ? remove(id) : add(id))}
              >
                <span className="wm-icon">{WIDGET_CATALOG[id].icon}</span>
                <span className="wm-label">{WIDGET_CATALOG[id].label}</span>
                <span className="wm-check">{on ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
      )}
      {state.open.length > 0 &&
        (state.railCollapsed ? (
          <div className="widget-strip">
            <button className="wc-ctrl" onClick={toggleRail} title="Expand the widget rail">
              «
            </button>
            {state.open.map((id) => (
              <button key={id} className="widget-strip-icon" title={WIDGET_CATALOG[id].label} onClick={toggleRail}>
                {WIDGET_CATALOG[id].icon}
              </button>
            ))}
          </div>
        ) : (
          <div className="widget-stack">
            <div className="widget-rail-head">
              <button className="wc-ctrl" onClick={toggleRail} title="Collapse the rail to a strip of icons">
                »
              </button>
            </div>
            {state.open.map((id) => {
              const collapsed = state.collapsed.includes(id)
              return (
                <div
                  key={id}
                  ref={(el) => {
                    cardEls.current[id] = el
                  }}
                  className={`widget-card${collapsed ? ' collapsed' : ''}${draggingId === id ? ' dragging' : ''}`}
                >
                  <div
                    className="widget-card-head"
                    onPointerDown={(e) => onGripPointerDown(id, e)}
                    onPointerMove={onGripPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <span className="wc-icon">{WIDGET_CATALOG[id].icon}</span>
                    <span className="wc-head-title">{WIDGET_CATALOG[id].label}</span>
                    {/* Detach = its OWN HTML5-drag handle (the canvas-note ↗ pattern): the head's
                        pointer-capture reorder and the drag-off-the-rail never share one element. */}
                    <span
                      className="wc-ctrl wc-detach"
                      draggable
                      title="Drag onto the canvas to float this widget"
                      onPointerDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/mc-widget', id)
                        e.dataTransfer.effectAllowed = 'move'
                        const card = cardEls.current[id]
                        if (card) e.dataTransfer.setDragImage(card, 16, 12)
                      }}
                    >
                      ⇱
                    </span>
                    {/* Controls stop pointerdown so a click never arms the head's drag capture. */}
                    <button
                      className="wc-ctrl"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => toggleCard(id)}
                      title={collapsed ? 'Expand' : 'Collapse to a chip'}
                    >
                      {collapsed ? '▸' : '▾'}
                    </button>
                    <button
                      className="wc-ctrl close"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => remove(id)}
                      title="Remove from the rail"
                    >
                      ✕
                    </button>
                  </div>
                  {/* Collapsed card = chip only: the body unmounts, so its polling stops. */}
                  {!collapsed && (
                    <div className="widget-card-body">
                      <WidgetBody id={id} projectId={projectId} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}
