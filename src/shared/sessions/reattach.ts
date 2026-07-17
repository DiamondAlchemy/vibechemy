/**
 * Self-heal decision for a dead pty attach client.
 *
 * Vibechemy's terminals are `tmux attach-session` clients spawned by PtyBridge. The tmux
 * SESSION is the durable thing; the attach CLIENT is disposable. A client can die on its own —
 * a startup-race after an app restart, a stray `detach-client`, a transient tmux hiccup — while
 * the session it was viewing is still perfectly alive. Before this predicate, that left the pane
 * BLANK forever: the renderer attaches exactly once per mount, and main treated any live-session
 * client death as a benign viewer detach (no re-attach). The result was zero attach clients while
 * sessions stayed alive but their panes rendered blank.
 *
 * This is the single decision seam: given whether the death was deliberate, whether the tmux
 * session is still alive, and how many heal attempts have already been spent in the current
 * window, decide whether to re-attach. Pure + total so it is unit-testable in isolation.
 */
export function shouldReattach(opts: {
  /** The client was killed ON PURPOSE (detach / disposeAll — user closed the pane / app quitting). */
  deliberate: boolean
  /** `tmux has-session` for this session is still true — the session is alive, only the client died. */
  sessionAlive: boolean
  /** Heal attempts already spent in the current window (see HEAL_WINDOW_MS). */
  attempts: number
  /** Cap on heal attempts per window (HEAL_MAX_ATTEMPTS). */
  max: number
}): boolean {
  // A deliberate teardown must never re-attach — that would resurrect a pane the operator closed
  // (or double-attach one the app is disposing). This is the invariant that keeps hide / close /
  // layout-switch / project-switch / quit from looping.
  if (opts.deliberate) return false
  // The tmux session genuinely died (the program inside it exited): let the normal exit path
  // tombstone it — a re-attach would just fail against a gone session, forever.
  if (!opts.sessionAlive) return false
  // An involuntary death of a still-alive session: heal, as long as we have budget left. The cap
  // stops a session that reports alive but that we can never actually attach to (e.g. a nested
  // `$TMUX` refusal) from spinning up an infinite respawn loop.
  return opts.attempts < opts.max
}

/** Max re-attach attempts per window before we give up and leave the pane settled. */
export const HEAL_MAX_ATTEMPTS = 2

/**
 * Short backoff before a heal re-attach — gives the tmux server a beat to settle after whatever
 * killed the client (a restart-boundary churn, a detach-client) so the retry lands on a stable
 * server instead of racing the same condition.
 */
export const HEAL_BACKOFF_MS = 400

/**
 * Deaths closer together than this share ONE attempt budget; a client that heals and then streams
 * happily for longer than the window earns a fresh budget on its next (unrelated) death. This is
 * what keeps the cap meaningful on an always-on app: fast flapping (dead session that reports
 * alive) is bounded, while a genuine one-off client death months apart always gets to heal.
 */
export const HEAL_WINDOW_MS = 30_000
