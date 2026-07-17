import { useCallback, useState } from 'react'
import { readLS } from './usePaneView'
import { moveItem } from './components/tabReorder'
import {
  dockWidget,
  placeWidget,
  resizeWidget,
  sanitizeWidgetsState,
  widgetActive,
  widgetsStorageKey,
  type WidgetId,
  type WidgetsState
} from '@shared/widgets/catalog'

// Per-project widget-rail state (which cards are open, their order, collapsed flags) persisted at
// `mc.widgets.<projectId ?? 'scratch'>`. Read goes through readLS (usePaneView's validate-or-fallback
// seam) and then sanitizeWidgetsState for per-field recovery — a corrupt value falls back, never
// crashes render. Same key-change-reload-during-render + write-through shape as useFreeLayout.

interface Stored {
  key: string
  state: WidgetsState
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

function load(key: string): Stored {
  return { key, state: sanitizeWidgetsState(readLS<Record<string, unknown>>(key, {}, isObj)) }
}

/** The ＋ Widgets toolbar button signals the rail's add-menu through a window event, so
 *  FreePaneLayout's edit stays a one-line button. */
export const WIDGETS_MENU_EVENT = 'mc:widgets-menu'

export function openWidgetsMenu(): void {
  window.dispatchEvent(new CustomEvent(WIDGETS_MENU_EVENT))
}

export interface Widgets {
  state: WidgetsState
  /** Put a card on the rail (no-op when already open or floating on the canvas). */
  add: (id: WidgetId) => void
  /** Remove a card entirely — from the rail or the canvas, wherever it lives. */
  remove: (id: WidgetId) => void
  /** Collapse/expand one card to/from its title chip. */
  toggleCard: (id: WidgetId) => void
  /** Fold/unfold the whole rail to a thin icon strip. */
  toggleRail: () => void
  /** Reorder within the rail (drag): move open[from] to index `to`. */
  move: (from: number, to: number) => void
  /** Detach a rail card to the canvas at fractional (fx, fy) — or move an already-floating card.
   *  A fresh detach passes the rail card's footprint as (fw, fh); a move omits them (size kept). */
  place: (id: WidgetId, fx: number, fy: number, fw?: number, fh?: number) => void
  /** Resize a floating card (fractional, clamped in the pure transition). */
  resize: (id: WidgetId, fw: number, fh: number) => void
  /** Return a floating card to the rail. */
  dock: (id: WidgetId) => void
}

export function useWidgets(projectId: string | null): Widgets {
  const key = widgetsStorageKey(projectId)
  const [stored, setStored] = useState<Stored>(() => load(key))

  // Reload when the project (key) changes — adjust state during render (React's documented
  // pattern), not in an effect, matching useFreeLayout.
  if (stored.key !== key) setStored(load(key))

  // All mutation flows through one functional updater that writes through to the key the state was
  // LOADED for (prev.key) — a stale closure after a project switch can never write the wrong key.
  const mutate = useCallback((fn: (s: WidgetsState) => WidgetsState): void => {
    setStored((prev) => {
      const state = fn(prev.state)
      if (state === prev.state) return prev
      try {
        localStorage.setItem(prev.key, JSON.stringify(state))
      } catch {
        /* storage full/unavailable -> in-memory only */
      }
      return { key: prev.key, state }
    })
  }, [])

  const add = useCallback(
    (id: WidgetId): void => mutate((s) => (widgetActive(s, id) ? s : { ...s, open: [...s.open, id] })),
    [mutate]
  )

  const remove = useCallback(
    (id: WidgetId): void =>
      mutate((s) =>
        widgetActive(s, id)
          ? {
              ...s,
              open: s.open.filter((x) => x !== id),
              collapsed: s.collapsed.filter((x) => x !== id),
              placed: s.placed.filter((p) => p.id !== id)
            }
          : s
      ),
    [mutate]
  )

  const toggleCard = useCallback(
    (id: WidgetId): void =>
      mutate((s) => ({
        ...s,
        collapsed: s.collapsed.includes(id) ? s.collapsed.filter((x) => x !== id) : [...s.collapsed, id]
      })),
    [mutate]
  )

  const toggleRail = useCallback((): void => mutate((s) => ({ ...s, railCollapsed: !s.railCollapsed })), [mutate])

  const move = useCallback(
    (from: number, to: number): void =>
      mutate((s) => {
        const open = moveItem(s.open, from, to)
        return open === s.open ? s : { ...s, open }
      }),
    [mutate]
  )

  const place = useCallback(
    (id: WidgetId, fx: number, fy: number, fw?: number, fh?: number): void =>
      mutate((s) => placeWidget(s, id, fx, fy, fw, fh)),
    [mutate]
  )

  const resize = useCallback(
    (id: WidgetId, fw: number, fh: number): void => mutate((s) => resizeWidget(s, id, fw, fh)),
    [mutate]
  )

  const dock = useCallback((id: WidgetId): void => mutate((s) => dockWidget(s, id)), [mutate])

  return { state: stored.state, add, remove, toggleCard, toggleRail, move, place, resize, dock }
}
