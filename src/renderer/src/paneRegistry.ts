/**
 * Renderer-wide registry of live terminal panes: which pane has keyboard focus,
 * MRU order, and a per-pane capability surface.
 *
 * When the focused pane unmounts (close / hide / merge / a deploy remounting the grid), DOM focus
 * silently falls to <body> and every keystroke — including Esc-to-interrupt —
 * goes nowhere, with only a hollow cursor as a cue. The registry restores focus
 * to the most-recently-used pane when that happens.
 *
 * DOCTRINE (TerminalPane.tsx has the scars): never fight xterm's native
 * click-to-focus. This registry is passive — it only observes focus events and
 * acts in exactly one case: the focused pane UNMOUNTED and focus is provably
 * free (on <body>). No blur→refocus loops, no click handlers.
 *
 * The same capability surface supports scoped programmatic text entry without coupling callers to
 * terminal internals.
 */
export interface PaneCapability {
  focus: () => void
  /** Type text into the pane's PTY, bracketed-paste framed by the owning TerminalPane. */
  typeText?: (text: string) => void
  /** A discrete Enter, sent separately from inserted text. */
  pressEnter?: () => void
}

export interface PaneRegistryOpts {
  /** Injectable for tests. Default: macrotask, so React finishes the unmount first. */
  defer?: (fn: () => void) => void
  /** Injectable for tests. Default: focus fell to <body> (nothing else claimed it). */
  isFocusFree?: () => boolean
}

export interface PaneRegistry {
  register: (id: string, cap: PaneCapability) => void
  unregister: (id: string) => void
  noteFocused: (id: string) => void
  noteBlurred: (id: string) => void
  /** The pane holding live DOM focus right now, or null (focus is on chrome/body). */
  focusedPaneId: () => string | null
  /** MRU: the last pane that had focus and is still mounted. */
  lastFocusedPaneId: () => string | null
  /** The live capability surface for a mounted pane (null once unregistered). */
  capabilityFor: (id: string) => PaneCapability | null
  subscribe: (cb: (focusedId: string | null) => void) => () => void
}

export function createPaneRegistry(opts: PaneRegistryOpts = {}): PaneRegistry {
  const defer = opts.defer ?? ((fn: () => void): void => void window.setTimeout(fn, 0))
  const isFocusFree =
    opts.isFocusFree ?? ((): boolean => document.activeElement === document.body || document.activeElement === null)

  const caps = new Map<string, PaneCapability>()
  let mru: string[] = []
  let focusedId: string | null = null
  const subs = new Set<(id: string | null) => void>()
  const notify = (): void => subs.forEach((cb) => cb(focusedId))

  return {
    register(id, cap) {
      caps.set(id, cap)
    },
    unregister(id) {
      caps.delete(id)
      mru = mru.filter((x) => x !== id)
      if (focusedId !== id) return
      focusedId = null
      notify()
      const next = mru.find((x) => caps.has(x))
      if (next) {
        defer(() => {
          if (isFocusFree()) caps.get(next)?.focus()
        })
      }
    },
    noteFocused(id) {
      focusedId = id
      mru = [id, ...mru.filter((x) => x !== id)]
      notify()
    },
    noteBlurred(id) {
      if (focusedId !== id) return
      focusedId = null
      notify()
    },
    focusedPaneId: () => focusedId,
    lastFocusedPaneId: () => mru.find((x) => caps.has(x)) ?? null,
    capabilityFor: (id) => caps.get(id) ?? null,
    subscribe(cb) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    }
  }
}

/** The app-wide singleton (components import this; tests build their own instance). */
export const paneRegistry = createPaneRegistry()
