import { describe, it, expect } from 'vitest'
import { createPaneRegistry } from './paneRegistry'

/** Sync test harness: defer runs immediately; focus-free is controllable. */
const harness = (
  focusFree = true
): { reg: ReturnType<typeof createPaneRegistry>; focused: string[]; setFree: (v: boolean) => void } => {
  let free = focusFree
  const focused: string[] = []
  const reg = createPaneRegistry({
    defer: (fn) => fn(),
    isFocusFree: () => free
  })
  return {
    reg,
    focused,
    setFree: (v: boolean) => {
      free = v
    }
  }
}

const cap = (log: string[], id: string): { focus: () => void } => ({ focus: () => log.push(id) })

describe('paneRegistry', () => {
  it('tracks the focused pane and notifies subscribers', () => {
    const { reg } = harness()
    const seen: Array<string | null> = []
    reg.subscribe((id) => seen.push(id))
    reg.register('a', { focus: () => {} })
    reg.noteFocused('a')
    expect(reg.focusedPaneId()).toBe('a')
    reg.noteBlurred('a')
    expect(reg.focusedPaneId()).toBeNull()
    expect(seen).toEqual(['a', null])
  })

  it('lastFocusedPaneId survives blur (MRU) and skips unregistered panes', () => {
    const { reg } = harness()
    reg.register('a', { focus: () => {} })
    reg.register('b', { focus: () => {} })
    reg.noteFocused('a')
    reg.noteFocused('b')
    reg.noteBlurred('b')
    expect(reg.lastFocusedPaneId()).toBe('b')
    reg.unregister('b')
    expect(reg.lastFocusedPaneId()).toBe('a')
  })

  it('restores focus to the MRU pane when the FOCUSED pane unmounts', () => {
    const { reg, focused } = harness()
    reg.register('a', cap(focused, 'a'))
    reg.register('b', cap(focused, 'b'))
    reg.noteFocused('a')
    reg.noteFocused('b')
    reg.unregister('b') // the focused pane goes away (close / hide / merge / deploy remount)
    expect(focused).toEqual(['a'])
  })

  it('never steals focus when something else already claimed it', () => {
    const { reg, focused, setFree } = harness()
    reg.register('a', cap(focused, 'a'))
    reg.register('b', cap(focused, 'b'))
    reg.noteFocused('b')
    setFree(false) // e.g. the user clicked an input while the pane unmounted
    reg.unregister('b')
    expect(focused).toEqual([])
  })

  it('unregistering a non-focused pane restores nothing', () => {
    const { reg, focused } = harness()
    reg.register('a', cap(focused, 'a'))
    reg.register('b', cap(focused, 'b'))
    reg.noteFocused('a')
    reg.unregister('b')
    expect(focused).toEqual([])
    expect(reg.focusedPaneId()).toBe('a')
  })
})

describe('paneRegistry capabilities', () => {
  it('capabilityFor returns the registered capability and null after unregister', () => {
    const { reg } = harness()
    const typed: string[] = []
    reg.register('a', { focus: () => {}, typeText: (t) => typed.push(t), pressEnter: () => typed.push('<CR>') })
    reg.capabilityFor('a')?.typeText?.('hello')
    reg.capabilityFor('a')?.pressEnter?.()
    expect(typed).toEqual(['hello', '<CR>'])
    reg.unregister('a')
    expect(reg.capabilityFor('a')).toBeNull()
  })
})
