import { existsSync } from 'node:fs'
import type { SessionManager } from '../sessions/SessionManager'
import type { PtyBridge } from '../sessions/PtyBridge'
import type { ActivityLog } from '../activity/ActivityLog'
import {
  diffBranch,
  mergeBranch,
  removeWorktree,
  pruneBranch,
  currentBranch,
  isWorktreeDirty,
  commitAll
} from '../sessions/worktree'

export interface DiffResult {
  ok: boolean
  diff: string
  files: number
  message?: string
}
export interface MergeResult {
  ok: boolean
  conflict?: boolean
  message: string
  mergedInto?: string
}
export interface DiscardResult {
  ok: boolean
  message?: string
}

/**
 * The single, app-owned path for integrating an isolated worker's branch back
 * into its origin repo. All merges to a project branch flow through here —
 * this is the "one writer to main" guarantee. Merges are LOCAL only; pushing
 * and deploying stay human-triggered.
 */
export class MergeService {
  constructor(
    private sessions: SessionManager,
    private pty: PtyBridge,
    private activity?: ActivityLog
  ) {}

  async diff(sessionId: string): Promise<DiffResult> {
    const s = this.sessions.get(sessionId)
    if (!s?.branch || !s.originRoot) return { ok: false, diff: '', files: 0, message: 'Not an isolated session' }
    if (!existsSync(s.originRoot))
      return { ok: false, diff: '', files: 0, message: `The origin repo for this worker no longer exists (${s.originRoot}).` }
    const { diff, files } = await diffBranch(s.originRoot, s.branch)
    return { ok: true, diff, files }
  }

  async merge(sessionId: string): Promise<MergeResult> {
    const s = this.sessions.get(sessionId)
    // Act on any isolated session whose worktree is still on disk — running OR exited (so
    // leftover worktrees from closed sessions can still be merged). Refuse once it's gone.
    if (!s?.branch || !s.originRoot || !existsSync(s.cwd))
      return { ok: false, message: 'No isolated worktree to merge' }
    // Dead-origin guard: a NESTED isolated spawn persists its caller's
    // (worktree) cwd as originRoot; if that parent was removed, merging into it silently fails /
    // leaks. Refuse honestly instead of operating on a dead root.
    if (!existsSync(s.originRoot))
      return {
        ok: false,
        message: `The origin repo for this worker is gone (${s.originRoot}) — merge isn't possible. Discard it, or recover the work from the branch manually.`
      }
    // Capture any uncommitted work onto the branch FIRST — otherwise merging only folds in
    // committed commits and the worktree removal below would silently discard the rest.
    try {
      if (await isWorktreeDirty(s.cwd)) await commitAll(s.cwd, 'Vibechemy: capture uncommitted work before merge')
    } catch (e) {
      return { ok: false, message: `Could not save the worktree's uncommitted changes: ${(e as Error).message}` }
    }
    const into = await currentBranch(s.originRoot)
    const outcome = await mergeBranch(s.originRoot, s.branch)
    if (!outcome.ok) return { ok: false, conflict: outcome.conflict, message: outcome.message }
    this.activity?.record({
      projectId: s.projectId,
      kind: 'merge',
      presetId: s.presetId,
      branch: s.branch,
      summary: `Merged ${s.branch} into ${into}`
    })
    const cleaned = await this.teardown(sessionId, s.originRoot, s.cwd, s.branch)
    return {
      ok: true,
      mergedInto: into,
      message: cleaned
        ? `Merged into ${into} and cleaned up.`
        : `Merged into ${into}, but the worktree could not be removed — prune it in the Worktrees panel.`
    }
  }

  async discard(sessionId: string): Promise<DiscardResult> {
    const s = this.sessions.get(sessionId)
    if (!s) return { ok: true } // already gone
    if (s.branch) {
      this.activity?.record({
        projectId: s.projectId,
        kind: 'discard',
        presetId: s.presetId,
        branch: s.branch,
        summary: `Discarded ${s.branch}`
      })
    }
    // ALWAYS kill the pane: the old early-return for a NON-ISOLATED worker
    // (no branch/originRoot) skipped teardown entirely, so the tmux pane stayed alive while the
    // caller still fired worker_removed → a false "died unexpectedly" tombstone over a live worker.
    const cleaned = await this.teardown(sessionId, s.originRoot, s.cwd, s.branch)
    return cleaned
      ? { ok: true }
      : { ok: false, message: `Closed the pane, but worktree "${s.branch}" could not be removed — prune it in the Worktrees panel.` }
  }

  // Detach the viewer, kill the tmux session + mark the record exited, then (for an isolated
  // worker) remove the worktree and — only if that succeeded — delete the branch (git refuses to
  // delete a branch checked out in a live worktree, so the ordering is load-bearing). Returns
  // whether cleanup is complete: true when there was nothing to remove OR the worktree came off,
  // false when a worktree removal failed (a leaked worktree — surfaced to the caller, not swallowed).
  private async teardown(
    sessionId: string,
    originRoot: string | null | undefined,
    worktreePath: string,
    branch: string | null | undefined
  ): Promise<boolean> {
    this.pty.detach(sessionId)
    await this.sessions.kill(sessionId)
    if (!originRoot || !worktreePath || !existsSync(worktreePath)) return true // no worktree to remove
    const wtRemoved = await removeWorktree(originRoot, worktreePath)
      .then(() => true)
      .catch((e) => {
        console.error('[MergeService] removeWorktree failed:', e)
        return false
      })
    if (wtRemoved && branch) {
      await pruneBranch(originRoot, branch).catch((e) => console.error('[MergeService] pruneBranch failed:', e))
    }
    return wtRemoved
  }
}
