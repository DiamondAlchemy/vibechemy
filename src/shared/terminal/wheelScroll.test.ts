import { describe, it, expect } from 'vitest'
import { wheelToAction } from './wheelScroll'

describe('wheelToAction', () => {
  it('forwards under mouse mode (natural scroll v2: tmux mouse on — tmux routes the wheel)', () => {
    expect(wheelToAction(-120, { mouseTracking: true, alternate: true })).toEqual({ kind: 'xterm' })
    expect(wheelToAction(120, { mouseTracking: true, alternate: false })).toEqual({ kind: 'xterm' })
  })

  it('defers to xterm on the primary screen without mouse mode (local viewport scrollback)', () => {
    expect(wheelToAction(-120, { mouseTracking: false, alternate: false })).toEqual({ kind: 'xterm' })
    expect(wheelToAction(120, { mouseTracking: false, alternate: false })).toEqual({ kind: 'xterm' })
  })

  it('fallback only — no mouse mode at all: alt-screen wheel-up surfaces the History overlay', () => {
    expect(wheelToAction(-120, { mouseTracking: false, alternate: true })).toEqual({ kind: 'history' })
    expect(wheelToAction(-1, { mouseTracking: false, alternate: true })).toEqual({ kind: 'history' })
  })

  it('is inert on scroll-down over the live alt screen (nothing below the live view)', () => {
    expect(wheelToAction(120, { mouseTracking: false, alternate: true })).toEqual({ kind: 'inert' })
  })

  it('ignores zero-delta events on the alt screen', () => {
    expect(wheelToAction(0, { mouseTracking: false, alternate: true })).toEqual({ kind: 'inert' })
  })
})
