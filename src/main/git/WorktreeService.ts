import type { ProjectStore } from '../projects/ProjectStore'
import type { SessionManager } from '../sessions/SessionManager'
import { listWorktrees, isWorktreeDirty, removeWorktree, pruneBranch } from '../sessions/worktree'
import type { WorktreeEntry } from '@shared/types'
import { PRODUCT_IDENTITY } from '@shared/product'

export interface RemoveResult {
  ok: boolean
  message: string
}

/**
 * Enumerates and prunes the git worktrees the app created for isolated agents.
 * Only worktrees whose branch uses the product seam's prefix are app-managed — that filter
 * cleanly excludes every repo's main checkout and any worktree the user made themselves, so
 * this can never offer to delete real working trees. Removal mirrors the safety already in
 * MergeService: never touch a worktree a live session is using, and never silently discard
 * uncommitted work.
 */
export class WorktreeService {
  constructor(
    private projects: ProjectStore,
    private sessions: SessionManager
  ) {}

  /** Every app-managed worktree on disk, across all registered projects, with dirty + in-use status. */
  async list(): Promise<WorktreeEntry[]> {
    // Running/detached sessions only — these are the ones still "living" in a worktree.
    const liveByCwd = new Map<string, string>()
    for (const s of this.sessions.list()) liveByCwd.set(s.cwd, s.title)

    const out: WorktreeEntry[] = []
    for (const p of this.projects.listProjects()) {
      const worktrees = await listWorktrees(p.rootPath)
      for (const wt of worktrees) {
        // App-managed only — skips main checkout + user worktrees.
        if (!wt.branch.startsWith(PRODUCT_IDENTITY.worktreeBranchPrefix)) continue
        const dirty = await isWorktreeDirty(wt.path).catch(() => false)
        out.push({
          path: wt.path,
          branch: wt.branch,
          projectId: p.id,
          projectName: p.name,
          dirty,
          inUse: liveByCwd.has(wt.path),
          sessionTitle: liveByCwd.get(wt.path)
        })
      }
    }
    return out
  }

  /**
   * Remove one app-managed worktree and prune its branch. Guards are re-derived from live state here
   * (never trust the renderer): refuse while a session is using it; refuse a dirty worktree
   * unless `force` is set (the UI confirms first).
   */
  async remove(path: string, opts: { force?: boolean } = {}): Promise<RemoveResult> {
    const entry = (await this.list()).find((w) => w.path === path)
    if (!entry) return { ok: false, message: 'Worktree not found — it may already be gone.' }
    if (entry.inUse) return { ok: false, message: 'In use by a running session — close its pane first.' }
    if (entry.dirty && !opts.force) return { ok: false, message: 'Has uncommitted changes — confirm to discard them.' }

    const project = this.projects.listProjects().find((p) => p.id === entry.projectId)
    if (!project) return { ok: false, message: 'Could not resolve the project repo for this worktree.' }

    try {
      await removeWorktree(project.rootPath, path) // git worktree remove --force
      await pruneBranch(project.rootPath, entry.branch).catch(() => {}) // best-effort branch delete
      return { ok: true, message: `Removed ${entry.branch}.` }
    } catch (e) {
      return { ok: false, message: `Could not remove the worktree: ${(e as Error).message}` }
    }
  }
}
