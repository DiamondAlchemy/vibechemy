// Pure model for the Free-mode canvas "decor" layer — the board's editable background and
// sticky notes. No React, no DOM: types + validation/sanitize so one bad localStorage entry
// can never crash the surface. Positions are home-basis FRACTIONS with a left/down horizon, so
// notes move and scale with the window exactly like Free-mode pane geometry (see canvas/layout.ts).

import { HORIZON_WIDTH_FRAC, clampHorizonX, clampHorizonY } from './layout'

/** Background treatment painted behind the live panes. 'image' = a user-chosen picture (bgImage);
 *  'aurora'/'starfield'/'nebula'/'fireflies'/'contour' = live animated grounds (pure CSS, slowed
 *  to a whisper so terminals stay the focus); the rest breathe or sit still. */
export type BgStyle =
  | 'plain'
  | 'dots'
  | 'grid'
  | 'blueprint'
  | 'gradient'
  | 'aurora'
  | 'starfield'
  | 'nebula'
  | 'fireflies'
  | 'contour'
  | 'image'
export const BG_STYLES: BgStyle[] = [
  'plain',
  'dots',
  'grid',
  'blueprint',
  'gradient',
  'aurora',
  'starfield',
  'nebula',
  'fireflies',
  'contour',
  'image'
]
export const BG_LABELS: Record<BgStyle, string> = {
  plain: 'Plain',
  dots: 'Dots',
  grid: 'Grid',
  blueprint: 'Blueprint',
  gradient: 'Gradient',
  aurora: 'Aurora ✦',
  starfield: 'Starfield ✦',
  nebula: 'Nebula ✦',
  fireflies: 'Fireflies ✦',
  contour: 'Contour ✦',
  image: 'Picture…'
}
export const MAX_BG_IMAGE_PATH = 2048

/** A small fixed palette for sticky notes (first entry is the default). */
export const NOTE_COLORS = ['#ffd54a', '#7fe3ff', '#5dffb0', '#ff9db1', '#c9a7ff', '#eef0f2']
/** Ink (font) palette for note TEXT — first entry mirrors the CSS default dark ink. */
export const NOTE_INK_COLORS = ['#1b1e22', '#eef0f2', '#c81e3a', '#0b5cad', '#0f7d46', '#7a4df0']

/** Bright ink palette for the freehand pen (first entry is the default). */
export const PEN_COLORS = ['#eef0f2', '#7fe3ff', '#5dffb0', '#ffd54a', '#ff9db1', '#c9a7ff']
/** Selectable pen widths (px at 1× surface); the middle one is the default. */
export const PEN_WIDTHS = [2, 3.5, 6]

/** Tint palette for section frames (rendered translucent fill + stronger border). */
export const FRAME_COLORS = ['#7fe3ff', '#5dffb0', '#ffd54a', '#ff9db1', '#c9a7ff', '#eef0f2']

/** Tool a stroke was drawn with. pen/highlighter are freehand; arrow/rect/ellipse are 2-point
 *  shapes that store exactly [x0,y0,x1,y1] (start + end of the drag). */
export type StrokeKind = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse'
export const STROKE_KINDS: StrokeKind[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse']
/** Kinds captured as a single start→end drag (two points), not freehand. */
export const TWO_POINT_KINDS: StrokeKind[] = ['arrow', 'rect', 'ellipse']

export interface CanvasNote {
  id: string
  /** Top-left in home-basis fractions, extended left/down by the canvas horizon. */
  fx: number
  fy: number
  /** Fractional size — resizable from the corner; old notes without it get a sensible default. */
  fw: number
  fh: number
  text: string
  /** Hex from NOTE_COLORS (any other value is coerced to the default on load). */
  color: string
  /** Font color from NOTE_INK_COLORS; absent = the CSS default dark ink (back-compatible). */
  ink?: string
}
export const MIN_NOTE_FRAC = 0.05
export const DEFAULT_NOTE_FW = 0.14
export const DEFAULT_NOTE_FH = 0.12
/** Clamp a note edge to the board span, defaulting a missing/bad value to `def`. */
export function clampNoteSize(n: unknown, def: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : def
  return Math.min(HORIZON_WIDTH_FRAC, Math.max(MIN_NOTE_FRAC, v))
}

/** Free-floating text typed DIRECTLY on the canvas (no sticky-note card) — double-click to add. */
export interface CanvasText {
  id: string
  fx: number
  fy: number
  text: string
  color: string
  /** Font size in px at 1× surface. */
  size: number
}
export const TEXT_COLORS = ['#eef0f2', '#7fe3ff', '#5dffb0', '#ffd54a', '#ff9db1', '#c9a7ff', '#ff5c5c', '#ff9f43']
export const TEXT_SIZES = [16, 22, 30, 44]
export const MAX_TEXTS = 80
export const MAX_TEXT_LEN = 1000
export function makeText(id: string, fx: number, fy: number, color = TEXT_COLORS[0], size = TEXT_SIZES[1]): CanvasText {
  return {
    id,
    fx: clampHorizonX(fx),
    fy: clampHorizonY(fy),
    text: '',
    color: TEXT_COLORS.includes(color) ? color : TEXT_COLORS[0],
    size: TEXT_SIZES.includes(size) ? size : TEXT_SIZES[1]
  }
}
function sanitizeText(v: unknown): CanvasText | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const text = typeof r.text === 'string' ? r.text.slice(0, MAX_TEXT_LEN) : ''
  const color = typeof r.color === 'string' && TEXT_COLORS.includes(r.color) ? r.color : TEXT_COLORS[0]
  const size = typeof r.size === 'number' && TEXT_SIZES.includes(r.size) ? r.size : TEXT_SIZES[1]
  return { id: r.id, fx: clampHorizonX(r.fx), fy: clampHorizonY(r.fy), text, color, size }
}

export interface CanvasStroke {
  id: string
  /** Tool this stroke was drawn with (arrow uses exactly the first two points). */
  kind: StrokeKind
  color: string
  width: number
  /** Flat home-basis coords [x0,y0,x1,y1,…], including the left/down horizon. */
  pts: number[]
}

export interface CanvasFrame {
  id: string
  /** Home-basis fractional rect so frames move AND scale with the surface. */
  fx: number
  fy: number
  fw: number
  fh: number
  label: string
  /** Hex from FRAME_COLORS (coerced to the default on load). */
  color: string
}

export interface CanvasImage {
  id: string
  /** Home-basis fractional rect so the image card moves AND scales with the surface. */
  fx: number
  fy: number
  fw: number
  fh: number
  /** Absolute filesystem path of the saved image (rendered via file://; dragged into a terminal
   *  as this path). Only the path is persisted — the bytes live in the served drops dir, so the
   *  localStorage blob stays tiny. */
  path: string
}

export interface CanvasDecor {
  bg: BgStyle
  /** Absolute path of the picture used when bg === 'image' (rendered via file://). */
  bgImage: string
  notes: CanvasNote[]
  strokes: CanvasStroke[]
  frames: CanvasFrame[]
  images: CanvasImage[]
  texts: CanvasText[]
}

export const DEFAULT_DECOR: CanvasDecor = {
  bg: 'plain',
  bgImage: '',
  notes: [],
  strokes: [],
  frames: [],
  images: [],
  texts: []
}

/** Stable ids for the first-run welcome composition. They let the layout distinguish the
 *  seeded guide pieces from content the operator created. */
export const WELCOME_NOTE_ID = 'welcome-note'
export const WELCOME_FRAME_ID = 'welcome-frame'

/** The install-level first-run board. The app keeps plain as the normal per-project default, while
 *  the one welcome seed opens on the richer Starfield ground. Coordinates stay inside Home
 *  (0..1); the canvas horizon continues to extend right/down for later operator placement. */
export function makeWelcomeDecor(): CanvasDecor {
  return {
    ...DEFAULT_DECOR,
    bg: 'starfield',
    notes: [
      {
        id: WELCOME_NOTE_ID,
        fx: 0.67,
        fy: 0.12,
        fw: 0.25,
        fh: 0.33,
        text: [
          'Welcome ✦',
          '',
          'This canvas is alive — everything on it moves:',
          '',
          '· drag me anywhere',
          '· double-click the sky to type on it',
          '· draw sketches right over your panes',
          '· the bg picker repaints these stars',
          '',
          'First stop: ⚙ Settings (top right) —',
          'install + sign in your agent CLIs there,',
          'then summon your first agent.',
          '',
          "I'm only a sticky note — × me whenever.",
          "I won't come back."
        ].join('\n'),
        color: NOTE_COLORS[0]
      }
    ],
    frames: [
      { id: WELCOME_FRAME_ID, fx: 0.06, fy: 0.24, fw: 0.29, fh: 0.44, label: 'launch pad', color: FRAME_COLORS[0] }
    ]
  }
}

/** A patterned sky is presentation, and the stable welcome pieces are first-run guidance. Only
 *  operator-created decor suppresses the welcome card. */
export function hasUserCanvasDecor(decor: CanvasDecor): boolean {
  return (
    decor.strokes.length > 0 ||
    decor.images.length > 0 ||
    decor.texts.length > 0 ||
    decor.bg === 'image' ||
    decor.notes.some((note) => note.id !== WELCOME_NOTE_ID) ||
    decor.frames.some((frame) => frame.id !== WELCOME_FRAME_ID)
  )
}

// Bound the persisted payload so a runaway can't bloat localStorage or the DOM.
export const MAX_NOTES = 80
export const MAX_NOTE_TEXT = 2000
export const MAX_STROKES = 400
export const MAX_STROKE_PTS = 4000 // flat length → 2000 points
export const MIN_PEN_WIDTH = 1
export const MAX_PEN_WIDTH = 14
export const MAX_FRAMES = 40
export const MAX_FRAME_LABEL = 60
export const MIN_FRAME_FRAC = 0.06 // smallest a frame edge can shrink to (fraction of surface)
export const MAX_IMAGES = 40
export const MIN_IMAGE_FRAC = 0.04 // smallest an image-card edge can shrink to (fraction of surface)
export const MAX_IMAGE_PATH = 2048

/** Clamp any input to a finite fraction in [0,1] (non-finite → 0), rounded to 4 decimals.
 *  Rounding (~0.2px at a 2000px surface) keeps persisted geometry/ink compact — full-precision
 *  doubles bloat the localStorage blob and the per-move JSON.stringify cost. */
export function clampFrac(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4
}

/** A fresh note at (fx,fy) with the given id — id is passed in so this stays pure/deterministic
 *  (renderer supplies crypto.randomUUID(); shared code never calls random/Date). */
export function makeNote(id: string, fx: number, fy: number, color = NOTE_COLORS[0]): CanvasNote {
  const fw = DEFAULT_NOTE_FW
  const fh = DEFAULT_NOTE_FH
  return {
    id,
    fx: clampHorizonX(fx, fw),
    fy: clampHorizonY(fy, fh),
    fw,
    fh,
    text: '',
    color: NOTE_COLORS.includes(color) ? color : NOTE_COLORS[0]
  }
}

function sanitizeNote(v: unknown): CanvasNote | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const text = typeof r.text === 'string' ? r.text.slice(0, MAX_NOTE_TEXT) : ''
  const color = typeof r.color === 'string' && NOTE_COLORS.includes(r.color) ? r.color : NOTE_COLORS[0]
  // Unknown/absent ink falls back to undefined (the CSS default), never a wrong literal.
  const ink = typeof r.ink === 'string' && NOTE_INK_COLORS.includes(r.ink) ? r.ink : undefined
  const fw = clampNoteSize(r.fw, DEFAULT_NOTE_FW)
  const fh = clampNoteSize(r.fh, DEFAULT_NOTE_FH)
  return {
    id: r.id,
    fx: clampHorizonX(r.fx, fw),
    fy: clampHorizonY(r.fy, fh),
    fw,
    fh,
    text,
    color,
    ...(ink ? { ink } : {})
  }
}

function clampPenWidth(w: unknown): number {
  return typeof w === 'number' && Number.isFinite(w) ? Math.min(MAX_PEN_WIDTH, Math.max(MIN_PEN_WIDTH, w)) : PEN_WIDTHS[1]
}

/** A committed stroke — id + kind + color + width + fractional flat points (needs ≥2 points to render). */
export function makeStroke(id: string, kind: StrokeKind, color: string, width: number, pts: number[]): CanvasStroke {
  const clean = pts.map((p, i) => (i % 2 === 0 ? clampHorizonX(p) : clampHorizonY(p)))
  if (clean.length % 2 !== 0) clean.pop()
  return {
    id,
    kind,
    color: PEN_COLORS.includes(color) ? color : PEN_COLORS[0],
    width: clampPenWidth(width),
    pts: clean.slice(0, MAX_STROKE_PTS)
  }
}

function sanitizeStroke(v: unknown): CanvasStroke | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || !Array.isArray(r.pts)) return null
  const kind = typeof r.kind === 'string' && STROKE_KINDS.includes(r.kind as StrokeKind) ? (r.kind as StrokeKind) : 'pen'
  const color = typeof r.color === 'string' && PEN_COLORS.includes(r.color) ? r.color : PEN_COLORS[0]
  const pts: number[] = []
  for (const p of r.pts as unknown[]) {
    pts.push(pts.length % 2 === 0 ? clampHorizonX(p) : clampHorizonY(p))
    if (pts.length >= MAX_STROKE_PTS) break
  }
  if (pts.length % 2 !== 0) pts.pop()
  if (pts.length < 4) return null // fewer than 2 points → nothing to draw
  return { id: r.id, kind, color, width: clampPenWidth(r.width), pts }
}

/** Clamp a frame edge to the board span. */
function clampFrameSize(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : MIN_FRAME_FRAC
  return Math.min(HORIZON_WIDTH_FRAC, Math.max(MIN_FRAME_FRAC, v))
}

export function makeFrame(
  id: string,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  label = '',
  color = FRAME_COLORS[0]
): CanvasFrame {
  const cleanFw = clampFrameSize(fw)
  const cleanFh = clampFrameSize(fh)
  return {
    id,
    fx: clampHorizonX(fx, cleanFw),
    fy: clampHorizonY(fy, cleanFh),
    fw: cleanFw,
    fh: cleanFh,
    label: label.slice(0, MAX_FRAME_LABEL),
    color: FRAME_COLORS.includes(color) ? color : FRAME_COLORS[0]
  }
}

function sanitizeFrame(v: unknown): CanvasFrame | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const label = typeof r.label === 'string' ? r.label.slice(0, MAX_FRAME_LABEL) : ''
  const color = typeof r.color === 'string' && FRAME_COLORS.includes(r.color) ? r.color : FRAME_COLORS[0]
  const fw = clampFrameSize(r.fw)
  const fh = clampFrameSize(r.fh)
  return {
    id: r.id,
    fx: clampHorizonX(r.fx, fw),
    fy: clampHorizonY(r.fy, fh),
    fw,
    fh,
    label,
    color
  }
}

/** Clamp an image-card edge to the board span. */
function clampImageSize(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : MIN_IMAGE_FRAC
  return Math.min(HORIZON_WIDTH_FRAC, Math.max(MIN_IMAGE_FRAC, v))
}

export function makeImage(id: string, fx: number, fy: number, fw: number, fh: number, path: string): CanvasImage {
  const cleanFw = clampImageSize(fw)
  const cleanFh = clampImageSize(fh)
  return {
    id,
    fx: clampHorizonX(fx, cleanFw),
    fy: clampHorizonY(fy, cleanFh),
    fw: cleanFw,
    fh: cleanFh,
    path: path.slice(0, MAX_IMAGE_PATH)
  }
}

function sanitizeImage(v: unknown): CanvasImage | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.path !== 'string' || !r.path) return null // no path → nothing to render
  const fw = clampImageSize(r.fw)
  const fh = clampImageSize(r.fh)
  return {
    id: r.id,
    fx: clampHorizonX(r.fx, fw),
    fy: clampHorizonY(r.fy, fh),
    fw,
    fh,
    path: r.path.slice(0, MAX_IMAGE_PATH)
  }
}

/** Loose shape check for readLS — accepts anything with a bg string and a notes array; the real
 *  cleaning happens in sanitizeDecor so partially-valid data survives rather than being dropped. */
export function isDecorish(v: unknown): v is { bg: unknown; notes: unknown } {
  return !!v && typeof v === 'object' && 'bg' in v && 'notes' in v && Array.isArray((v as { notes: unknown }).notes)
}

/** Coerce arbitrary loaded data into a valid CanvasDecor: unknown bg → 'plain', malformed notes
 *  dropped, note count capped. Never throws. */
export function sanitizeDecor(v: unknown): CanvasDecor {
  if (!isDecorish(v)) return { ...DEFAULT_DECOR }
  const bg = BG_STYLES.includes(v.bg as BgStyle) ? (v.bg as BgStyle) : 'plain'
  const rawBgImage = (v as { bgImage?: unknown }).bgImage
  const bgImage = typeof rawBgImage === 'string' ? rawBgImage.slice(0, MAX_BG_IMAGE_PATH) : ''
  const notes: CanvasNote[] = []
  for (const raw of v.notes as unknown[]) {
    const n = sanitizeNote(raw)
    if (n) notes.push(n)
    if (notes.length >= MAX_NOTES) break
  }
  const strokes: CanvasStroke[] = []
  const rawStrokes = (v as { strokes?: unknown }).strokes // optional → back-compatible with pre-ink data
  if (Array.isArray(rawStrokes)) {
    for (const raw of rawStrokes) {
      const s = sanitizeStroke(raw)
      if (s) strokes.push(s)
      if (strokes.length >= MAX_STROKES) break
    }
  }
  const frames: CanvasFrame[] = []
  const rawFrames = (v as { frames?: unknown }).frames // optional → back-compatible with pre-frame data
  if (Array.isArray(rawFrames)) {
    for (const raw of rawFrames) {
      const f = sanitizeFrame(raw)
      if (f) frames.push(f)
      if (frames.length >= MAX_FRAMES) break
    }
  }
  const images: CanvasImage[] = []
  const rawImages = (v as { images?: unknown }).images // optional → back-compatible with pre-image data
  if (Array.isArray(rawImages)) {
    for (const raw of rawImages) {
      const im = sanitizeImage(raw)
      if (im) images.push(im)
      if (images.length >= MAX_IMAGES) break
    }
  }
  const texts: CanvasText[] = []
  const rawTexts = (v as { texts?: unknown }).texts // optional → back-compatible with pre-text data
  if (Array.isArray(rawTexts)) {
    for (const raw of rawTexts) {
      const t = sanitizeText(raw)
      if (t) texts.push(t)
      if (texts.length >= MAX_TEXTS) break
    }
  }
  return { bg, bgImage, notes, strokes, frames, images, texts }
}
