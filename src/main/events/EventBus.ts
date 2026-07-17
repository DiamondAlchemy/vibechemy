import type { McEvent, McEventKind } from '@shared/events'

/**
 * The single main→renderer push channel. `emit(kind)` is per-kind trailing-debounced
 * (default 200ms) so a burst of same-kind events (e.g. spawning N workers) collapses into
 * ONE send, while distinct kinds never coalesce into each other. It owns the debouncing the
 * boot code used to hand-roll. Constructed with the send function so it's testable with fake timers.
 */
export class EventBus {
  private timers = new Map<McEventKind, NodeJS.Timeout>()

  constructor(
    private send: (e: McEvent) => void,
    private debounceMs = 200
  ) {}

  emit(kind: McEventKind): void {
    const existing = this.timers.get(kind)
    if (existing) clearTimeout(existing)
    this.timers.set(
      kind,
      setTimeout(() => {
        this.timers.delete(kind)
        this.send({ kind })
      }, this.debounceMs)
    )
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}
