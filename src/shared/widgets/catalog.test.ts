import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGETS_STATE,
  WIDGET_CATALOG,
  WIDGET_DEFAULT_FH,
  WIDGET_DEFAULT_FW,
  WIDGET_IDS,
  WIDGET_MAX_FRAC,
  WIDGET_MIN_FRAC,
  dockWidget,
  isWidgetId,
  placeWidget,
  resizeWidget,
  sanitizeWidgetsState,
  usageSeverity,
  widgetActive,
  widgetsStorageKey,
  type WidgetsState
} from './catalog'
import { HORIZON_MAX_X, HORIZON_MAX_Y, roundCanvasFrac } from '../canvas/layout'

describe('widget catalog', () => {
  it('has a meta entry for every widget id, keyed consistently', () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGET_CATALOG[id].id).toBe(id)
      expect(WIDGET_CATALOG[id].label.length).toBeGreaterThan(0)
      expect(WIDGET_CATALOG[id].pollMs).toBeGreaterThan(0)
    }
  })

  it('isWidgetId accepts only catalog ids', () => {
    expect(isWidgetId('usage')).toBe(true)
    expect(isWidgetId('sessions')).toBe(true)
    expect(isWidgetId('nope')).toBe(false)
    expect(isWidgetId(3)).toBe(false)
    expect(isWidgetId(null)).toBe(false)
  })
})

describe('widgetsStorageKey', () => {
  it('is per-project with a scratch fallback', () => {
    expect(widgetsStorageKey('p1')).toBe('mc.widgets.p1')
    expect(widgetsStorageKey(null)).toBe('mc.widgets.scratch')
  })
})

describe('sanitizeWidgetsState', () => {
  it('falls back wholesale on non-objects', () => {
    expect(sanitizeWidgetsState(null)).toEqual(DEFAULT_WIDGETS_STATE)
    expect(sanitizeWidgetsState('usage')).toEqual(DEFAULT_WIDGETS_STATE)
    expect(sanitizeWidgetsState(42)).toEqual(DEFAULT_WIDGETS_STATE)
    expect(sanitizeWidgetsState(['usage'])).toEqual(DEFAULT_WIDGETS_STATE)
    expect(sanitizeWidgetsState(undefined)).toEqual(DEFAULT_WIDGETS_STATE)
  })

  it('keeps a valid state intact, order preserved', () => {
    const s = {
      open: ['sessions'],
      collapsed: ['sessions'],
      railCollapsed: true,
      placed: [{ id: 'usage', fx: 0.4, fy: 0.25, fw: 0.2, fh: 0.3 }]
    }
    expect(sanitizeWidgetsState(s)).toEqual(s)
  })

  it('drops unknown ids and duplicates from open', () => {
    const s = sanitizeWidgetsState({
      open: ['usage', 'ghost', 'usage', 'sessions'],
      collapsed: [],
      railCollapsed: false
    })
    expect(s.open).toEqual(['usage', 'sessions'])
  })

  it('forces collapsed to a subset of open', () => {
    const s = sanitizeWidgetsState({ open: ['usage'], collapsed: ['usage', 'sessions', 'junk'], railCollapsed: false })
    expect(s.collapsed).toEqual(['usage'])
  })

  it('recovers per-field: one corrupt field does not poison the rest', () => {
    const s = sanitizeWidgetsState({ open: 'oops', collapsed: ['sessions'], railCollapsed: 'yes' })
    expect(s.open).toEqual([])
    expect(s.collapsed).toEqual([]) // subset of an empty open
    expect(s.railCollapsed).toBe(false) // only the literal true collapses
    expect(s.placed).toEqual([]) // pre-placed saves (no field at all) load the same way
  })

  it('placed: drops non-objects, unknown ids, and duplicates (first wins)', () => {
    const s = sanitizeWidgetsState({
      open: [],
      collapsed: [],
      railCollapsed: false,
      placed: [
        'junk',
        null,
        [0.1, 0.2],
        { id: 'ghost', fx: 0.1, fy: 0.1, fw: 0.2, fh: 0.2 },
        { id: 'usage', fx: 0.2, fy: 0.3, fw: 0.2, fh: 0.3 },
        { id: 'usage', fx: 0.9, fy: 0.9, fw: 0.3, fh: 0.3 }
      ]
    })
    expect(s.placed).toEqual([{ id: 'usage', fx: 0.2, fy: 0.3, fw: 0.2, fh: 0.3 }])
  })

  it('placed: the rail wins when an id is in both open and placed', () => {
    const s = sanitizeWidgetsState({
      open: ['usage'],
      collapsed: [],
      railCollapsed: false,
      placed: [
        { id: 'usage', fx: 0.2, fy: 0.3, fw: 0.2, fh: 0.3 },
        { id: 'sessions', fx: 0.5, fy: 0.5, fw: 0.2, fh: 0.3 }
      ]
    })
    expect(s.open).toEqual(['usage'])
    expect(s.placed).toEqual([{ id: 'sessions', fx: 0.5, fy: 0.5, fw: 0.2, fh: 0.3 }])
  })

  it('placed: defaults a missing/bad size (pre-size saves load) and clamps out-of-range sizes', () => {
    const s = sanitizeWidgetsState({
      open: [],
      collapsed: [],
      railCollapsed: false,
      placed: [
        { id: 'usage', fx: 0.2, fy: 0.3 }, // no fw/fh at all
        { id: 'sessions', fx: 0.1, fy: 0.1, fw: 5, fh: 0.001 }
      ]
    })
    expect(s.placed).toEqual([
      { id: 'usage', fx: 0.2, fy: 0.3, fw: WIDGET_DEFAULT_FW, fh: WIDGET_DEFAULT_FH },
      { id: 'sessions', fx: 0.1, fy: 0.1, fw: WIDGET_MAX_FRAC, fh: WIDGET_MIN_FRAC }
    ])
    // Non-numeric size fields fall back to the defaults too.
    const t = sanitizeWidgetsState({
      open: [],
      collapsed: [],
      railCollapsed: false,
      placed: [{ id: 'usage', fx: 0.1, fy: 0.1, fw: 'wide', fh: NaN }]
    })
    expect(t.placed).toEqual([{ id: 'usage', fx: 0.1, fy: 0.1, fw: WIDGET_DEFAULT_FW, fh: WIDGET_DEFAULT_FH }])
  })

  it('placed: position clamp is size-aware against the horizon; non-finite coords zero', () => {
    const s = sanitizeWidgetsState({
      open: [],
      collapsed: [],
      railCollapsed: false,
      placed: [
        { id: 'usage', fx: -2, fy: 99, fw: 0.2, fh: 0.3 },
        { id: 'sessions', fx: 'x', fy: NaN, fw: 0.2, fh: 0.3 }
      ]
    })
    expect(s.placed).toEqual([
      { id: 'usage', fx: 0, fy: roundCanvasFrac(HORIZON_MAX_Y - 0.3), fw: 0.2, fh: 0.3 },
      { id: 'sessions', fx: 0, fy: 0, fw: 0.2, fh: 0.3 }
    ])
  })
})

describe('placeWidget', () => {
  const base: WidgetsState = { open: ['usage', 'sessions'], collapsed: ['usage'], railCollapsed: false, placed: [] }

  it('detaches a rail card: leaves open+collapsed, lands in placed at the clamped point + defaults', () => {
    const s = placeWidget(base, 'usage', 0.3, 0.4)
    expect(s.open).toEqual(['sessions'])
    expect(s.collapsed).toEqual([]) // collapse is a rail notion — a re-docked card comes back expanded
    expect(s.placed).toEqual([{ id: 'usage', fx: 0.3, fy: 0.4, fw: WIDGET_DEFAULT_FW, fh: WIDGET_DEFAULT_FH }])
  })

  it('detaches with an explicit size (the drop handler passes the rail-card footprint)', () => {
    const s = placeWidget(base, 'usage', 0.3, 0.4, 0.18, 0.32)
    expect(s.placed).toEqual([{ id: 'usage', fx: 0.3, fy: 0.4, fw: 0.18, fh: 0.32 }])
  })

  it('moves an already-floating card without duplicating it, keeping its size', () => {
    const one = placeWidget(base, 'usage', 0.3, 0.4, 0.25, 0.35)
    const two = placeWidget(one, 'usage', 0.6, 0.1)
    expect(two.placed).toEqual([{ id: 'usage', fx: 0.6, fy: 0.1, fw: 0.25, fh: 0.35 }])
    expect(two.open).toEqual(['sessions'])
  })

  it('clamps the drop point to the horizon, size-aware', () => {
    const s = placeWidget(base, 'sessions', 9, -3)
    expect(s.placed).toEqual([
      {
        id: 'sessions',
        fx: roundCanvasFrac(HORIZON_MAX_X - WIDGET_DEFAULT_FW),
        fy: 0,
        fw: WIDGET_DEFAULT_FW,
        fh: WIDGET_DEFAULT_FH
      }
    ])
  })

  it('leaves other cards alone', () => {
    const withSessions = placeWidget(base, 'sessions', 0.1, 0.1)
    const s = placeWidget(withSessions, 'usage', 0.5, 0.5)
    expect(s.placed).toEqual([
      { id: 'sessions', fx: 0.1, fy: 0.1, fw: WIDGET_DEFAULT_FW, fh: WIDGET_DEFAULT_FH },
      { id: 'usage', fx: 0.5, fy: 0.5, fw: WIDGET_DEFAULT_FW, fh: WIDGET_DEFAULT_FH }
    ])
    expect(s.open).toEqual([])
  })
})

describe('resizeWidget', () => {
  const floated = placeWidget(
    { ...DEFAULT_WIDGETS_STATE, open: ['usage', 'sessions'] },
    'usage',
    0.2,
    0.3,
    WIDGET_DEFAULT_FW,
    WIDGET_DEFAULT_FH
  )

  it('resizes a floating card, persisting the new size', () => {
    const s = resizeWidget(floated, 'usage', 0.4, 0.5)
    expect(s.placed).toEqual([{ id: 'usage', fx: 0.2, fy: 0.3, fw: 0.4, fh: 0.5 }])
  })

  it('clamps to the min and most-of-viewport max', () => {
    const tiny = resizeWidget(floated, 'usage', 0.001, 0.001)
    expect(tiny.placed[0].fw).toBe(WIDGET_MIN_FRAC)
    expect(tiny.placed[0].fh).toBe(WIDGET_MIN_FRAC)
    const huge = resizeWidget(floated, 'usage', 5, 5)
    expect(huge.placed[0].fw).toBe(WIDGET_MAX_FRAC)
    expect(huge.placed[0].fh).toBe(WIDGET_MAX_FRAC)
  })

  it('never grows past the horizon edge for its position (horizon cap wins)', () => {
    const nearEdge = placeWidget({ ...DEFAULT_WIDGETS_STATE }, 'sessions', 1.3, 1.3)
    const s = resizeWidget(nearEdge, 'sessions', 0.5, 0.5)
    const p = s.placed[0]
    expect(p.fw).toBeCloseTo(HORIZON_MAX_X - p.fx, 10)
    expect(p.fh).toBeCloseTo(HORIZON_MAX_Y - p.fy, 10)
  })

  it('keeps the last size on non-finite input and is a no-op for a card that is not floating', () => {
    const s = resizeWidget(floated, 'usage', NaN, Infinity)
    expect(s.placed).toEqual(floated.placed)
    expect(resizeWidget(floated, 'sessions', 0.3, 0.3)).toBe(floated)
  })
})

describe('dockWidget', () => {
  it('returns a floating card to the bottom of the rail', () => {
    const floated = placeWidget({ ...DEFAULT_WIDGETS_STATE, open: ['sessions', 'usage'] }, 'sessions', 0.2, 0.2)
    const s = dockWidget(floated, 'sessions')
    expect(s.placed).toEqual([])
    expect(s.open).toEqual(['usage', 'sessions'])
  })

  it('is a no-op for a card that is not floating', () => {
    const s: WidgetsState = { open: ['usage'], collapsed: [], railCollapsed: false, placed: [] }
    expect(dockWidget(s, 'usage')).toBe(s)
    expect(dockWidget(s, 'sessions')).toBe(s)
  })

  it('never duplicates an id already on the rail', () => {
    // Corrupt-adjacent input (invariant says either/or) — dock must still converge to one home.
    const s: WidgetsState = {
      open: ['usage'],
      collapsed: [],
      railCollapsed: false,
      placed: [{ id: 'usage', fx: 0.1, fy: 0.1, fw: 0.2, fh: 0.3 }]
    }
    const docked = dockWidget(s, 'usage')
    expect(docked.open).toEqual(['usage'])
    expect(docked.placed).toEqual([])
  })
})

describe('widgetActive', () => {
  it('is true for rail cards and floating cards, false otherwise', () => {
    const s: WidgetsState = {
      open: ['usage'],
      collapsed: [],
      railCollapsed: false,
      placed: [{ id: 'sessions', fx: 0.1, fy: 0.1, fw: 0.2, fh: 0.3 }]
    }
    expect(widgetActive(s, 'usage')).toBe(true)
    expect(widgetActive(s, 'sessions')).toBe(true)
  })
})

describe('usageSeverity', () => {
  it('derives from the remaining percent at the panel thresholds', () => {
    expect(usageSeverity(51, null)).toBe('normal')
    expect(usageSeverity(50, null)).toBe('warning')
    expect(usageSeverity(20, null)).toBe('warning')
    expect(usageSeverity(19, null)).toBe('critical')
    expect(usageSeverity(0, null)).toBe('critical')
  })

  it('lets the provider hint win over the derivation', () => {
    expect(usageSeverity(95, 'critical')).toBe('critical')
    expect(usageSeverity(5, 'normal')).toBe('normal')
  })
})
