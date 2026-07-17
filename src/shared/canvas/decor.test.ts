import { describe, it, expect } from 'vitest'
import {
  BG_STYLES,
  BG_LABELS,
  DEFAULT_DECOR,
  MAX_NOTES,
  MAX_NOTE_TEXT,
  MAX_STROKES,
  MAX_STROKE_PTS,
  MAX_PEN_WIDTH,
  MAX_FRAMES,
  MIN_FRAME_FRAC,
  MAX_IMAGES,
  MIN_IMAGE_FRAC,
  NOTE_COLORS,
  NOTE_INK_COLORS,
  PEN_COLORS,
  PEN_WIDTHS,
  FRAME_COLORS,
  WELCOME_NOTE_ID,
  WELCOME_FRAME_ID,
  clampFrac,
  makeNote,
  makeStroke,
  makeFrame,
  makeImage,
  makeWelcomeDecor,
  hasUserCanvasDecor,
  isDecorish,
  sanitizeDecor
} from './decor'
import { EXTRA_DOWN_FRAC, EXTRA_RIGHT_FRAC, arrowHead, rectFromPoints } from './layout'

describe('first-run canvas decor', () => {
  it('marks the richer starfield as a live background', () => {
    expect(BG_LABELS.starfield).toBe('Starfield ✦')
    expect(BG_STYLES).toContain('starfield')
  })

  it('builds a deterministic, sanitize-clean welcome board inside Home', () => {
    const welcome = makeWelcomeDecor()

    expect(makeWelcomeDecor()).toEqual(welcome)
    expect(welcome.bg).toBe('starfield')
    expect(welcome.notes).toHaveLength(1)
    expect(welcome.frames).toHaveLength(1)
    expect(welcome.notes[0].id).toBe(WELCOME_NOTE_ID)
    expect(welcome.frames[0].id).toBe(WELCOME_FRAME_ID)
    expect(welcome.notes[0].fx + welcome.notes[0].fw).toBeLessThanOrEqual(1)
    expect(welcome.notes[0].fy + welcome.notes[0].fh).toBeLessThanOrEqual(1)
    expect(welcome.frames[0].fx + welcome.frames[0].fw).toBeLessThanOrEqual(1)
    expect(welcome.frames[0].fy + welcome.frames[0].fh).toBeLessThanOrEqual(1)
    expect(sanitizeDecor(welcome)).toEqual(welcome)
  })

  it('treats only operator-created decor as content', () => {
    const welcome = makeWelcomeDecor()
    expect(hasUserCanvasDecor(welcome)).toBe(false)
    expect(hasUserCanvasDecor({ ...welcome, bg: 'grid' })).toBe(false)
    expect(hasUserCanvasDecor({ ...welcome, bg: 'image' })).toBe(true)
    expect(hasUserCanvasDecor({ ...welcome, notes: [...welcome.notes, makeNote('user', 0.2, 0.2)] })).toBe(true)
    expect(hasUserCanvasDecor({ ...welcome, frames: [...welcome.frames, makeFrame('user', 0.1, 0.1, 0.2, 0.2)] })).toBe(
      true
    )
  })
})

describe('clampFrac', () => {
  it('clamps into [0,1] and coerces non-finite to 0', () => {
    expect(clampFrac(0.5)).toBe(0.5)
    expect(clampFrac(-2)).toBe(0)
    expect(clampFrac(9)).toBe(1)
    expect(clampFrac(NaN)).toBe(0)
    expect(clampFrac('x')).toBe(0)
    expect(clampFrac(undefined)).toBe(0)
  })
  it('rounds to 4 decimals to keep the persisted blob compact', () => {
    expect(clampFrac(0.123456789)).toBe(0.1235)
    expect(clampFrac(0.30000000000000004)).toBe(0.3)
    expect(clampFrac(0.99999)).toBe(1)
  })
})

describe('makeNote', () => {
  it('creates a blank note with clamped position and the given id', () => {
    const n = makeNote('abc', 1.4, -0.2)
    expect(n).toEqual({ id: 'abc', fx: 1.1933, fy: 0, fw: 0.14, fh: 0.12, text: '', color: NOTE_COLORS[0] })
  })
  it('falls back to the default color for an unknown color', () => {
    expect(makeNote('a', 0, 0, '#zzzzzz').color).toBe(NOTE_COLORS[0])
    expect(makeNote('a', 0, 0, NOTE_COLORS[2]).color).toBe(NOTE_COLORS[2])
  })
})

describe('isDecorish', () => {
  it('accepts anything with a bg field and a notes array', () => {
    expect(isDecorish({ bg: 'dots', notes: [] })).toBe(true)
    expect(isDecorish({ bg: 'x', notes: [{}] })).toBe(true)
  })
  it('rejects non-objects and missing/!array notes', () => {
    expect(isDecorish(null)).toBe(false)
    expect(isDecorish({ bg: 'dots' })).toBe(false)
    expect(isDecorish({ bg: 'dots', notes: {} })).toBe(false)
  })
})

describe('sanitizeDecor', () => {
  it('returns the default for junk', () => {
    expect(sanitizeDecor(null)).toEqual(DEFAULT_DECOR)
    expect(sanitizeDecor(42)).toEqual(DEFAULT_DECOR)
    expect(sanitizeDecor({ nope: 1 })).toEqual(DEFAULT_DECOR)
  })
  it('coerces an unknown bg to plain and keeps a known one (incl aurora/starfield/image)', () => {
    expect(sanitizeDecor({ bg: 'sparkle', notes: [] }).bg).toBe('plain')
    for (const b of BG_STYLES) expect(sanitizeDecor({ bg: b, notes: [] }).bg).toBe(b)
    expect(BG_STYLES).toContain('aurora')
    expect(sanitizeDecor({ bg: 'starfield', notes: [] }).bg).toBe('starfield')
    expect(BG_STYLES).toContain('image')
    // the newer animated grounds ride the same sanitize seam
    for (const b of ['nebula', 'fireflies', 'contour'] as const) {
      expect(BG_STYLES).toContain(b)
      expect(sanitizeDecor({ bg: b, notes: [] }).bg).toBe(b)
    }
  })
  it('reads canvas texts back (back-compatible: no texts key → []), dropping malformed', () => {
    expect(sanitizeDecor({ bg: 'plain', notes: [] }).texts).toEqual([])
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [],
      texts: [
        { id: 't1', fx: 0.3, fy: 0.4, text: 'hello', color: '#7fe3ff', size: 30 },
        { id: '', fx: 0, fy: 0, text: 'x' }, // no id → dropped
        { id: 't2', fx: 2, fy: -1, text: 'clamp', color: '#nope', size: 999 } // clamp + defaults
      ]
    })
    expect(d.texts.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(d.texts[0]).toEqual({ id: 't1', fx: 0.3, fy: 0.4, text: 'hello', color: '#7fe3ff', size: 30 })
    expect(d.texts[1].fx).toBe(1.3333) // clamped to the right-room horizon
    expect(d.texts[1].color).toBe('#eef0f2') // bad color → default
    expect(d.texts[1].size).toBe(22) // bad size → default
  })
  it('reads bgImage back (default empty, capped)', () => {
    expect(sanitizeDecor({ bg: 'plain', notes: [] }).bgImage).toBe('')
    expect(sanitizeDecor({ bg: 'image', bgImage: '/tmp/wall.png', notes: [] }).bgImage).toBe('/tmp/wall.png')
    expect(sanitizeDecor({ bg: 'image', bgImage: 42, notes: [] }).bgImage).toBe('') // non-string → ''
  })
  it('drops malformed notes, clamps positions, caps text, defaults bad colors', () => {
    const d = sanitizeDecor({
      bg: 'grid',
      notes: [
        { id: 'ok', fx: 2, fy: -1, text: 'hi', color: NOTE_COLORS[1] },
        { id: '', fx: 0, fy: 0 }, // no id -> dropped
        'garbage', // not an object -> dropped
        { id: 'longtext', fx: 0.1, fy: 0.1, text: 'x'.repeat(MAX_NOTE_TEXT + 500), color: '#bad' }
      ]
    })
    expect(d.notes.map((n) => n.id)).toEqual(['ok', 'longtext'])
    expect(d.notes[0]).toEqual({ id: 'ok', fx: 1.1933, fy: 0, fw: 0.14, fh: 0.12, text: 'hi', color: NOTE_COLORS[1] })
    expect(d.notes[1].text.length).toBe(MAX_NOTE_TEXT)
    expect(d.notes[1].color).toBe(NOTE_COLORS[0]) // '#bad' not in palette
  })
  it('keeps a palette ink, drops an unknown one, and stays back-compatible without it', () => {
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [
        { id: 'inked', fx: 0.1, fy: 0.1, text: '', color: NOTE_COLORS[0], ink: NOTE_INK_COLORS[2] },
        { id: 'badink', fx: 0.1, fy: 0.1, text: '', color: NOTE_COLORS[0], ink: 'hotpink' },
        { id: 'plain', fx: 0.1, fy: 0.1, text: '', color: NOTE_COLORS[0] } // pre-ink save
      ]
    })
    expect(d.notes[0].ink).toBe(NOTE_INK_COLORS[2])
    expect(d.notes[1].ink).toBeUndefined() // unknown ink → CSS default, never a wrong literal
    expect(d.notes[2].ink).toBeUndefined()
  })
  it('caps note count at MAX_NOTES', () => {
    const many = Array.from({ length: MAX_NOTES + 20 }, (_, i) => ({ id: `n${i}`, fx: 0, fy: 0, text: '', color: NOTE_COLORS[0] }))
    expect(sanitizeDecor({ bg: 'plain', notes: many }).notes.length).toBe(MAX_NOTES)
  })

  it('reads strokes back (back-compatible: no strokes key → [])', () => {
    expect(sanitizeDecor({ bg: 'dots', notes: [] }).strokes).toEqual([])
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [],
      strokes: [
        { id: 's1', color: PEN_COLORS[1], width: 4, pts: [0.1, 0.1, 0.9, 0.9] },
        { id: 's2', color: '#nope', width: 999, pts: [2, -1] }, // one point (2 coords) → dropped (<4)
        { id: '', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] }, // no id → dropped
        { id: 's3', color: PEN_COLORS[0], width: 3, pts: [0.2, 0.2, 0.4, 0.4, 0.6] } // odd → last trimmed
      ]
    })
    expect(d.strokes.map((s) => s.id)).toEqual(['s1', 's3'])
    // no kind key → defaults to 'pen' (back-compatible with pre-tool ink)
    expect(d.strokes[0]).toEqual({ id: 's1', kind: 'pen', color: PEN_COLORS[1], width: 4, pts: [0.1, 0.1, 0.9, 0.9] })
    expect(d.strokes[1].pts).toEqual([0.2, 0.2, 0.4, 0.4]) // odd tail dropped
  })

  it('defaults a missing/invalid stroke kind to pen, keeps a valid one', () => {
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [],
      strokes: [
        { id: 'a', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] }, // no kind
        { id: 'b', kind: 'sparkle', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] }, // bad kind
        { id: 'c', kind: 'arrow', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] },
        { id: 'd', kind: 'highlighter', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] },
        { id: 'e', kind: 'rect', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] },
        { id: 'f', kind: 'ellipse', color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] }
      ]
    })
    expect(d.strokes.map((s) => s.kind)).toEqual(['pen', 'pen', 'arrow', 'highlighter', 'rect', 'ellipse'])
  })

  it('caps stroke count and per-stroke point length', () => {
    const many = Array.from({ length: MAX_STROKES + 30 }, (_, i) => ({ id: `s${i}`, color: PEN_COLORS[0], width: 3, pts: [0, 0, 1, 1] }))
    expect(sanitizeDecor({ bg: 'plain', notes: [], strokes: many }).strokes.length).toBe(MAX_STROKES)
    const huge = { id: 'big', color: PEN_COLORS[0], width: 3, pts: Array.from({ length: MAX_STROKE_PTS + 500 }, () => 0.5) }
    expect(sanitizeDecor({ bg: 'plain', notes: [], strokes: [huge] }).strokes[0].pts.length).toBe(MAX_STROKE_PTS)
  })
})

describe('makeStroke', () => {
  it('clamps width, defaults bad color, drops an odd trailing coord', () => {
    const s = makeStroke('id', 'pen', '#bad', 999, [0.1, 0.2, 0.3, 0.4, 0.5])
    expect(s.kind).toBe('pen')
    expect(s.color).toBe(PEN_COLORS[0])
    expect(s.width).toBe(MAX_PEN_WIDTH)
    expect(s.pts).toEqual([0.1, 0.2, 0.3, 0.4])
  })
  it('keeps a valid kind/color/width and clamps fractions', () => {
    const s = makeStroke('id', 'highlighter', PEN_COLORS[2], PEN_WIDTHS[0], [-1, 2, 1.5, 0.5])
    expect(s).toEqual({
      id: 'id',
      kind: 'highlighter',
      color: PEN_COLORS[2],
      width: PEN_WIDTHS[0],
      pts: [0, 1.3333, 1.3333, 0.5]
    })
  })
})

describe('canvas horizon sanitizing', () => {
  it('keeps valid right-room and lower-room coordinates in home-basis storage', () => {
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [{ id: 'n', fx: 1.05, fy: 1.05, fw: 0.2, fh: 0.2, text: '', color: NOTE_COLORS[0] }],
      strokes: [{ id: 's', kind: 'pen', color: PEN_COLORS[0], width: 3, pts: [1.2, 1.1, 0.4, 1.2] }],
      frames: [{ id: 'f', fx: 1.1, fy: 1, fw: 0.2, fh: 0.25, label: '', color: FRAME_COLORS[0] }],
      images: [{ id: 'i', fx: 1.08, fy: 1.05, fw: 0.2, fh: 0.2, path: '/tmp/i.png' }],
      texts: [
        { id: 't', fx: 1 + EXTRA_RIGHT_FRAC, fy: 1 + EXTRA_DOWN_FRAC, text: 'parked', color: '#eef0f2', size: 22 }
      ]
    })

    expect(d.notes[0]).toMatchObject({ fx: 1.05, fy: 1.05 })
    expect(d.strokes[0].pts).toEqual([1.2, 1.1, 0.4, 1.2])
    expect(d.frames[0]).toMatchObject({ fx: 1.1, fy: 1 })
    expect(d.images[0]).toMatchObject({ fx: 1.08, fy: 1.05 })
    expect(d.texts[0].fx).toBeCloseTo(1 + EXTRA_RIGHT_FRAC, 4)
    expect(d.texts[0].fy).toBeCloseTo(1 + EXTRA_DOWN_FRAC, 4)
  })

  it('clamps positions beyond the range — including legacy left-room negatives — on-board', () => {
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [{ id: 'n', fx: -9, fy: 9, fw: 0.3, fh: 0.2, text: '', color: NOTE_COLORS[0] }],
      frames: [{ id: 'f', fx: 9, fy: -9, fw: 0.4, fh: 0.3, label: '', color: FRAME_COLORS[0] }],
      images: [{ id: 'i', fx: 9, fy: 9, fw: 0.25, fh: 0.4, path: '/tmp/i.png' }],
      texts: [{ id: 't', fx: -0.25, fy: 9, text: 'edge', color: '#eef0f2', size: 22 }]
    })

    expect(d.notes[0].fx).toBe(0) // pre re-anchor left-room fx pulls back to the home edge
    expect(d.notes[0].fy + d.notes[0].fh).toBeCloseTo(1 + EXTRA_DOWN_FRAC, 4)
    expect(d.frames[0].fx + d.frames[0].fw).toBeCloseTo(1 + EXTRA_RIGHT_FRAC, 4)
    expect(d.frames[0].fy).toBe(0)
    expect(d.images[0].fx + d.images[0].fw).toBeCloseTo(1 + EXTRA_RIGHT_FRAC, 4)
    expect(d.images[0].fy + d.images[0].fh).toBeCloseTo(1 + EXTRA_DOWN_FRAC, 4)
    expect(d.texts[0].fx).toBe(0)
    expect(d.texts[0].fy).toBeCloseTo(1 + EXTRA_DOWN_FRAC, 4)
  })
})

describe('arrowHead', () => {
  it('places two wings behind the tip, symmetric across the shaft', () => {
    const [w1, w2] = arrowHead(0, 0, 10, 0, 12) // pointing +x
    expect(w1.x).toBeLessThan(10)
    expect(w2.x).toBeLessThan(10)
    expect(w1.y).toBeCloseTo(-w2.y, 5) // symmetric about the x-axis
    expect(Math.abs(w1.y)).toBeGreaterThan(0)
  })
  it('is degenerate-safe (zero-length arrow → finite wings, no NaN)', () => {
    const [w1, w2] = arrowHead(5, 5, 5, 5, 12)
    expect(Number.isFinite(w1.x) && Number.isFinite(w1.y)).toBe(true)
    expect(Number.isFinite(w2.x) && Number.isFinite(w2.y)).toBe(true)
  })
})

describe('rectFromPoints', () => {
  it('normalizes any two corners to a positive-size top-left rect', () => {
    expect(rectFromPoints(10, 20, 40, 50)).toEqual({ x: 10, y: 20, w: 30, h: 30 })
    expect(rectFromPoints(40, 50, 10, 20)).toEqual({ x: 10, y: 20, w: 30, h: 30 }) // reversed drag
    expect(rectFromPoints(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 })
  })
})

describe('makeFrame', () => {
  it('clamps position to the horizon, size to board bounds, caps the label, defaults bad color', () => {
    const f = makeFrame('id', 1.5, -3, 0.01, 2, 'x'.repeat(200), '#nope')
    expect(f.fx).toBe(1.2733)
    expect(f.fy).toBe(0)
    expect(f.fw).toBe(MIN_FRAME_FRAC) // 0.01 floored up
    expect(f.fh).toBe(1 + EXTRA_DOWN_FRAC) // 2 clamped to the full board span
    expect(f.label.length).toBe(60)
    expect(f.color).toBe(FRAME_COLORS[0])
  })
  it('keeps a valid frame intact', () => {
    const f = makeFrame('id', 0.1, 0.2, 0.4, 0.3, 'Building', FRAME_COLORS[2])
    expect(f).toEqual({ id: 'id', fx: 0.1, fy: 0.2, fw: 0.4, fh: 0.3, label: 'Building', color: FRAME_COLORS[2] })
  })
})

describe('sanitizeDecor frames', () => {
  it('reads frames back (back-compatible: no frames key → [])', () => {
    expect(sanitizeDecor({ bg: 'dots', notes: [] }).frames).toEqual([])
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [],
      frames: [
        { id: 'f1', fx: 0.1, fy: 0.1, fw: 0.4, fh: 0.3, label: 'Prod', color: FRAME_COLORS[1] },
        { id: '', fx: 0, fy: 0, fw: 0.2, fh: 0.2 }, // no id → dropped
        { id: 'f2', fx: 5, fy: 5, fw: 0.001, fh: 0.5, color: '#x' } // clamped + default color
      ]
    })
    expect(d.frames.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(d.frames[1]).toEqual({
      id: 'f2',
      fx: 1.2733,
      fy: 0.8333,
      fw: MIN_FRAME_FRAC,
      fh: 0.5,
      label: '',
      color: FRAME_COLORS[0]
    })
  })
  it('caps frame count at MAX_FRAMES', () => {
    const many = Array.from({ length: MAX_FRAMES + 15 }, (_, i) => ({ id: `f${i}`, fx: 0, fy: 0, fw: 0.2, fh: 0.2, label: '', color: FRAME_COLORS[0] }))
    expect(sanitizeDecor({ bg: 'plain', notes: [], frames: many }).frames.length).toBe(MAX_FRAMES)
  })
})

describe('makeImage', () => {
  it('clamps position/size and keeps the path', () => {
    const im = makeImage('id', 1.4, -1, 0.001, 2, '/tmp/pic.png')
    expect(im).toEqual({
      id: 'id',
      fx: 1.2933,
      fy: 0,
      fw: MIN_IMAGE_FRAC,
      fh: 1 + EXTRA_DOWN_FRAC,
      path: '/tmp/pic.png'
    })
  })
})

describe('sanitizeDecor images', () => {
  it('reads images back (back-compatible: no images key → [])', () => {
    expect(sanitizeDecor({ bg: 'dots', notes: [] }).images).toEqual([])
    const d = sanitizeDecor({
      bg: 'plain',
      notes: [],
      images: [
        { id: 'i1', fx: 0.1, fy: 0.2, fw: 0.3, fh: 0.25, path: '/d/a.png' },
        { id: 'i2', fx: 0, fy: 0, fw: 0.2, fh: 0.2 }, // no path → dropped
        { id: '', fx: 0, fy: 0, fw: 0.2, fh: 0.2, path: '/d/b.png' } // no id → dropped
      ]
    })
    expect(d.images.map((i) => i.id)).toEqual(['i1'])
    expect(d.images[0]).toEqual({ id: 'i1', fx: 0.1, fy: 0.2, fw: 0.3, fh: 0.25, path: '/d/a.png' })
  })
  it('caps image count at MAX_IMAGES', () => {
    const many = Array.from({ length: MAX_IMAGES + 12 }, (_, i) => ({ id: `i${i}`, fx: 0, fy: 0, fw: 0.2, fh: 0.2, path: `/d/${i}.png` }))
    expect(sanitizeDecor({ bg: 'plain', notes: [], images: many }).images.length).toBe(MAX_IMAGES)
  })
})
