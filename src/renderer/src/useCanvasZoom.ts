import { useCallback, useEffect, useRef, useState } from 'react'
import {
  stepZoom,
  accumulateZoomWheel,
  ZOOM_WHEEL_IDLE,
  type ZoomLevel,
  type ZoomStepDirection,
  type ZoomWheelState
} from '@shared/canvas/zoom'

export interface ClientPoint {
  x: number
  y: number
}

export interface CanvasZoom {
  level: ZoomLevel
  focusedId: string | null
  /** Move one discrete stop. `point` is the client coords to hit-test for the Focus target
   *  (wheel passes the cursor; keyboard/buttons pass null → pickPane falls back). */
  zoomStep: (direction: ZoomStepDirection, point: ClientPoint | null) => void
  /** Jump straight back to Default from any level (Cmd+0 / the ⛶ control). */
  zoomDefault: () => void
  /** Native wheel handler — attach with { passive: false } so preventDefault beats page-zoom. */
  handleWheel: (e: WheelEvent) => void
}

/**
 * Semantic-zoom state for the Free canvas: Overview -> Default -> Focus, driven by trackpad
 * pinch / mouse Ctrl+wheel (both arrive as wheel events with ctrlKey), Cmd+= / Cmd+- / Cmd+0,
 * and the on-screen toolbar cluster. Pure stepping/accumulation lives in @shared/canvas/zoom.
 */
export function useCanvasZoom({
  active,
  pickPane
}: {
  /** Only handle keyboard input while the canvas is the VISIBLE view. */
  active: boolean
  /** Resolve the Focus target: hit-test `point` when given, else fall back (front/first pane).
   *  Returning null refuses the Default -> Focus step (nothing to focus). */
  pickPane: (point: ClientPoint | null) => string | null
}): CanvasZoom {
  const [state, setState] = useState<{ level: ZoomLevel; focusedId: string | null }>({
    level: 'default',
    focusedId: null
  })
  const wheelRef = useRef<ZoomWheelState>(ZOOM_WHEEL_IDLE)

  // Synced in an effect, not during render (react-hooks/refs), so zoomStep stays stable while
  // always hit-testing against the caller's current pane geometry.
  const pickRef = useRef(pickPane)
  useEffect(() => {
    pickRef.current = pickPane
  }, [pickPane])

  const zoomStep = useCallback((direction: ZoomStepDirection, point: ClientPoint | null): void => {
    setState((prev) => {
      const next = stepZoom(prev.level, direction)
      if (next === prev.level) return prev
      if (next === 'focus') {
        const id = pickRef.current(point)
        if (!id) return prev // empty canvas / no target — stay at Default
        return { level: 'focus', focusedId: id }
      }
      return { level: next, focusedId: null }
    })
  }, [])

  const zoomDefault = useCallback((): void => {
    wheelRef.current = ZOOM_WHEEL_IDLE
    setState((prev) =>
      prev.level === 'default' && prev.focusedId === null ? prev : { level: 'default', focusedId: null }
    )
  }, [])

  const handleWheel = useCallback(
    (e: WheelEvent): void => {
      if (!e.ctrlKey) return // plain wheel keeps panning/scrolling the canvas as today
      e.preventDefault() // pinch/Ctrl+wheel must never trigger the browser's own page-zoom
      const r = accumulateZoomWheel(wheelRef.current, e.deltaY, e.timeStamp)
      wheelRef.current = r.next
      if (r.step !== 0) zoomStep(r.step, { x: e.clientX, y: e.clientY })
    },
    [zoomStep]
  )

  // Cmd+= in / Cmd+- out / Cmd+0 default. No editable-target guard: these combos type nothing,
  // and the most common focus is a terminal textarea — guarding would make the keys dead there.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomStep(1, null)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomStep(-1, null)
      } else if (e.key === '0') {
        e.preventDefault()
        zoomDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, zoomStep, zoomDefault])

  return { level: state.level, focusedId: state.focusedId, zoomStep, zoomDefault, handleWheel }
}
