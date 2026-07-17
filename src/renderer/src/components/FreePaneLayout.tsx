import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FreePane } from './FreePane'
import { TerminalPane } from './TerminalPane'
import { CanvasNote } from './CanvasNote'
import { CanvasFrame } from './CanvasFrame'
import { CanvasImageNode } from './CanvasImageNode'
import { CanvasTextNode } from './CanvasTextNode'
import { CanvasInk, type DrawMode } from './CanvasInk'
import { api } from '../api'
import { useFreeLayout } from '../useFreeLayout'
import { useCanvasDecor, stageImageOnCanvas } from '../useCanvasDecor'
import { useCanvasZoom, type ClientPoint } from '../useCanvasZoom'
import { fitScale, focusRect, pickFocusPane, type ZoomLevel, type ZoomPaneBox } from '@shared/canvas/zoom'
import {
  BG_STYLES,
  BG_LABELS,
  PEN_COLORS,
  PEN_WIDTHS,
  STROKE_KINDS,
  hasUserCanvasDecor,
  type BgStyle,
  type StrokeKind
} from '@shared/canvas/decor'
import {
  autoPlace,
  tidyRect,
  freeToPixels,
  pixelsToFree,
  clampFree,
  clampFreeHorizon,
  clientToHomeFractions,
  nudgeOutOfRect,
  fitInsideHome,
  isFreeCanvasEmpty,
  NODE_DEFAULT_W,
  NODE_DEFAULT_H,
  HORIZON_WIDTH_FRAC,
  HORIZON_HEIGHT_FRAC,
  type NodeRect,
  type FreeRect
} from '@shared/canvas/layout'
import type { SessionRecord } from '@shared/types'
import { TombstonePane } from './TombstonePane'
import type { Tombstone } from '../tombstones'

type PaneStyle = 'opaque' | 'glass'

const PANE_STYLE_KEY = 'mc.panestyle'
// v2 prefix: positions saved against the old right-anchored home (room down+LEFT) don't map onto
// the re-anchored board (home pinned at 0,0, room down+RIGHT) — the bump lands every board at the
// new home exactly once instead of restoring a now-meaningless offset.
const CANVAS_SCROLL_PREFIX = 'mc.canvasscroll2.'
const SCROLL_SAVE_DELAY_MS = 140

interface CanvasScrollPosition {
  left: number
  top: number
}

function loadPaneStyle(): PaneStyle {
  return window.localStorage.getItem(PANE_STYLE_KEY) === 'glass' ? 'glass' : 'opaque'
}

function canvasScrollKey(projectId: string | null): string {
  return `${CANVAS_SCROLL_PREFIX}${projectId ?? 'scratch'}`
}

function readCanvasScroll(key: string): CanvasScrollPosition | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown
    if (!value || typeof value !== 'object') return null
    const { left, top } = value as Record<string, unknown>
    if (typeof left !== 'number' || !Number.isFinite(left) || left < 0) return null
    if (typeof top !== 'number' || !Number.isFinite(top) || top < 0) return null
    return { left, top }
  } catch {
    return null
  }
}

function writeCanvasScroll(key: string, position: CanvasScrollPosition): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(position))
  } catch {
    /* storage full/unavailable -> scroll position is session-only */
  }
}

export function FreePaneLayout({
  sessions,
  projectId,
  colorFor,
  onMakeLead,
  onEnd,
  onHide,
  onSetColor,
  tombstones = [],
  presetLabel = (pid) => pid,
  onReviveTombstone = () => {},
  onDismissTombstone = () => {},
  active = true,
  orchPin = 'left',
  dockColumnRef
}: {
  sessions: SessionRecord[]
  projectId: string | null
  colorFor: (id: string) => string
  onMakeLead: (id: string) => void
  onEnd: (id: string) => void
  onHide: (id: string) => void
  onSetColor: (id: string, hex: string) => void
  tombstones?: Tombstone[] // compact revivable strip — no free-geometry integration
  presetLabel?: (presetId: string) => string
  onReviveTombstone?: (id: string) => void
  onDismissTombstone?: (id: string) => void
  /** True only when the cockpit (this canvas) is the visible view. The window-level undo and paste
   *  listeners gate on this so overlays cannot mutate the still-mounted hidden canvas. */
  active?: boolean
  /** Pin mode of the [Workspaces+Orchestrator] column — a mode change re-runs the exclusion heal
   *  (pinning center suddenly occludes panes that were legally placed). */
  orchPin?: 'left' | 'center' | 'right'
  /** The docked column's DOM element (owned by App, attached in Sidebar) — measured live, never a
   *  hardcoded width: its rect varies by pin mode, user resize, and content. */
  dockColumnRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const { nodes, setNode } = useFreeLayout(projectId)
  const {
    decor,
    setBg,
    setBgImage,
    addNote,
    updateNote,
    removeNote,
    addStroke,
    removeStroke,
    clearStrokes,
    undoStroke,
    addFrame,
    updateFrame,
    removeFrame,
    addImage,
    updateImage,
    removeImage,
    addText,
    updateText,
    removeText
  } = useCanvasDecor(projectId)
  const [frontId, setFrontId] = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>('off')
  const [penTool, setPenTool] = useState<StrokeKind>('pen')
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1])
  const [paneStyle, setPaneStyle] = useState<PaneStyle>(loadPaneStyle)
  const homeRef = useRef<HTMLDivElement | null>(null)
  const lastCanvasClientRef = useRef<ClientPoint | null>(null)
  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number) =>
      clientToHomeFractions(clientX, clientY, homeRef.current?.getBoundingClientRect() ?? null),
    []
  )
  const glassPanes = paneStyle === 'glass'
  const TOOL_GLYPH: Record<StrokeKind, string> = { pen: '✎', highlighter: '▬', arrow: '↗', rect: '▭', ellipse: '◯' }
  const TOOL_TITLE: Record<StrokeKind, string> = {
    pen: 'Pen',
    highlighter: 'Highlighter',
    arrow: 'Arrow',
    rect: 'Rectangle',
    ellipse: 'Ellipse'
  }

  // ⌘Z / Ctrl+Z undoes the last pen stroke — but only when focus isn't in an editable field
  // (note text, zone label, or a terminal's input textarea keep their own undo).
  const strokeCount = decor.strokes.length
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!active) return // canvas is hidden under an overlay — don't undo ink the user can't see
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (strokeCount === 0) return
      e.preventDefault()
      undoStroke()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, strokeCount, undoStroke])

  // Measure the surface so fractional geometry can be rendered to pixels and reflow on window resize.
  const [surf, setSurf] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const roRef = useRef<ResizeObserver | null>(null)
  const surfaceElRef = useRef<HTMLDivElement | null>(null) // the scroll container (zoom pins/restores its scroll)
  const surfaceRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    surfaceElRef.current = node
    if (!node) return
    const measure = (): void => setSurf({ w: node.clientWidth, h: node.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    roRef.current = ro
  }, [])

  const onSurfacePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    lastCanvasClientRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  // Cleared when the pointer leaves the canvas subtree (pointerleave doesn't fire for child
  // entries) so a Cmd+= issued while the cursor is over the dock/toolbar falls back to the
  // front pane instead of hit-testing a stale exit point.
  const onSurfacePointerLeave = useCallback((): void => {
    lastCanvasClientRef.current = null
  }, [])

  const scrollKey = canvasScrollKey(projectId)
  const scrollTimerRef = useRef<number | null>(null)
  const pendingScrollRef = useRef<{ key: string; position: CanvasScrollPosition } | null>(null)
  // Mirror of the semantic-zoom level for callbacks defined before the hook below (TDZ order);
  // synced in an effect after the hook. Scroll persistence only records DEFAULT-level positions —
  // the programmatic scroll-to-0 of Overview must never clobber the operator's saved spot.
  const zoomLevelRef = useRef<ZoomLevel>('default')
  const flushScroll = useCallback((): void => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = null
    const pending = pendingScrollRef.current
    pendingScrollRef.current = null
    if (pending) writeCanvasScroll(pending.key, pending.position)
  }, [])

  // FreePaneLayout stays mounted across project switches. Flush the outgoing project before
  // restoring the incoming one so a programmatic scroll event can never overwrite the old offset.
  useLayoutEffect(() => {
    flushScroll()
    lastCanvasClientRef.current = null
    const surface = surfaceElRef.current
    if (!surface) return
    const saved = readCanvasScroll(scrollKey)
    // Home IS the scroll origin (0,0) — the board's extra room extends right and down only.
    surface.scrollLeft = saved?.left ?? 0
    surface.scrollTop = saved?.top ?? 0
    return flushScroll
  }, [scrollKey, flushScroll])

  const onSurfaceScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>): void => {
      if (zoomLevelRef.current !== 'default') return
      pendingScrollRef.current = {
        key: scrollKey,
        position: { left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }
      }
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = window.setTimeout(flushScroll, SCROLL_SAVE_DELAY_MS)
    },
    [scrollKey, flushScroll]
  )

  const scrollHome = (): void => {
    const surface = surfaceElRef.current
    if (!surface) return
    surface.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
  }

  // The first-run card treats patterned skies and the stable welcome seed as presentation, but
  // every app content surface suppresses it. The canvas itself always remains interactive.
  const canvasEmpty = isFreeCanvasEmpty({
    sessions: sessions.length,
    tombstones: tombstones.length,
    mediaPanes: 0,
    widgets: 0,
    hasUserDecor: hasUserCanvasDecor(decor)
  })

  // The pane's fractional rect: saved, else an auto-placed default sized for the given surface.
  const freeFor = useCallback(
    (id: string, index: number, w: number, h: number): FreeRect => {
      const saved = nodes[id]
      if (saved) return clampFreeHorizon(saved, w, h)
      // New panes seed inside home even when enough rows would otherwise reach the lower horizon.
      return clampFree(pixelsToFree({ ...autoPlace(index), w: NODE_DEFAULT_W, h: NODE_DEFAULT_H }, w, h), w, h)
    },
    [nodes]
  )
  // Pixel rect handed to FreePane (which works in pixels); reflows whenever `surf` changes.
  const pixelFor = (id: string, index: number): NodeRect =>
    freeToPixels(freeFor(id, index, surf.w, surf.h), surf.w, surf.h)
  // FreePane reports a pixel rect on drag/resize → store it back as clamped fractions.
  const commit = (id: string, px: NodeRect): void =>
    setNode(id, clampFreeHorizon(pixelsToFree(px, surf.w, surf.h), surf.w, surf.h))

  // --- At-rest placement heals: dock exclusion zone + home-fold fit -----------------------------
  // The pinned [Workspaces+Orchestrator] column floats near-opaque OVER the canvas in pin-center,
  // so a pane released behind it is invisible; and a pane bleeding past the 75% home fold renders
  // cut at the surface edge. Both settle at REST moments only — drag release, layout load, pin
  // change — via the pure, unit-tested nudgeOutOfRect/fitInsideHome. Measurements are taken fresh
  // from the DOM (home rect gives origin AND surface size synchronously, so a pin flip can't race
  // the async ResizeObserver `surf` state); the in-flow pins sit outside the home rect and no-op
  // by geometry, no mode special-casing.
  const measureCanvas = useCallback((): { w: number; h: number; exclusion: NodeRect | null } | null => {
    const homeEl = homeRef.current
    if (!homeEl) return null
    // clientWidth/Height are LAYOUT values (transforms don't affect them) — the unscaled board
    // space every pane rect and fraction lives in; the bounding rect carries the Overview scale,
    // so dividing the column's client rect by the derived scale lands the exclusion in that same
    // board space at every zoom level (no min-size floor distortion from scaled screen pixels).
    const w = homeEl.clientWidth
    const h = homeEl.clientHeight
    if (w <= 0 || h <= 0) return null
    const rect = homeEl.getBoundingClientRect()
    const sx = rect.width > 0 ? rect.width / w : 1
    const sy = rect.height > 0 ? rect.height / h : 1
    let exclusion: NodeRect | null = null
    const col = dockColumnRef?.current
    if (col) {
      const r = col.getBoundingClientRect()
      if (r.width > 0 && r.height > 0)
        exclusion = { x: (r.left - rect.left) / sx, y: (r.top - rect.top) / sy, w: r.width / sx, h: r.height / sy }
    }
    return { w, h, exclusion }
  }, [dockColumnRef])
  const healRect = useCallback(
    (id: string, f: FreeRect, w: number, h: number, exclusion: NodeRect | null): void => {
      const px = freeToPixels(f, w, h)
      // Fold first, dock second: when both apply the exclusion zone wins — a pane may rest past
      // the fold to stay out from behind the column (the fold line makes that cut read as
      // continues-below, not broken).
      const fitted = fitInsideHome(px, { x: 0, y: 0, w, h })
      const base = fitted ?? px
      const pos = exclusion
        ? nudgeOutOfRect(base, exclusion, { x: 0, y: 0, w: w * HORIZON_WIDTH_FRAC, h: h * HORIZON_HEIGHT_FRAC })
        : null
      if (!fitted && !pos) return
      const final = pos ? { ...base, x: pos.x, y: pos.y } : base
      setNode(id, clampFreeHorizon(pixelsToFree(final, w, h), w, h))
    },
    [setNode]
  )
  const onPaneDragEnd = useCallback(
    (id: string, last: NodeRect): void => {
      // Default AND Overview releases settle (Overview arranges real geometry; measureCanvas
      // normalizes the dock rect into unscaled board space so the rules compose at any zoom);
      // Focus spotlight geometry is presentational, never settled.
      if (zoomLevelRef.current === 'focus') return
      const m = measureCanvas()
      if (!m) return
      // Normalize through the same clamp the mid-drag commits used, then settle at rest.
      healRect(id, clampFreeHorizon(pixelsToFree(last, m.w, m.h), m.w, m.h), m.w, m.h, m.exclusion)
    },
    [measureCanvas, healRect]
  )

  // --- Semantic zoom: Overview <-> Default <-> Focus ------------------------------------------
  // Pinch / Ctrl+wheel / Cmd+=/-/0 / the toolbar cluster all step the same three-stop machine.
  const paneIds = sessions.map((s) => s.id)
  // Focus target: HOVER-TO-FOCUS — hit-test the pointer against the SAME
  // pixel rects the panes render at. Pinch passes its own coords; keyboard/toolbar pass null and
  // use the last spot the pointer crossed the canvas (cleared on pointerleave, so the front pane
  // is the fallback only when the cursor genuinely isn't over the board). Ordering is the pure,
  // unit-tested pickFocusPane: hover > front > first.
  const pickPane = (point: ClientPoint | null): string | null => {
    const boxes: ZoomPaneBox[] = paneIds.map((id, i) => ({ id, rect: pixelFor(id, i) }))
    const client = point ?? lastCanvasClientRef.current
    const f = client ? toCanvasPoint(client.x, client.y) : null
    return pickFocusPane(f ? { x: f.x * surf.w, y: f.y * surf.h } : null, boxes, frontId)
  }
  const zoom = useCanvasZoom({ active, pickPane })
  const zoomLevel = zoom.level
  const zoomFocusedId = zoom.focusedId
  const zoomDefault = zoom.zoomDefault
  const overview = zoomLevel === 'overview'
  const focusMode = zoomLevel === 'focus' && zoomFocusedId !== null
  useEffect(() => {
    zoomLevelRef.current = zoomLevel
  }, [zoomLevel])

  // Ctrl+wheel must preventDefault (browser page-zoom) — React's root wheel listener is passive,
  // so bind natively with passive:false on the free-root element. CAPTURE phase is load-bearing:
  // xterm's mouse-protocol wheel listener preventDefault+stopPropagations unconditionally (its
  // custom-handler veto only suppresses the SGR report), so a bubble listener never sees a pinch
  // that starts over a terminal — capturing here claims ctrl-wheels before any pane path runs;
  // plain wheels pass through untouched (handleWheel bails without preventDefault).
  const rootRef = useRef<HTMLDivElement | null>(null)
  const handleZoomWheel = zoom.handleWheel
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.addEventListener('wheel', handleZoomWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', handleZoomWheel, { capture: true })
  }, [handleZoomWheel])

  // Zoomed levels freeze panning (overflow hidden) and pin the scroll to (0,0), the home origin for
  // both stops: Overview scales the whole board down
  // from it, and Focus relies on .free-home being exactly viewport-sized there. That geometry is a REAL
  // re-layout: the TerminalPane ResizeObserver fires and re-fits the xterm at full resolution
  // (crisp). The stored fractions are never touched, so leaving a zoomed level restores geometry
  // exactly, including the scroll spot saved here.
  const preZoomScrollRef = useRef<CanvasScrollPosition | null>(null)
  useLayoutEffect(() => {
    const surface = surfaceElRef.current
    if (!surface) return
    if (zoomLevel === 'default') {
      const saved = preZoomScrollRef.current
      if (saved) {
        preZoomScrollRef.current = null
        surface.scrollLeft = saved.left
        surface.scrollTop = saved.top
      }
      return
    }
    // Every step passes through Default (three-stop machine), so the saved spot is at most one.
    if (preZoomScrollRef.current === null) {
      preZoomScrollRef.current = { left: surface.scrollLeft, top: surface.scrollTop }
    }
    surface.scrollLeft = 0
    surface.scrollTop = 0
  }, [zoomLevel, surf.w, surf.h])

  // A focused pane that closes (session end) drops back to Default.
  useEffect(() => {
    if (!focusMode || !zoomFocusedId) return
    const alive = sessions.some((s) => s.id === zoomFocusedId)
    if (!alive) zoomDefault()
  }, [focusMode, zoomFocusedId, sessions, zoomDefault])

  // Zoom is per-canvas VIEW state (not persisted): a project switch lands at Default.
  useEffect(() => {
    zoomDefault()
  }, [projectId, zoomDefault])

  // At-rest heal moments (b) and (c): ONCE per project load after the surface and its panes are
  // ready (frees panes already stranded behind the column or past the fold), and on pin-mode change
  // (pinning center suddenly occludes panes that were legally placed). Moment (a), drag release, is
  // per-pane via onPaneDragEnd. Gated to
  // Default zoom like every other canvas placement path.
  const healedProjectRef = useRef<string | null>(null)
  const prevPinRef = useRef(orchPin)
  useEffect(() => {
    const key = projectId ?? 'scratch'
    const pinChanged = prevPinRef.current !== orchPin
    prevPinRef.current = orchPin
    const loadDue = healedProjectRef.current !== key && sessions.length > 0
    if (!pinChanged && !loadDue) return
    if (zoomLevel !== 'default') return
    const m = measureCanvas()
    if (!m) return
    if (loadDue) healedProjectRef.current = key
    const ids = sessions.map((s) => s.id)
    ids.forEach((id, i) => healRect(id, freeFor(id, i, m.w, m.h), m.w, m.h, m.exclusion))
  }, [projectId, orchPin, zoomLevel, sessions, measureCanvas, healRect, freeFor])

  // Board is HORIZON_*_FRAC (4/3) of the surface in both axes, so this is exactly 0.75 — kept as
  // the pure fitScale call so the math stays honest if the horizon ever changes.
  const overviewScale = overview
    ? fitScale(
        { width: surf.w * HORIZON_WIDTH_FRAC, height: surf.h * HORIZON_HEIGHT_FRAC },
        { width: surf.w, height: surf.h }
      )
    : 1

  // Focus SPOTLIGHT rect (full-viewport Focus is too much on a big monitor):
  // the focused pane comes ~2x forward, centered, capped/floored by the pure focusRect. Passed as
  // the pane's rect prop — a REAL resize (xterm re-fits crisp via the normal path), presentational
  // only (onGeom commits stay gated off-Default, so stored fractions restore exactly on exit).
  const spotlightIdx = focusMode && zoomFocusedId ? paneIds.indexOf(zoomFocusedId) : -1
  const spotlight =
    focusMode && zoomFocusedId !== null && spotlightIdx >= 0
      ? focusRect(pixelFor(zoomFocusedId, spotlightIdx), { width: surf.w, height: surf.h })
      : null

  // Reset every pane into an organized grid of small boxes (as fractions, so they keep scaling).
  const tidy = (): void => {
    const ids = sessions.map((session) => session.id)
    ids.forEach((id, i) => setNode(id, clampFree(pixelsToFree(tidyRect(i), surf.w, surf.h), surf.w, surf.h)))
    setFrontId(null)
  }

  // Drop a fresh note near the top-left, cascading so successive notes don't stack exactly.
  const addNoteHere = (): void => {
    const i = decor.notes.length
    addNote(0.06 + (i % 6) * 0.028, 0.14 + (i % 6) * 0.028)
  }

  // Drop a fresh section frame, cascaded so successive zones don't sit exactly on top of each other.
  const addFrameHere = (): void => {
    const i = decor.frames.length
    addFrame(0.1 + (i % 5) * 0.03, 0.2 + (i % 5) * 0.03, 0.34, 0.32)
  }

  // ＋ Image → native picker → stage the chosen image. Pinned to
  // the project active when the picker was opened (the dialog is async — same wrong-project race as
  // paste), and stageImageOnCanvas cascades + live-reloads for that project.
  const pickImageHere = (): void => {
    const pid = projectId
    void api.pickImage().then((path) => {
      if (path) stageImageOnCanvas(pid, path)
    })
  }

  // Drag image files from Finder onto empty canvas → stage each at the drop point (panes handle
  // their own drops — those attach the path to the terminal instead).
  const onSurfaceDragOver = (e: React.DragEvent): void => {
    if (zoomLevel !== 'default') return // Overview/Focus geometry is scaled/overridden — no drops
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }
  const onSurfaceDrop = (e: React.DragEvent): void => {
    if (zoomLevel !== 'default') return
    if ((e.target as HTMLElement).closest('.pane')) return // dropped on a terminal → let the pane handle it
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    const { x: fx, y: fy } = toCanvasPoint(e.clientX, e.clientY)
    files.forEach((f, i) => {
      const path = api.pathForFile(f)
      if (path) addImage(fx + i * 0.02, fy + i * 0.02, 0.22, 0.18, path)
    })
  }

  // Double-click empty canvas → drop a free-floating text there, ready to type. Ignored on panes,
  // decor cards, controls, or while the pen is active (that's a draw gesture).
  const onSurfaceDoubleClick = (e: React.MouseEvent): void => {
    if (zoomLevel !== 'default') return // a scaled Overview click would drop text at wrong coords
    if (drawMode !== 'off') return
    const t = e.target as HTMLElement
    if (t.closest('.pane, .canvas-note, .canvas-frame, .canvas-image, .canvas-text, button, input, textarea')) return
    const p = toCanvasPoint(e.clientX, e.clientY)
    addText(p.x, p.y)
  }

  return (
    <div
      ref={rootRef}
      className={`free-root${glassPanes ? ' glass-panes' : ''}${overview ? ' zoom-overview' : ''}${focusMode ? ' zoom-focus' : ''}`}
    >
      <div className="free-toolbar">
        {/* Shell spawn lives in the command bar below — the toolbar keeps only canvas-specific tools. */}
        <button className="free-btn" onClick={tidy} title="Tidy: reset all panes into a small grid">
          Tidy
        </button>
        <button className="free-btn" onClick={scrollHome} title="Return to the home canvas">
          ⌂ Home
        </button>
        <div className="free-zoom">
          <button
            className="free-btn"
            onClick={() => zoom.zoomStep(-1, null)}
            disabled={zoomLevel === 'overview'}
            title="Zoom out one stop (Cmd -) — Overview fits the whole canvas"
          >
            −
          </button>
          <button
            className="free-btn"
            onClick={zoomDefault}
            disabled={zoomLevel === 'default'}
            title="Back to Default zoom (Cmd 0)"
          >
            ⛶
          </button>
          <button
            className="free-btn"
            onClick={() => zoom.zoomStep(1, null)}
            disabled={zoomLevel === 'focus'}
            title="Zoom in one stop (Cmd =) — Focus fills the pane under the cursor"
          >
            ＋
          </button>
        </div>
        <button
          className={`free-btn${glassPanes ? ' on' : ''}`}
          aria-pressed={glassPanes}
          onClick={() => {
            const next: PaneStyle = glassPanes ? 'opaque' : 'glass'
            setPaneStyle(next)
            window.localStorage.setItem(PANE_STYLE_KEY, next)
          }}
          title="Field-test translucent pane chrome and terminal backgrounds"
        >
          Glass
        </button>
        <button className="free-btn" onClick={addNoteHere} title="Drop a sticky note on the canvas">
          ＋ Note
        </button>
        <button className="free-btn" onClick={addFrameHere} title="Drop a section frame (a labeled zone) on the canvas">
          ▢ Frame
        </button>
        <button
          className="free-btn"
          onClick={pickImageHere}
          title="Stage an image on the canvas (or paste / drag one from Finder) — drag it into a terminal later"
        >
          ＋ Image
        </button>
        <label className="free-bg-label" title="Canvas background">
          <span>bg</span>
          <select
            className="free-bg-select"
            value={decor.bg}
            onChange={(e) => {
              const v = e.target.value as BgStyle
              // 'Picture…' opens the native image picker; the chosen path sets an image background.
              if (v === 'image') void api.pickImage().then((p) => p && setBgImage(p))
              else setBg(v)
            }}
          >
            {BG_STYLES.map((b) => (
              <option key={b} value={b}>
                {BG_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        {decor.bg === 'image' && (
          <button
            className="free-btn"
            title="Choose a different background picture"
            onClick={() => void api.pickImage().then((p) => p && setBgImage(p))}
          >
            ⟳ Pic
          </button>
        )}
        <button
          className={`free-btn${drawMode !== 'off' ? ' on' : ''}`}
          onClick={() => setDrawMode((m) => (m === 'off' ? 'draw' : 'off'))}
          title="Draw freehand on the canvas"
        >
          ✏️ Draw
        </button>
        {drawMode !== 'off' && (
          <div className="free-pen">
            {STROKE_KINDS.map((t) => (
              <button
                key={t}
                className={`free-btn free-tool${penTool === t && drawMode === 'draw' ? ' on' : ''}`}
                title={TOOL_TITLE[t]}
                onClick={() => {
                  setPenTool(t)
                  setDrawMode('draw')
                }}
              >
                {TOOL_GLYPH[t]}
              </button>
            ))}
            <div className="canvas-note-dots">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  className={`canvas-note-dot${c === penColor ? ' on' : ''}`}
                  style={{ background: c }}
                  title="Pen color"
                  onClick={() => {
                    setPenColor(c)
                    setDrawMode('draw')
                  }}
                />
              ))}
            </div>
            {PEN_WIDTHS.map((w, i) => (
              <button
                key={w}
                className={`free-btn free-pen-w${w === penWidth ? ' on' : ''}`}
                title={`Pen ${['thin', 'medium', 'thick'][i]}`}
                onClick={() => {
                  setPenWidth(w)
                  setDrawMode('draw')
                }}
              >
                {'•'.repeat(i + 1)}
              </button>
            ))}
            <button
              className={`free-btn${drawMode === 'erase' ? ' on' : ''}`}
              onClick={() => setDrawMode((m) => (m === 'erase' ? 'draw' : 'erase'))}
              title="Eraser: click a stroke to remove it"
            >
              Erase
            </button>
            <button
              className="free-btn"
              onClick={undoStroke}
              disabled={decor.strokes.length === 0}
              title="Undo the last stroke (⌘Z)"
            >
              ↶ Undo
            </button>
            <button className="free-btn" onClick={clearStrokes} title="Clear all ink">
              Clear
            </button>
          </div>
        )}
      </div>
      {tombstones.length > 0 && (
        // Dead panes surface as a compact strip in Free mode (no free geometry of their own).
        <div className="tombstone-strip">
          {tombstones.map((t) => (
            <TombstonePane
              key={t.session.id}
              t={t}
              compact
              presetLabel={presetLabel(t.session.presetId)}
              onRevive={onReviveTombstone}
              onDismiss={onDismissTombstone}
            />
          ))}
        </div>
      )}
      <div
        className="free-surface"
        ref={surfaceRef}
        onDragOver={onSurfaceDragOver}
        onDrop={onSurfaceDrop}
        onDoubleClick={onSurfaceDoubleClick}
        onPointerMove={onSurfacePointerMove}
        onPointerLeave={onSurfacePointerLeave}
        onScroll={onSurfaceScroll}
      >
        {/* The board is the Overview transform target: everything on the canvas scales together
            (visual transform only — terminals stay live, no reflow). */}
        <div
          className="free-board"
          style={overview ? { transform: `scale(${overviewScale})`, transformOrigin: '0 0' } : undefined}
        >
          <div className="free-fold" aria-hidden="true" />
          <div ref={homeRef} className="free-home">
          {canvasEmpty && (
            <div className="free-empty-hint">
              <div className="free-hero">
                <svg className="free-hero-constellation" viewBox="0 0 64 42" width="64" height="42" aria-hidden="true">
                  <path
                    d="M8 33 L20 15 L34 23 L46 9 L56 17"
                    fill="none"
                    stroke="rgba(127,227,255,0.38)"
                    strokeWidth="1"
                    strokeDasharray="1.5 2.5"
                  />
                  <circle cx="8" cy="33" r="1.7" fill="#dff3ff" />
                  <circle cx="20" cy="15" r="2.5" fill="#ffffff" />
                  <circle cx="34" cy="23" r="1.6" fill="#cfeaff" />
                  <circle cx="46" cy="9" r="2.2" fill="#ffffff" />
                  <circle cx="56" cy="17" r="1.4" fill="#dff3ff" />
                </svg>
                <div className="free-hero-title">Welcome to the cockpit</div>
                <div className="free-hero-sub">
                  A live canvas for your agents. Open a shell — or summon one from the left rail — then drag panes
                  anywhere, pin notes and frames, and sketch right over the work.
                </div>
                <div className="free-hero-keys">
                  <span>＋ Shell</span>
                  <span>double-click to type</span>
                  <span>✎ draw</span>
                  <span>＋ note</span>
                  <span>▢ frame</span>
                </div>
                <div className="free-hero-foot">The sky is real — repaint it with the bg picker in the toolbar.</div>
              </div>
            </div>
          )}
          {decor.frames.length > 0 && (
            <div className="canvas-frames">
              {decor.frames.map((f) => (
                <CanvasFrame
                  key={f.id}
                  frame={f}
                  surfW={surf.w}
                  surfH={surf.h}
                  toCanvasPoint={toCanvasPoint}
                  onMove={(fx, fy) => updateFrame(f.id, { fx, fy })}
                  onResize={(fw, fh) => updateFrame(f.id, { fw, fh })}
                  onLabel={(label) => updateFrame(f.id, { label })}
                  onColor={(color) => updateFrame(f.id, { color })}
                  onRemove={() => removeFrame(f.id)}
                />
              ))}
            </div>
          )}
          {decor.notes.length > 0 && (
            <div className="canvas-notes">
              {decor.notes.map((n) => (
                <CanvasNote
                  key={n.id}
                  note={n}
                  surfW={surf.w}
                  surfH={surf.h}
                  toCanvasPoint={toCanvasPoint}
                  onMove={(fx, fy) => updateNote(n.id, { fx, fy })}
                  onResize={(fw, fh) => updateNote(n.id, { fw, fh })}
                  onText={(text) => updateNote(n.id, { text })}
                  onColor={(color) => updateNote(n.id, { color })}
                  onInk={(ink) => updateNote(n.id, { ink })}
                  onRemove={() => removeNote(n.id)}
                />
              ))}
            </div>
          )}
          {decor.images.length > 0 && (
            <div className="canvas-images">
              {decor.images.map((im) => (
                <CanvasImageNode
                  key={im.id}
                  image={im}
                  surfW={surf.w}
                  surfH={surf.h}
                  toCanvasPoint={toCanvasPoint}
                  onMove={(fx, fy) => updateImage(im.id, { fx, fy })}
                  onResize={(fw, fh) => updateImage(im.id, { fw, fh })}
                  onRemove={() => removeImage(im.id)}
                />
              ))}
            </div>
          )}
          {decor.texts.length > 0 && (
            <div className="canvas-texts">
              {decor.texts.map((tx) => (
                <CanvasTextNode
                  key={tx.id}
                  text={tx}
                  surfW={surf.w}
                  surfH={surf.h}
                  toCanvasPoint={toCanvasPoint}
                  onMove={(fx, fy) => updateText(tx.id, { fx, fy })}
                  onText={(text) => updateText(tx.id, { text })}
                  onColor={(color) => updateText(tx.id, { color })}
                  onSize={(size) => updateText(tx.id, { size })}
                  onRemove={() => removeText(tx.id)}
                />
              ))}
            </div>
          )}
          {sessions.map((s, i) => {
            const zs = focusMode ? (zoomFocusedId === s.id ? ('focused' as const) : ('hidden' as const)) : undefined
            return (
              <FreePane
                key={s.id}
                rect={zs === 'focused' && spotlight ? spotlight : pixelFor(s.id, i)}
                front={frontId === s.id || zs === 'focused'}
                onGeom={(rect) => {
                  // Focus geometry is presentational (the spotlight) — never commit it over the
                  // stored fractions. Overview commits are REAL: the board is uniformly scaled,
                  // so a header drag arranges actual home-space geometry;
                  // the fraction math self-corrects for the scale via the live home rect.
                  if (zoomLevel === 'focus') return
                  commit(s.id, rect)
                }}
                onDragEnd={(last) => onPaneDragEnd(s.id, last)}
                onFront={() => setFrontId(s.id)}
                toCanvasPoint={toCanvasPoint}
                surfW={surf.w}
                surfH={surf.h}
                zoomState={zs}
              >
                {(startMove) => (
                  <TerminalPane
                    session={s}
                    presetLabel={presetLabel(s.presetId)}
                    accent={colorFor(s.id)}
                    onMoveStart={startMove}
                    onToggleLead={() => onMakeLead(s.id)}
                    onClose={() => onEnd(s.id)}
                    onHide={() => onHide(s.id)}
                    onSetColor={(hex) => onSetColor(s.id, hex)}
                    transparentBackground={glassPanes}
                  />
                )}
              </FreePane>
            )
          })}
          <CanvasInk
            strokes={decor.strokes}
            surfW={surf.w}
            surfH={surf.h}
            toCanvasPoint={toCanvasPoint}
            mode={drawMode}
            tool={penTool}
            penColor={penColor}
            penWidth={penWidth}
            onCommit={addStroke}
            onErase={removeStroke}
          />
          </div>
        </div>
        {focusMode && (
          // Always-visible click path out of Focus, anchored to the spotlight pane's top-right
          // corner just below its header (pinch/Cmd-0 also work; Esc is deliberately NOT bound —
          // terminals own it). mousedown preventDefault keeps the terminal's keyboard focus — the
          // click must never blur the pane. Scroll is pinned to (0,0) in Focus, so the surface
          // padding box equals the viewport and `right` anchors correctly.
          <button
            className="free-btn free-focus-exit"
            style={
              spotlight
                ? { top: spotlight.y + 44, right: Math.max(8, surf.w - spotlight.x - spotlight.w + 14) }
                : undefined
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={zoomDefault}
            title="Back to the canvas (Cmd 0, or pinch out)"
          >
            ⛶ Canvas
          </button>
        )}
      </div>
    </div>
  )
}
