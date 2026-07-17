import React, { useCallback, useEffect, useRef } from 'react'
import { MIN_IMAGE_FRAC, type CanvasImage as Img } from '@shared/canvas/decor'
import {
  HORIZON_MAX_X,
  HORIZON_MAX_Y,
  clampHorizonX,
  clampHorizonY,
  type ClientToCanvasPoint
} from '@shared/canvas/layout'

/** Build a file:// URL from an absolute path, percent-encoding each segment so a legal filename
 *  char like '#', '?', '%', or a space doesn't truncate/break the URL. */
function toFileUrl(path: string): string {
  return 'file://' + path.split('/').map(encodeURIComponent).join('/')
}

// A staged image on the Free-mode canvas. Move it by the header grip, resize from the corner,
// delete with ✕. The picture itself is HTML5-draggable: dragging it onto a terminal pane drops
// its file PATH into that shell (TerminalPane reads 'application/mc-image'), so a CLI can attach
// the image. Fractional rect so it scales with the surface like the other decor.
export function CanvasImageNode({
  image,
  surfW,
  surfH,
  toCanvasPoint,
  onMove,
  onResize,
  onRemove
}: {
  image: Img
  surfW: number
  surfH: number
  toCanvasPoint: ClientToCanvasPoint
  onMove: (fx: number, fy: number) => void
  onResize: (fw: number, fh: number) => void
  onRemove: () => void
}): React.JSX.Element {
  const drag = useRef<{ move?: (e: MouseEvent) => void; up?: () => void } | null>(null)

  const start = useCallback(
    (mode: 'move' | 'resize', e: React.MouseEvent): void => {
      if (mode === 'move' && (e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
      const p0 = toCanvasPoint(e.clientX, e.clientY)
      const { fx, fy, fw, fh } = image
      const move = (ev: MouseEvent): void => {
        if (ev.buttons === 0) return up() // released over a webview → tear down, don't glue to cursor
        if (surfW <= 0 || surfH <= 0) return
        const p = toCanvasPoint(ev.clientX, ev.clientY)
        const dfx = p.x - p0.x
        const dfy = p.y - p0.y
        if (mode === 'move') {
          onMove(clampHorizonX(fx + dfx, fw), clampHorizonY(fy + dfy, fh))
        } else {
          onResize(
            Math.min(HORIZON_MAX_X - fx, Math.max(MIN_IMAGE_FRAC, fw + dfx)),
            Math.min(HORIZON_MAX_Y - fy, Math.max(MIN_IMAGE_FRAC, fh + dfy))
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
    [image, surfW, surfH, toCanvasPoint, onMove, onResize]
  )

  useEffect(() => {
    return () => {
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
    }
  }, [])

  return (
    <div
      className="canvas-image"
      style={{
        left: image.fx * surfW,
        top: image.fy * surfH,
        width: image.fw * surfW,
        height: image.fh * surfH
      }}
    >
      <div className="canvas-image-head" onMouseDown={(e) => start('move', e)} title="Drag to move">
        <span className="canvas-image-grip">⠿</span>
        <span className="canvas-image-hint">drag pic ▸ terminal</span>
        <button className="canvas-image-x" title="Remove" onClick={onRemove}>
          ✕
        </button>
      </div>
      <img
        className="canvas-image-body"
        src={toFileUrl(image.path)}
        alt=""
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/mc-image', image.path)
          e.dataTransfer.effectAllowed = 'copy'
        }}
      />
      <span className="canvas-image-resize" onMouseDown={(e) => start('resize', e)} title="Resize" />
    </div>
  )
}
