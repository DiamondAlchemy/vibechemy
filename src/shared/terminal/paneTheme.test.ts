import { describe, it, expect } from 'vitest'
import { PANE_THEMES, ASSIGNABLE_PANE_THEMES, resolvePaneTheme, xtermThemeFor } from './paneTheme'

// xterm's color parser accepts hex and rgb()/rgba() ONLY — hsl() fails silently and the terminal
// renders BLACK. Every theme color must match this.
const XTERM_SAFE = /^#[0-9a-fA-F]{6}$|^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/

describe('PANE_THEMES catalog', () => {
  it('every color in every theme is xterm-parseable (hex or rgb/rgba, never hsl)', () => {
    for (const t of PANE_THEMES) {
      for (const c of [t.accent, t.bg, t.fg, t.cursor, t.cursorAccent, t.selection, t.glassBg]) {
        expect(c, `${t.id}: ${c}`).toMatch(XTERM_SAFE)
      }
    }
  })

  it('theme ids are unique and the auto-assignment pool contains only real, dark themes', () => {
    const ids = PANE_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ASSIGNABLE_PANE_THEMES) expect(ids).toContain(id)
    // The light profiles are deliberate picks, never surprises.
    expect(ASSIGNABLE_PANE_THEMES).not.toContain('manpage')
    expect(ASSIGNABLE_PANE_THEMES).not.toContain('daylight')
  })

  it('glass variants carry a real alpha so the theme reads over the canvas', () => {
    for (const t of PANE_THEMES) {
      const alpha = Number(/rgba\(\d+,\d+,\d+,([\d.]+)\)/.exec(t.glassBg)?.[1])
      expect(alpha, t.id).toBeGreaterThan(0.3)
      expect(alpha, t.id).toBeLessThan(0.85)
    }
  })
})

describe('resolvePaneTheme', () => {
  it('resolves by id and falls back to navy for unknown/absent tokens', () => {
    expect(resolvePaneTheme('ember').id).toBe('ember')
    expect(resolvePaneTheme(undefined).id).toBe('navy')
    expect(resolvePaneTheme('no-such-theme').id).toBe('navy')
    expect(resolvePaneTheme('').id).toBe('navy')
  })

  it('maps legacy PANE_PALETTE accent hexes to a similar DARK theme (no pane flips light on upgrade)', () => {
    expect(resolvePaneTheme('#7fe3ff').id).toBe('navy')
    expect(resolvePaneTheme('#ffc24b').id).toBe('ember')
    expect(resolvePaneTheme('#5dffb0').id).toBe('grass')
    expect(resolvePaneTheme('#c79bff').id).toBe('violet')
    expect(resolvePaneTheme('#ff7a85').id).toBe('redsands')
    expect(resolvePaneTheme('#8fd0ff').id).toBe('ocean')
    expect(resolvePaneTheme('#76b900').id).toBe('homebrew')
    // Unknown hex → navy, and specifically never a light theme.
    expect(resolvePaneTheme('#123456').id).toBe('navy')
  })
})

describe('xtermThemeFor', () => {
  it('swaps only the background between opaque and glass', () => {
    const opaque = xtermThemeFor('ocean', false)
    const glass = xtermThemeFor('ocean', true)
    expect(opaque.background).toBe('#0b2a4d')
    expect(glass.background).toBe('rgba(11,42,77,0.58)')
    expect(glass.foreground).toBe(opaque.foreground)
    expect(glass.cursor).toBe(opaque.cursor)
    expect(glass.selectionBackground).toBe(opaque.selectionBackground)
  })

  it('light themes carry their own dark foreground/cursor', () => {
    const light = xtermThemeFor('manpage', false)
    expect(light.background).toBe('#f7edc2')
    expect(light.foreground).toBe('#211d10')
  })

  it('default (no token) is the classic navy, whisper glass preserved', () => {
    expect(xtermThemeFor(undefined, false).background).toBe('#0c1e34')
    expect(xtermThemeFor(undefined, true).background).toBe('rgba(10,24,42,0.38)')
  })
})
