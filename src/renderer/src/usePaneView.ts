import { useCallback, useEffect, useState } from 'react'
import type { SessionRecord } from '@shared/types'
import { ASSIGNABLE_PANE_THEMES } from '@shared/terminal/paneTheme'

// Per-pane VIEW state — the user's grid order and each terminal's THEME. This is view
// preference, not domain data, so it lives in localStorage (domain sessions stay in SQLite). It
// survives restarts because tmux sessions reattach with the SAME id, so a pane's slot + theme
// come back with it. Keyed globally by session id (ids are unique across projects), so there's no
// per-project bookkeeping — a project switch just shows a different subset of the same maps.
//
// Values are PaneTheme ids (paneTheme.ts). Pre-theme installs stored bare accent hexes — those
// stay in the map untouched and resolvePaneTheme maps them to a similar dark theme on read.

const ORDER_KEY = 'mc.paneOrder'
const COLORS_KEY = 'mc.paneColors'

// Read + VALIDATE: a corrupted or foreign value (e.g. the literal "null", or a number from a
// schema change) must fall back, never flow through as the wrong type — else order.map / `in`
// throw during render and white-screen the app.
export function readLS<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v: unknown = JSON.parse(raw)
    return valid(v) ? v : fallback
  } catch {
    return fallback
  }
}
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isColorMap = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface PaneView {
  /** Fold freshly-seen sessions into the order + color maps. Call in the sessions-fetch callback. */
  reconcile: (sessions: SessionRecord[]) => void
  /** A copy of `sessions` sorted into the user's chosen grid order. */
  orderedShown: (sessions: SessionRecord[]) => SessionRecord[]
  /** The theme token assigned to a pane (a PaneTheme id; legacy saves may hold an accent hex). */
  colorFor: (id: string) => string
  /** Swap two panes' grid positions (the drag-to-reorder action). */
  swap: (a: string, b: string) => void
  /** Pin a pane to a chosen theme. */
  setColor: (id: string, hex: string) => void
  /** Forget a session's slot + color (call when it ends) so the maps don't leak dead ids. */
  forget: (id: string) => void
}

export function usePaneView(): PaneView {
  const [order, setOrder] = useState<string[]>(() => readLS<string[]>(ORDER_KEY, [], isStringArray))
  const [colors, setColors] = useState<Record<string, string>>(() =>
    readLS<Record<string, string>>(COLORS_KEY, {}, isColorMap)
  )

  // Persist on change (writing to localStorage in an effect is safe — it's not setState).
  useEffect(() => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(order))
    } catch {
      /* storage full/unavailable → in-memory only */
    }
  }, [order])
  useEffect(() => {
    try {
      localStorage.setItem(COLORS_KEY, JSON.stringify(colors))
    } catch {
      /* ignore */
    }
  }, [colors])

  // Assign order slot + a distinct color to any session we haven't seen. Done in the fetch
  // callback (functional updates, no deps) so it never runs during render or synchronously in an
  // effect — both of which the react-compiler flags.
  const reconcile = useCallback((sessions: SessionRecord[]): void => {
    const ids = sessions.map((s) => s.id)
    setOrder((prev) => {
      const missing = ids.filter((id) => !prev.includes(id))
      return missing.length ? [...prev, ...missing] : prev
    })
    setColors((prev) => {
      const missing = ids.filter((id) => !(id in prev))
      if (!missing.length) return prev
      const next = { ...prev }
      // Usage among THIS project's current panes → assign each newcomer the least-used DARK theme
      // so several panes (even same-model workers) are tellable apart at a glance.
      const usage = new Map<string, number>(ASSIGNABLE_PANE_THEMES.map((t) => [t, 0]))
      for (const id of ids) {
        const t = next[id]
        if (t && usage.has(t)) usage.set(t, usage.get(t)! + 1)
      }
      for (const id of missing) {
        let best = ASSIGNABLE_PANE_THEMES[0]
        for (const t of ASSIGNABLE_PANE_THEMES) if (usage.get(t)! < usage.get(best)!) best = t
        next[id] = best
        usage.set(best, usage.get(best)! + 1)
      }
      return next
    })
  }, [])

  const orderedShown = useCallback(
    (sessions: SessionRecord[]): SessionRecord[] => {
      const rank = new Map(order.map((id, i) => [id, i]))
      const at = (id: string): number => rank.get(id) ?? Number.MAX_SAFE_INTEGER
      return [...sessions].sort((a, b) => at(a.id) - at(b.id))
    },
    [order]
  )

  const colorFor = useCallback((id: string): string => colors[id] ?? ASSIGNABLE_PANE_THEMES[0], [colors])

  const swap = useCallback((a: string, b: string): void => {
    if (a === b) return
    setOrder((prev) => {
      const next = [...prev]
      const i = next.indexOf(a)
      const j = next.indexOf(b)
      if (i < 0 || j < 0) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  const setColor = useCallback((id: string, hex: string): void => {
    setColors((prev) => ({ ...prev, [id]: hex }))
  }, [])

  // Drop a session's slot + color when it ends, so the maps don't accumulate dead ids forever.
  const forget = useCallback((id: string): void => {
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev))
    setColors((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  return { reconcile, orderedShown, colorFor, swap, setColor, forget }
}
