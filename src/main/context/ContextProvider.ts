import { join, basename } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { MemoryStore } from '../memory/MemoryStore'
import { nativeFileName, mergeManagedBlock, buildBrief } from '../memory/projection'
import type { StandardsStore } from '../standards/StandardsStore'
import { ensureExcluded } from '../git/localExclude'

// Directories that are always Vibechemy's own — never the project's app code — kept out
// of git so an agent's `git add -A` can't sweep them into the repo's history (and on to prod):
//   .vibechemy/         — the per-project memory store we read/seed
//   .playwright-mcp/   — browser-MCP console/screenshot logs written into the cwd
// These are DIRECTORY patterns, which are Vibechemy-owned in every folder and every worktree, so a
// single shared info/exclude entry is always correct. We deliberately do NOT exclude the native
// context files (CLAUDE.md / AGENTS.md / GEMINI.md): they are either the user's own (must stay
// tracked) or a harmless Vibechemy-projected file, and a bare filename in the worktree-shared exclude
// is anchorless — it would wrongly suppress a user's same-named file across the main repo and
// every sibling worktree (and every per-package one in a monorepo). (The Vibechemy-created node_modules
// symlink is excluded separately at link time — see worktree.ts:linkNodeModules.)
const ALWAYS_EXCLUDE = ['.vibechemy/', '.playwright-mcp/']

/**
 * Shared Project Memory projection. Memory + learnings are read from `projectRoot`; the
 * managed block is written into `spawnCwd` (which equals projectRoot for a normal spawn, or
 * the agent's git worktree when isolated). Project-scoped spawns only; shells/no-context CLIs skip.
 */
export class ContextProvider {
  constructor(
    private memory: MemoryStore = new MemoryStore(),
    // The curated coding-standards layer — injected into every worker's brief (optional so the
    // existing file-only ContextProvider tests keep working without a DB).
    private standards?: StandardsStore
  ) {}

  async prepare(
    command: string,
    projectRoot: string,
    projectId: string | null,
    spawnCwd: string = projectRoot
  ): Promise<void> {
    if (!projectId) return
    const file = nativeFileName(command)
    if (!file) return
    if (!existsSync(spawnCwd)) return

    const global = this.memory.readGlobal()
    const project = this.memory.readProject(projectRoot)
    const learnings = this.memory.readLearnings(projectRoot)
    // The curated coding standards (globals + this project's), rule-first — injected so every
    // worker, on every model, writes code the same way. Empty when there's no standards store/rules.
    const standards = this.standards?.renderForProject(projectId) ?? ''
    const seededFrom = /Seeded from your existing (\S+?\.md)\b/i.exec(project)?.[1]
    const includeProject = !seededFrom || seededFrom.toLowerCase() !== file.toLowerCase()
    const body = buildBrief({
      projectName: basename(projectRoot) || 'project',
      global,
      project,
      learnings,
      standards,
      includeProject
    })

    const target = join(spawnCwd, file)
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : ''
    const merged = mergeManagedBlock(existing, body)
    if (merged !== existing) writeFileSync(target, merged)

    // Keep our own non-code artifacts out of the repo so `git add -A` can't sweep them into
    // history (or on to production). Directory-only — see ALWAYS_EXCLUDE for why we never
    // exclude the native context file itself.
    await ensureExcluded(spawnCwd, ALWAYS_EXCLUDE)
  }
}
