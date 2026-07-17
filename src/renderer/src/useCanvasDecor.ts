import { useCallback, useEffect, useRef, useState } from 'react'
import { readLS } from './usePaneView'
import {
  DEFAULT_DECOR,
  MAX_NOTES,
  MAX_STROKES,
  MAX_FRAMES,
  MAX_IMAGES,
  MAX_TEXTS,
  isDecorish,
  makeNote,
  makeStroke,
  makeFrame,
  makeImage,
  makeText,
  makeWelcomeDecor,
  sanitizeDecor,
  type BgStyle,
  type CanvasDecor,
  type CanvasNote,
  type CanvasFrame,
  type CanvasImage,
  type CanvasText,
  type StrokeKind
} from '@shared/canvas/decor'

interface Stored {
  key: string
  decor: CanvasDecor
}

/** Fired when a project's canvas decor (incl. background) is written to localStorage. */
export const CANVAS_DECOR_CHANGED = 'mc:canvas-decor'

/** file:// URL for a background picture, percent-encoding each path segment. */
export function bgFileUrl(path: string): string {
  return 'file://' + path.split('/').map(encodeURIComponent).join('/')
}

export const canvasDecorKey = (projectId: string | null): string => `mc.canvasdecor.${projectId ?? 'scratch'}`

/** The welcome composition is an install-level first-run gesture, not a recurring per-project
 *  popup. Deleting either seeded piece persists because this flag survives ordinary decor edits. */
export const CANVAS_WELCOMED_KEY = 'mc.canvasdecor.welcomed'

function notifyDecorChanged(key: string): void {
  window.dispatchEvent(new CustomEvent(CANVAS_DECOR_CHANGED, { detail: { key } }))
}

function load(key: string): Stored {
  try {
    if (localStorage.getItem(key) === null && localStorage.getItem(CANVAS_WELCOMED_KEY) !== '1') {
      const decor = makeWelcomeDecor()
      localStorage.setItem(key, JSON.stringify(decor))
      localStorage.setItem(CANVAS_WELCOMED_KEY, '1')
      return { key, decor }
    }
  } catch {
    /* storage unavailable -> fall through to the read-only default path */
  }
  // readLS wants a type guard; isDecorish is loose, sanitizeDecor does the real cleaning.
  const raw = readLS<{ bg: unknown; notes: unknown }>(key, { ...DEFAULT_DECOR }, isDecorish)
  return { key, decor: sanitizeDecor(raw) }
}

export function readCockpitBg(projectId: string | null): { bg: BgStyle; bgImage: string | undefined } {
  const { decor } = load(canvasDecorKey(projectId))
  return { bg: decor.bg, bgImage: decor.bgImage }
}

/** App-root reader: the unified cockpit background for the active project. Reloads on project
 *  switch and when decor is persisted (picker, external staging, etc.). */
export function useCockpitBackground(projectId: string | null): { bg: BgStyle; bgImage: string | undefined } {
  const key = canvasDecorKey(projectId)
  const [state, setState] = useState(() => ({ key, ...readCockpitBg(projectId) }))

  if (state.key !== key) setState({ key, ...readCockpitBg(projectId) })

  useEffect(() => {
    const reload = (e: Event): void => {
      if ((e as CustomEvent<{ key: string }>).detail?.key === key) setState({ key, ...readCockpitBg(projectId) })
    }
    window.addEventListener(CANVAS_DECOR_CHANGED, reload)
    window.addEventListener('mc:canvas-staged', reload)
    return () => {
      window.removeEventListener(CANVAS_DECOR_CHANGED, reload)
      window.removeEventListener('mc:canvas-staged', reload)
    }
  }, [key, projectId])

  return { bg: state.bg, bgImage: state.bgImage }
}

/** Append an image to a project's canvas decor from outside the Free view.
 *  Writes localStorage directly and fires mc:canvas-staged so a mounted Free view for that project
 *  live-reloads; if it isn't mounted, it loads the image on next open. Returns false if capped/failed. */
export function stageImageOnCanvas(projectId: string | null, path: string): boolean {
  const key = canvasDecorKey(projectId)
  const { decor } = load(key)
  if (decor.images.length >= MAX_IMAGES) return false
  const i = decor.images.length
  const next: CanvasDecor = {
    ...decor,
    images: [
      ...decor.images,
      makeImage(crypto.randomUUID(), 0.12 + (i % 6) * 0.03, 0.14 + (i % 6) * 0.03, 0.24, 0.2, path)
    ]
  }
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    return false
  }
  window.dispatchEvent(new CustomEvent('mc:canvas-staged', { detail: { key } }))
  return true
}

/** Persisted Free-mode canvas decor (background + sticky notes) for one project. Mirrors
 *  useFreeLayout: reload on project change during render, write-through to localStorage. */
export function useCanvasDecor(projectId: string | null): {
  decor: CanvasDecor
  setBg: (bg: BgStyle) => void
  setBgImage: (path: string) => void
  addNote: (fx: number, fy: number) => void
  updateNote: (id: string, patch: Partial<Pick<CanvasNote, 'text' | 'color' | 'ink' | 'fx' | 'fy' | 'fw' | 'fh'>>) => void
  removeNote: (id: string) => void
  addStroke: (kind: StrokeKind, color: string, width: number, pts: number[]) => void
  removeStroke: (id: string) => void
  clearStrokes: () => void
  undoStroke: () => void
  addFrame: (fx: number, fy: number, fw: number, fh: number) => void
  updateFrame: (id: string, patch: Partial<Pick<CanvasFrame, 'fx' | 'fy' | 'fw' | 'fh' | 'label' | 'color'>>) => void
  removeFrame: (id: string) => void
  addImage: (fx: number, fy: number, fw: number, fh: number, path: string) => void
  updateImage: (id: string, patch: Partial<Pick<CanvasImage, 'fx' | 'fy' | 'fw' | 'fh'>>) => void
  removeImage: (id: string) => void
  addText: (fx: number, fy: number) => void
  updateText: (id: string, patch: Partial<Pick<CanvasText, 'text' | 'color' | 'size' | 'fx' | 'fy'>>) => void
  removeText: (id: string) => void
} {
  const key = canvasDecorKey(projectId)
  const [state, setState] = useState<Stored>(() => load(key))
  const lastBgRef = useRef({
    key: state.key,
    bg: state.decor.bg,
    bgImage: state.decor.bgImage
  })

  // Reload when the project (key) changes — adjust state during render (React's documented
  // pattern), not in an effect, to avoid the react-hooks/set-state-in-effect rule.
  if (state.key !== key) setState(load(key))

  // An external stage wrote this project's decor to localStorage — reload
  // so a mounted Free view picks up the new image immediately (else it appears only on next open).
  useEffect(() => {
    const onStaged = (e: Event): void => {
      if ((e as CustomEvent<{ key: string }>).detail?.key === key) setState(load(key))
    }
    window.addEventListener('mc:canvas-staged', onStaged)
    return () => window.removeEventListener('mc:canvas-staged', onStaged)
  }, [key])

  useEffect(() => {
    const { bg, bgImage } = state.decor
    const last = lastBgRef.current
    if (last.key !== state.key) {
      lastBgRef.current = { key: state.key, bg, bgImage }
      return
    }
    if (bg !== last.bg || bgImage !== last.bgImage) {
      lastBgRef.current = { key: state.key, bg, bgImage }
      notifyDecorChanged(state.key)
    }
  }, [state])

  const mutate = useCallback((fn: (d: CanvasDecor) => CanvasDecor) => {
    setState((s) => {
      const next = { ...s, decor: fn(s.decor) }
      try {
        localStorage.setItem(next.key, JSON.stringify(next.decor))
      } catch {
        /* storage full/unavailable -> in-memory only */
      }
      return next
    })
  }, [])

  const setBg = useCallback((bg: BgStyle) => mutate((d) => ({ ...d, bg })), [mutate])
  // Set a picture background: store the path AND switch to 'image' mode atomically.
  const setBgImage = useCallback((path: string) => mutate((d) => ({ ...d, bgImage: path, bg: 'image' })), [mutate])

  const addNote = useCallback(
    (fx: number, fy: number) =>
      mutate((d) =>
        d.notes.length >= MAX_NOTES ? d : { ...d, notes: [...d.notes, makeNote(crypto.randomUUID(), fx, fy)] }
      ),
    [mutate]
  )

  const updateNote = useCallback(
    (id: string, patch: Partial<Pick<CanvasNote, 'text' | 'color' | 'ink' | 'fx' | 'fy'>>) =>
      mutate((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
    [mutate]
  )

  const removeNote = useCallback(
    (id: string) => mutate((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) })),
    [mutate]
  )

  const addStroke = useCallback(
    (kind: StrokeKind, color: string, width: number, pts: number[]) =>
      mutate((d) =>
        d.strokes.length >= MAX_STROKES
          ? d
          : { ...d, strokes: [...d.strokes, makeStroke(crypto.randomUUID(), kind, color, width, pts)] }
      ),
    [mutate]
  )

  const removeStroke = useCallback(
    (id: string) => mutate((d) => ({ ...d, strokes: d.strokes.filter((s) => s.id !== id) })),
    [mutate]
  )

  const clearStrokes = useCallback(
    () => mutate((d) => (d.strokes.length ? { ...d, strokes: [] } : d)),
    [mutate]
  )

  const undoStroke = useCallback(
    () => mutate((d) => (d.strokes.length ? { ...d, strokes: d.strokes.slice(0, -1) } : d)),
    [mutate]
  )

  const addFrame = useCallback(
    (fx: number, fy: number, fw: number, fh: number) =>
      mutate((d) =>
        d.frames.length >= MAX_FRAMES
          ? d
          : { ...d, frames: [...d.frames, makeFrame(crypto.randomUUID(), fx, fy, fw, fh)] }
      ),
    [mutate]
  )

  const updateFrame = useCallback(
    (id: string, patch: Partial<Pick<CanvasFrame, 'fx' | 'fy' | 'fw' | 'fh' | 'label' | 'color'>>) =>
      mutate((d) => ({ ...d, frames: d.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
    [mutate]
  )

  const removeFrame = useCallback(
    (id: string) => mutate((d) => ({ ...d, frames: d.frames.filter((f) => f.id !== id) })),
    [mutate]
  )

  const addImage = useCallback(
    (fx: number, fy: number, fw: number, fh: number, path: string) =>
      mutate((d) =>
        d.images.length >= MAX_IMAGES
          ? d
          : { ...d, images: [...d.images, makeImage(crypto.randomUUID(), fx, fy, fw, fh, path)] }
      ),
    [mutate]
  )

  const updateImage = useCallback(
    (id: string, patch: Partial<Pick<CanvasImage, 'fx' | 'fy' | 'fw' | 'fh'>>) =>
      mutate((d) => ({ ...d, images: d.images.map((im) => (im.id === id ? { ...im, ...patch } : im)) })),
    [mutate]
  )

  const removeImage = useCallback(
    (id: string) => mutate((d) => ({ ...d, images: d.images.filter((im) => im.id !== id) })),
    [mutate]
  )

  const addText = useCallback(
    (fx: number, fy: number) =>
      mutate((d) => (d.texts.length >= MAX_TEXTS ? d : { ...d, texts: [...d.texts, makeText(crypto.randomUUID(), fx, fy)] })),
    [mutate]
  )
  const updateText = useCallback(
    (id: string, patch: Partial<Pick<CanvasText, 'text' | 'color' | 'size' | 'fx' | 'fy'>>) =>
      mutate((d) => ({ ...d, texts: d.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    [mutate]
  )
  const removeText = useCallback(
    (id: string) => mutate((d) => ({ ...d, texts: d.texts.filter((t) => t.id !== id) })),
    [mutate]
  )

  return {
    decor: state.decor,
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
  }
}
