import type { SessionRecord } from '../types'
import { canonicalPersonalAgentPresetId } from '../agents/personalAgent'

/**
 * How far back a closed orchestrator stays one-click reopenable. Past this it ages out of the
 * reopen tray (you can still resume it by hand — `claude --resume` / `codex resume`). The tray is a
 * safety net for *accidental* closes, which are recent; older walked-away orchestras shouldn't
 * clutter it. Tunable.
 */
export const REOPEN_WINDOW_MS = 72 * 60 * 60 * 1000 // 72h

/**
 * The dedup/dismiss slot key: one reopen slot per (agent preset + working folder). Two closed
 * "Claude" orchestras in different repos are DIFFERENT slots (different cwd); two in the same repo
 * collapse to the newest.
 */
export function closedOrchestratorKey(r: { presetId: string; cwd: string }): string {
  return `${canonicalPersonalAgentPresetId(r.presetId)}:${r.cwd}`
}

/** Persisted dismiss state: slot key → epoch ms the user banished it. A slot reappears only if a
 *  session is closed for it AFTER that time (a genuinely new close), never an older ghost. */
export type ReopenDismissMap = Record<string, number>

export interface SelectClosedOpts {
  isOrchestrator: (presetId: string) => boolean
  cwdExists: (cwd: string) => boolean
  dismissed: ReopenDismissMap
  now: number
  windowMs?: number
  max?: number
}

/**
 * The reopenable closed orchestrators: exited/failed orchestrator sessions whose working folder
 * still exists, closed within `windowMs`, one (newest) per slot, excluding any slot that's live
 * again or that the user dismissed and hasn't re-closed since. Newest first, capped at `max`.
 */
export function selectClosedOrchestrators(rows: SessionRecord[], opts: SelectClosedOpts): SessionRecord[] {
  const { isOrchestrator, cwdExists, dismissed, now } = opts
  const windowMs = opts.windowMs ?? REOPEN_WINDOW_MS
  const max = opts.max ?? 8
  const cutoff = now - windowMs

  const liveKeys = new Set(
    rows.filter((r) => r.status === 'running' || r.status === 'detached').map((r) => closedOrchestratorKey(r))
  )
  const seen = new Set<string>()
  return rows
    .filter(
      (r) =>
        (r.status === 'exited' || r.status === 'failed') &&
        !!r.cwd &&
        r.lastSeenAt >= cutoff &&
        isOrchestrator(r.presetId) &&
        cwdExists(r.cwd)
    )
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .filter((r) => {
      const k = closedOrchestratorKey(r)
      if (liveKeys.has(k) || seen.has(k)) return false
      seen.add(k) // claim the slot even if we then drop it — an older ghost must never resurface
      const d = dismissed[k]
      if (d !== undefined && r.lastSeenAt <= d) return false
      return true
    })
    .slice(0, max)
}
