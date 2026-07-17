// Widget-card catalog + persisted rail state for the Free-canvas widget layer.
// Pure and DOM-free: the renderer hook/components consume this; unit tests live alongside.

import { HORIZON_MAX_X, HORIZON_MAX_Y, clampHorizonX, clampHorizonY } from '../canvas/layout'

export const WIDGET_IDS = ['usage', 'sessions'] as const
export type WidgetId = (typeof WIDGET_IDS)[number]

export interface WidgetMeta {
  id: WidgetId
  label: string
  /** One-glyph identity for the collapsed rail strip and title chips. */
  icon: string
  /** Refresh cadence while the card is EXPANDED — a collapsed card's body unmounts, so it stops polling. */
  pollMs: number
}

export const WIDGET_CATALOG: Record<WidgetId, WidgetMeta> = {
  usage: { id: 'usage', label: 'Plan Usage', icon: '◔', pollMs: 30_000 },
  sessions: { id: 'sessions', label: 'Sessions', icon: '⬡', pollMs: 5_000 }
}

export function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === 'string' && (WIDGET_IDS as readonly string[]).includes(v)
}

/** A card detached from the rail onto the canvas: top-left corner + size as fractions of the Free
 *  home viewport (same coordinate space as canvas notes — horizon-clamped, 0..1+room). */
export interface PlacedWidget {
  id: WidgetId
  fx: number
  fy: number
  fw: number
  fh: number
}

// Floating-card size model (the CanvasNote fw/fh pattern): fractional, sanitized between a small
// absolute floor and "most of the viewport"; gesture-time minimums are pixel-aware in the
// component (the rail card's footprint, so a floating card never shrinks below the rail look).
export const WIDGET_MIN_FRAC = 0.06
export const WIDGET_MAX_FRAC = 0.9
export const WIDGET_DEFAULT_FW = 0.16
export const WIDGET_DEFAULT_FH = 0.26
/** The rail card's pixel footprint — the detach-time default size and the resize floor. */
export const WIDGET_CARD_W = 252
export const WIDGET_CARD_H = 284
export const WIDGET_MIN_H = 120

/** Clamp a floating card edge to the sane span, defaulting a missing/bad value to `def`. */
export function clampWidgetSize(n: unknown, def: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : def
  return Math.min(WIDGET_MAX_FRAC, Math.max(WIDGET_MIN_FRAC, v))
}

/** Rail state persisted per project (localStorage `mc.widgets.<projectId ?? 'scratch'>`). */
export interface WidgetsState {
  /** Cards on the rail, top-to-bottom order. */
  open: WidgetId[]
  /** Subset of `open` shrunk to a title chip. */
  collapsed: WidgetId[]
  /** Whole rail folded to a thin strip of icons. */
  railCollapsed: boolean
  /** Cards floating free on the canvas. A card lives EITHER here OR in `open`, never both. */
  placed: PlacedWidget[]
}

export const DEFAULT_WIDGETS_STATE: WidgetsState = { open: [], collapsed: [], railCollapsed: false, placed: [] }

export function widgetsStorageKey(projectId: string | null): string {
  return `mc.widgets.${projectId ?? 'scratch'}`
}

// Dedupe while keeping only known widget ids, preserving first-seen order.
function cleanIds(v: unknown): WidgetId[] {
  if (!Array.isArray(v)) return []
  const out: WidgetId[] = []
  for (const id of v) if (isWidgetId(id) && !out.includes(id)) out.push(id)
  return out
}

// Recover the placed list: entries must be objects with a known id; duplicate ids drop (first
// wins), an id also on the rail drops (the rail wins — one card, one home), size defaults when
// missing/bad (pre-size saves stay loadable), and the position clamp is size-aware like every
// canvas decor coordinate (non-finite → 0 via the clamp itself).
function cleanPlaced(v: unknown, open: WidgetId[]): PlacedWidget[] {
  if (!Array.isArray(v)) return []
  const out: PlacedWidget[] = []
  for (const entry of v) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const { id, fx, fy, fw, fh } = entry as Record<string, unknown>
    if (!isWidgetId(id)) continue
    if (open.includes(id) || out.some((p) => p.id === id)) continue
    const cleanFw = clampWidgetSize(fw, WIDGET_DEFAULT_FW)
    const cleanFh = clampWidgetSize(fh, WIDGET_DEFAULT_FH)
    out.push({ id, fx: clampHorizonX(fx, cleanFw), fy: clampHorizonY(fy, cleanFh), fw: cleanFw, fh: cleanFh })
  }
  return out
}

/** Recover a WidgetsState from an untrusted parsed value. One corrupt field must never poison the
 *  rest (per-field recovery, like decor's sanitize): unknown/duplicate ids drop, `collapsed` is
 *  forced to a subset of `open`, anything non-object falls back to the default wholesale. */
export function sanitizeWidgetsState(v: unknown): WidgetsState {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return DEFAULT_WIDGETS_STATE
  const raw = v as Record<string, unknown>
  const open = cleanIds(raw.open)
  const collapsed = cleanIds(raw.collapsed).filter((id) => open.includes(id))
  return { open, collapsed, railCollapsed: raw.railCollapsed === true, placed: cleanPlaced(raw.placed, open) }
}

/** Whether a card is anywhere on the board (rail or floating) — the add-menu's ✓ state. */
export function widgetActive(s: WidgetsState, id: WidgetId): boolean {
  return s.open.includes(id) || s.placed.some((p) => p.id === id)
}

/** Detach a rail card onto the canvas at a horizon-clamped point — or, when the card is already
 *  floating, move it there (keeping its size unless a new one is passed; a fresh detach without an
 *  explicit size lands at the defaults). Enforces the one-home invariant: placing removes it from
 *  the rail (`open`, and `collapsed` since that's a rail-only notion — a re-docked card comes back
 *  expanded). */
export function placeWidget(
  s: WidgetsState,
  id: WidgetId,
  fx: number,
  fy: number,
  fw?: number,
  fh?: number
): WidgetsState {
  const prev = s.placed.find((p) => p.id === id)
  const cleanFw = clampWidgetSize(fw, prev?.fw ?? WIDGET_DEFAULT_FW)
  const cleanFh = clampWidgetSize(fh, prev?.fh ?? WIDGET_DEFAULT_FH)
  const at: PlacedWidget = {
    id,
    fx: clampHorizonX(fx, cleanFw),
    fy: clampHorizonY(fy, cleanFh),
    fw: cleanFw,
    fh: cleanFh
  }
  return {
    ...s,
    open: s.open.filter((x) => x !== id),
    collapsed: s.collapsed.filter((x) => x !== id),
    placed: prev ? s.placed.map((p) => (p.id === id ? at : p)) : [...s.placed, at]
  }
}

/** Resize a floating card. Size is clamped to [min, most-of-viewport] and never past the horizon
 *  edge for its position (the CanvasNote resize clamp order — the horizon cap wins). No-op when
 *  the card is not floating. */
export function resizeWidget(s: WidgetsState, id: WidgetId, fw: number, fh: number): WidgetsState {
  const prev = s.placed.find((p) => p.id === id)
  if (!prev) return s
  const next: PlacedWidget = {
    ...prev,
    fw: Math.min(WIDGET_MAX_FRAC, HORIZON_MAX_X - prev.fx, Math.max(WIDGET_MIN_FRAC, finiteSize(fw, prev.fw))),
    fh: Math.min(WIDGET_MAX_FRAC, HORIZON_MAX_Y - prev.fy, Math.max(WIDGET_MIN_FRAC, finiteSize(fh, prev.fh)))
  }
  return { ...s, placed: s.placed.map((p) => (p.id === id ? next : p)) }
}

function finiteSize(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

/** Return a floating widget to the rail (appended at the bottom, expanded). No-op when not placed. */
export function dockWidget(s: WidgetsState, id: WidgetId): WidgetsState {
  if (!s.placed.some((p) => p.id === id)) return s
  return {
    ...s,
    open: s.open.includes(id) ? s.open : [...s.open, id],
    placed: s.placed.filter((p) => p.id !== id)
  }
}

/** Severity for a remaining-quota bar: the provider's own hint wins; else derive from the percent
 *  (mirrors the Usage dock panel's thresholds so the two surfaces never disagree). */
export function usageSeverity(
  remainingPct: number,
  hint: 'normal' | 'warning' | 'critical' | null
): 'normal' | 'warning' | 'critical' {
  return hint ?? (remainingPct > 50 ? 'normal' : remainingPct >= 20 ? 'warning' : 'critical')
}
