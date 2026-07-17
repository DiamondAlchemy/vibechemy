/**
 * Wait until a pane's output stops changing — the signal that a freshly-spawned
 * CLI has finished rendering its banner and reached its input prompt. Heavy CLIs
 * (Claude Code with MCP auth + skills, or a personal agent with its briefing) take a variable
 * 4-10s; a fixed sleep can stage the prompt before the CLI is ready to submit it. Extracted from
 * SessionManager.scheduleOpeningPrompt
 * so the control plane's task injection shares the same readiness logic.
 * Best-effort by design: resolves (never throws) at maxWaitMs even if the pane
 * never stabilizes.
 */
export interface PaneStableOpts {
  capture: (name: string, lines?: number) => Promise<string>
  /** Minimum wait before the first look — even a fast CLI needs a beat. */
  floorMs?: number
  /** Give-up deadline; resolve anyway so injection stays best-effort. */
  maxWaitMs?: number
  pollMs?: number
  /** Injectable for tests. Default: unref'd setTimeout (never keeps the app alive). */
  delay?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((r) => {
    const h = setTimeout(r, ms)
    if (typeof h.unref === 'function') h.unref()
  })

/** Cheap "how much changed" between two pane snapshots: positional char mismatches + the length
 *  delta. A spinner / blinking cursor / ticking clock flips a few chars (≤ tolerance) → reads as
 *  settled; active rendering or a scroll shifts many chars → stays unsettled. Replaces exact-equality,
 *  which a persistent animation can keep false forever and force the full 30s wait. */
export function paneCharDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let d = Math.abs(a.length - b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++
  return d
}
/** Max chars that may differ between consecutive snapshots and still count as "stable". */
export const STABLE_DIFF_TOLERANCE = 3

export async function waitForPaneStable(name: string, opts: PaneStableOpts): Promise<void> {
  const floorMs = opts.floorMs ?? 2500
  const maxWaitMs = opts.maxWaitMs ?? 30000
  const pollMs = opts.pollMs ?? 1200
  const delay = opts.delay ?? defaultDelay
  const now = opts.now ?? ((): number => Date.now())

  await delay(floorMs)
  let prev = ''
  let errors = 0
  const start = now()
  while (now() - start < maxWaitMs) {
    const snap = await opts.capture(name, 40).then(
      (s) => {
        errors = 0
        return s
      },
      () => {
        errors++
        return null
      }
    )
    if (snap !== null) {
      // Settled once the snapshot barely changes poll-to-poll — small char-diff tolerates a spinner /
      // blinking cursor / clock without waiting the full deadline; real rendering keeps it unsettled.
      if (snap.trim().length > 0 && prev.length > 0 && paneCharDiff(snap, prev) <= STABLE_DIFF_TOLERANCE)
        return
      prev = snap
    } else if (errors >= 3) {
      return // pane is gone (killed/never existed) — don't hold injection for the full deadline
    }
    await delay(pollMs)
  }
}
