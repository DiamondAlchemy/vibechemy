import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WELCOME_FRAME_ID, WELCOME_NOTE_ID, type CanvasDecor } from '@shared/canvas/decor'
import { CANVAS_WELCOMED_KEY, canvasDecorKey, readCockpitBg } from './useCanvasDecor'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

describe('first-run canvas seed', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('persists the welcome composition on the first unstored canvas', () => {
    expect(readCockpitBg('first')).toEqual({ bg: 'starfield', bgImage: '' })

    const seeded = JSON.parse(storage.getItem(canvasDecorKey('first')) ?? 'null') as CanvasDecor
    expect(seeded.notes.map((note) => note.id)).toEqual([WELCOME_NOTE_ID])
    expect(seeded.frames.map((frame) => frame.id)).toEqual([WELCOME_FRAME_ID])
    expect(storage.getItem(CANVAS_WELCOMED_KEY)).toBe('1')
  })

  it('seeds once per install and never resurrects dismissed content', () => {
    readCockpitBg('first')
    const seeded = JSON.parse(storage.getItem(canvasDecorKey('first')) ?? 'null') as CanvasDecor
    storage.setItem(canvasDecorKey('first'), JSON.stringify({ ...seeded, bg: 'plain', notes: [], frames: [] }))

    expect(readCockpitBg('first')).toEqual({ bg: 'plain', bgImage: '' })
    const dismissed = JSON.parse(storage.getItem(canvasDecorKey('first')) ?? 'null') as CanvasDecor
    expect(dismissed.notes).toEqual([])
    expect(dismissed.frames).toEqual([])
    expect(readCockpitBg('second')).toEqual({ bg: 'plain', bgImage: '' })
  })
})
