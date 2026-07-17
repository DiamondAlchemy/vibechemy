import { useCallback, useState } from 'react'
import { readLS } from './usePaneView'
import type { FreeRect } from '@shared/canvas/layout'

export type FreeGeom = Record<string, FreeRect> // session id -> fractional rect (0..1)

interface Stored {
  key: string
  nodes: FreeGeom
}

const keyFor = (projectId: string | null): string => `mc.free.${projectId ?? 'scratch'}`

const isFiniteFree = (r: unknown): r is FreeRect => {
  if (!r || typeof r !== 'object') return false
  const v = r as Record<string, unknown>
  return (
    typeof v.fx === 'number' &&
    typeof v.fy === 'number' &&
    typeof v.fw === 'number' &&
    typeof v.fh === 'number' &&
    Number.isFinite(v.fx) &&
    Number.isFinite(v.fy) &&
    Number.isFinite(v.fw) &&
    Number.isFinite(v.fh)
  )
}

const isStored = (v: unknown): v is { nodes: FreeGeom } =>
  !!v &&
  typeof v === 'object' &&
  'nodes' in v &&
  typeof (v as { nodes: unknown }).nodes === 'object' &&
  (v as { nodes: unknown }).nodes !== null

function load(key: string): Stored {
  const raw = readLS<{ nodes: FreeGeom }>(key, { nodes: {} }, isStored)
  // Drop any malformed rect so one bad entry can never crash render — caller falls back to auto-place.
  // (Pre-fraction pixel data from an older build has x/y/w/h keys, fails this guard, and is discarded.)
  const clean: FreeGeom = {}
  for (const [id, rect] of Object.entries(raw.nodes)) if (isFiniteFree(rect)) clean[id] = rect
  return { key, nodes: clean }
}

/** Persisted Free-mode geometry for one project: session id -> fractional rect (0..1). */
export function useFreeLayout(projectId: string | null): {
  nodes: FreeGeom
  setNode: (id: string, rect: FreeRect) => void
} {
  return useFreeGeom(keyFor(projectId))
}

/** Same persisted geometry under an arbitrary storage key. */
export function useFreeGeom(key: string): {
  nodes: FreeGeom
  setNode: (id: string, rect: FreeRect) => void
} {
  const [state, setState] = useState<Stored>(() => load(key))

  // Reload when the project (key) changes — adjust state during render (React's documented pattern),
  // not in an effect, to avoid the react-hooks/set-state-in-effect rule.
  if (state.key !== key) setState(load(key))

  const setNode = useCallback((id: string, rect: FreeRect) => {
    setState((s) => {
      const next = { ...s, nodes: { ...s.nodes, [id]: rect } }
      try {
        localStorage.setItem(next.key, JSON.stringify({ nodes: next.nodes }))
      } catch {
        /* storage full/unavailable -> in-memory only */
      }
      return next
    })
  }, [])

  return { nodes: state.nodes, setNode }
}
