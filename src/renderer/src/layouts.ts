// Worker-grid layout templates. Each layout is either:
//  - `areas`: CSS grid-template-areas rows (tokens p0..p{n-1}); lets a pane SPAN cells
//    (e.g. one pane filling the leftover space), or
//  - `cols`: a uniform N-column grid (panes auto-flow).
// `null` selection = Auto (square-ish). Curated sets for 1–6 panes; generated columns beyond.

export interface LayoutDef {
  id: string
  name: string
  areas?: string[]
  cols?: number
}

const L: Record<number, LayoutDef[]> = {
  1: [{ id: 'full', name: 'Full', areas: ['p0'] }],
  2: [
    { id: 'cols', name: 'Side by side', areas: ['p0 p1'] },
    { id: 'rows', name: 'Stacked', areas: ['p0', 'p1'] }
  ],
  3: [
    { id: 'feature-left', name: 'Big left + 2', areas: ['p0 p1', 'p0 p2'] },
    { id: 'feature-bottom', name: '2 + wide bottom', areas: ['p0 p1', 'p2 p2'] },
    { id: 'feature-top', name: 'Wide top + 2', areas: ['p0 p0', 'p1 p2'] },
    { id: 'cols', name: '3 columns', areas: ['p0 p1 p2'] },
    { id: 'rows', name: '3 stacked', areas: ['p0', 'p1', 'p2'] }
  ],
  4: [
    { id: 'grid', name: '2 × 2', areas: ['p0 p1', 'p2 p3'] },
    { id: 'feature-left', name: 'Big left + 3', areas: ['p0 p1', 'p0 p2', 'p0 p3'] },
    { id: 'cols', name: '4 columns', areas: ['p0 p1 p2 p3'] },
    { id: 'rows', name: '4 stacked', areas: ['p0', 'p1', 'p2', 'p3'] }
  ],
  5: [
    { id: 'feature-left', name: 'Big left + 4', areas: ['p0 p1 p2', 'p0 p3 p4'] },
    { id: 'grid', name: '3 / 2', areas: ['p0 p1 p2', 'p3 p4 p4'] },
    { id: 'cols', name: '5 columns', areas: ['p0 p1 p2 p3 p4'] }
  ],
  6: [
    { id: 'grid', name: '3 × 2', areas: ['p0 p1 p2', 'p3 p4 p5'] },
    { id: 'grid2', name: '2 × 3', areas: ['p0 p1', 'p2 p3', 'p4 p5'] },
    { id: 'feature-left', name: 'Big + 5', areas: ['p0 p0 p1', 'p0 p0 p2', 'p3 p4 p5'] },
    { id: 'cols', name: '6 columns', areas: ['p0 p1 p2 p3 p4 p5'] }
  ]
}

/** Layout options for n panes (excludes the Auto option, which the UI prepends as `null`). */
export function layoutsFor(n: number): LayoutDef[] {
  if (L[n]) return L[n]
  // Beyond the curated sets: offer a few uniform column counts.
  return [2, 3, 4].filter((c) => c < n).map((c) => ({ id: `cols${c}`, name: `${c} columns`, cols: c }))
}

/** Default minimum usable width (px) for a terminal pane before the responsive Auto layout drops
 *  to fewer columns — narrower than this and a CLI's input/output wraps to bits. */
export const MIN_PANE_WIDTH = 380

/**
 * Responsive Auto: how many columns fit in `containerWidth` at `minPaneWidth` each, never more than
 * the pane count and never fewer than one. Recompute on resize → the grid reflows with the window
 * instead of the operator picking a fixed layout. Pure (the caller measures the container).
 */
export function responsiveCols(containerWidth: number, paneCount: number, minPaneWidth = MIN_PANE_WIDTH): number {
  if (containerWidth <= 0 || paneCount <= 0) return 1
  const fit = Math.floor(containerWidth / minPaneWidth)
  return Math.min(Math.max(1, fit), paneCount)
}

/** Columns in a layout (for sizing the grid + previews). */
export function colsOf(d: LayoutDef): number {
  if (d.areas) return Math.max(...d.areas.map((r) => r.trim().split(/\s+/).length))
  return d.cols ?? 1
}
export function rowsOf(d: LayoutDef): number {
  if (d.areas) return d.areas.length
  return 1
}
