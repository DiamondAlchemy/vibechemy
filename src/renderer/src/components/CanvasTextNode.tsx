import React, { useCallback, useEffect, useRef } from 'react'
import { TEXT_COLORS, TEXT_SIZES, MAX_TEXT_LEN, type CanvasText as Txt } from '@shared/canvas/decor'
import { clampHorizonX, clampHorizonY, type ClientToCanvasPoint } from '@shared/canvas/layout'

// Free-floating text typed DIRECTLY on the canvas (no sticky-note card). Editable inline via
// contentEditable (seeded once on mount to avoid cursor jumps), moved by a hover grip, recolored /
// resized / deleted from a hover toolbar. An empty text auto-removes on blur so an abandoned
// double-click never leaves a ghost.
export function CanvasTextNode({
  text,
  surfW,
  surfH,
  toCanvasPoint,
  onMove,
  onText,
  onColor,
  onSize,
  onRemove
}: {
  text: Txt
  surfW: number
  surfH: number
  toCanvasPoint: ClientToCanvasPoint
  onMove: (fx: number, fy: number) => void
  onText: (t: string) => void
  onColor: (c: string) => void
  onSize: (s: number) => void
  onRemove: () => void
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ move?: (e: MouseEvent) => void; up?: () => void } | null>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (el.textContent !== text.text) el.textContent = text.text
    if (text.text === '') el.focus() // a freshly-created text → ready to type
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the DOM ONCE; state must not write back (cursor jumps)
  }, [])

  const startMove = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
      const p0 = toCanvasPoint(e.clientX, e.clientY)
      const fx0 = text.fx
      const fy0 = text.fy
      const rect = rootRef.current?.getBoundingClientRect()
      const fw = rect && surfW > 0 ? rect.width / surfW : 0
      const fh = rect && surfH > 0 ? rect.height / surfH : 0
      const move = (ev: MouseEvent): void => {
        if (ev.buttons === 0) return up()
        if (surfW <= 0 || surfH <= 0) return
        const p = toCanvasPoint(ev.clientX, ev.clientY)
        onMove(clampHorizonX(fx0 + p.x - p0.x, fw), clampHorizonY(fy0 + p.y - p0.y, fh))
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
    [text.fx, text.fy, surfW, surfH, toCanvasPoint, onMove]
  )

  useEffect(
    () => () => {
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
    },
    []
  )

  return (
    <div ref={rootRef} className="canvas-text" style={{ left: text.fx * surfW, top: text.fy * surfH }}>
      <div className="canvas-text-tools">
        <span className="canvas-text-grip" onMouseDown={startMove} title="Drag to move">
          ⠿
        </span>
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            className={`canvas-note-dot${c === text.color ? ' on' : ''}`}
            style={{ background: c }}
            title="Color"
            onClick={() => onColor(c)}
          />
        ))}
        <button
          className="canvas-text-size"
          title="Cycle size"
          onClick={() => onSize(TEXT_SIZES[(TEXT_SIZES.indexOf(text.size) + 1) % TEXT_SIZES.length])}
        >
          A
        </button>
        <button className="canvas-text-x" title="Delete" onClick={onRemove}>
          ✕
        </button>
      </div>
      <div
        ref={bodyRef}
        className="canvas-text-body"
        contentEditable
        suppressContentEditableWarning
        style={{ color: text.color, fontSize: text.size }}
        onInput={(e) => onText((e.currentTarget.textContent ?? '').slice(0, MAX_TEXT_LEN))}
        onBlur={(e) => {
          if (!(e.currentTarget.textContent ?? '').trim()) onRemove()
        }}
      />
    </div>
  )
}
