import React, { useCallback, useEffect, useRef, useState } from 'react'
import { NOTE_COLORS, NOTE_INK_COLORS, MAX_NOTE_TEXT, MIN_NOTE_FRAC, type CanvasNote as Note } from '@shared/canvas/decor'
import {
  HORIZON_MAX_X,
  HORIZON_MAX_Y,
  clampHorizonX,
  clampHorizonY,
  type ClientToCanvasPoint
} from '@shared/canvas/layout'

// A sticky note on the Free-mode canvas: dragged by its grip, RESIZED from the corner, text edited
// inline, recolored, deleted, and (send-handle) dragged into a terminal. Position + size are
// fractional (fx,fy,fw,fh) so it scales with the surface like the panes do.
export function CanvasNote({
  note,
  surfW,
  surfH,
  toCanvasPoint,
  onMove,
  onResize,
  onText,
  onColor,
  onInk,
  onRemove
}: {
  note: Note
  surfW: number
  surfH: number
  toCanvasPoint: ClientToCanvasPoint
  onMove: (fx: number, fy: number) => void
  onResize: (fw: number, fh: number) => void
  onText: (text: string) => void
  onColor: (color: string) => void
  onInk: (ink: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const [active, setActive] = useState(false)
  const drag = useRef<{ move?: (e: MouseEvent) => void; up?: () => void } | null>(null)

  const start = useCallback(
    (mode: 'move' | 'resize', e: React.MouseEvent): void => {
      if (
        mode === 'move' &&
        (e.target as HTMLElement).closest('button, textarea, .canvas-note-dot, .canvas-note-send, .canvas-note-resize')
      )
        return
      e.preventDefault()
      setActive(true)
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
      const p0 = toCanvasPoint(e.clientX, e.clientY)
      const { fx, fy, fw, fh } = note
      const move = (ev: MouseEvent): void => {
        // Released over a <webview> swallows the mouseup — buttons===0 → tear down, don't glue to cursor.
        if (ev.buttons === 0) return up()
        if (surfW <= 0 || surfH <= 0) return
        const p = toCanvasPoint(ev.clientX, ev.clientY)
        const dfx = p.x - p0.x
        const dfy = p.y - p0.y
        if (mode === 'move') {
          onMove(clampHorizonX(fx + dfx, fw), clampHorizonY(fy + dfy, fh))
        } else {
          onResize(
            Math.min(HORIZON_MAX_X - fx, Math.max(MIN_NOTE_FRAC, fw + dfx)),
            Math.min(HORIZON_MAX_Y - fy, Math.max(MIN_NOTE_FRAC, fh + dfy))
          )
        }
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        drag.current = null
      }
      drag.current = { move, up }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [note, surfW, surfH, toCanvasPoint, onMove, onResize]
  )

  useEffect(() => {
    return () => {
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
    }
  }, [])

  return (
    <div
      className={`canvas-note${active ? ' active' : ''}`}
      style={{
        left: note.fx * surfW,
        top: note.fy * surfH,
        width: note.fw * surfW,
        height: note.fh * surfH,
        background: note.color,
        borderColor: note.color
      }}
      onMouseDownCapture={() => setActive(true)}
      onBlurCapture={() => setActive(false)}
    >
      <div className="canvas-note-head" onMouseDown={(e) => start('move', e)} title="Drag to move">
        <span className="canvas-note-grip">⠿</span>
        <div className="canvas-note-dots">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              className={`canvas-note-dot${c === note.color ? ' on' : ''}`}
              style={{ background: c }}
              title="Recolor"
              onClick={() => onColor(c)}
            />
          ))}
        </div>
        <button
          className="canvas-note-ink"
          title="Font color"
          style={{ color: note.ink ?? NOTE_INK_COLORS[0] }}
          onClick={() => {
            const current = NOTE_INK_COLORS.indexOf(note.ink ?? NOTE_INK_COLORS[0])
            onInk(NOTE_INK_COLORS[(current + 1) % NOTE_INK_COLORS.length])
          }}
        >
          A
        </button>
        <span
          className="canvas-note-send"
          draggable={note.text.length > 0}
          title="Drag into a terminal to paste this note's text"
          onDragStart={(e) => {
            e.dataTransfer.setData('application/mc-text', note.text)
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          ↗
        </span>
        <button className="canvas-note-x" title="Delete note" onClick={onRemove}>
          ✕
        </button>
      </div>
      <textarea
        className="canvas-note-text"
        value={note.text}
        placeholder="Write…"
        spellCheck={false}
        maxLength={MAX_NOTE_TEXT}
        style={note.ink ? { color: note.ink } : undefined}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => setActive(true)}
      />
      <span className="canvas-note-resize" onMouseDown={(e) => start('resize', e)} title="Resize" />
    </div>
  )
}
