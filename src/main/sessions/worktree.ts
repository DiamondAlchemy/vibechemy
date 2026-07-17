import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync, existsSync, readFileSync } from 'node:fs'
import { symlink, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureExcluded } from '../git/localExclude'
import { stripManagedBlock } from '../memory/projection'

const pexec = promisify(execFile)

// The native context files the app projects its managed block into. A worktree whose ONLY
// change is that block must NOT read as dirty: projected blocks must not block auto-discard or
// get swept into history by merge's pre-capture.
const NATIVE_CONTEXT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']

/** Porcelain path column (col 4+), taking the destination side of a rename. */
function porcelainPath(line: string): string {
  return line.slice(3).split(' -> ').pop() ?? ''
}

/** True only when a context file's USER content (managed block stripped) differs from HEAD —
 *  i.e. the agent really edited it, not just the app's projection. */
async function contextFileHasRealChange(worktreePath: string, file: string): Promise<boolean> {
  const target = join(worktreePath, file)
  const userNow = stripManagedBlock(existsSync(target) ? readFileSync(target, 'utf8') : '').trim()
  let committed = ''
  try {
    const { stdout } = await pexec('git', ['-C', worktreePath, 'show', `HEAD:${file}`])
    committed = stripManagedBlock(stdout).trim()
  } catch {
    committed = '' // file not in HEAD (the app created it fresh in this worktree)
  }
  return userNow !== committed
}

/**
 * On macOS, os.tmpdir() returns a symlinked path like `/tmp/...` while git
 * always resolves symlinks and stores the canonical form `/private/tmp/...`.
 * Normalize a git-reported path back to the form that Node callers expect.
 */
function normalizeWorktreePath(p: string): string {
  try {
    const td = tmpdir()
    const realTd = realpathSync(td)
    if (realTd !== td && p.startsWith(realTd + '/')) {
      return td + p.slice(realTd.length)
    }
  } catch {
    /* ignore — best-effort normalization */
  }
  return p
}

/** True if `dir` is inside a git work tree. */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const { stdout } = await pexec('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'])
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/** Current commit SHA at `dir` — used as the base for new worktrees. */
export async function currentRef(dir: string): Promise<string> {
  const { stdout } = await pexec('git', ['-C', dir, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

/** Create a worktree at `worktreePath` on a NEW branch `branch`, based on `baseRef`. */
export async function addWorktree(
  repoDir: string,
  worktreePath: string,
  branch: string,
  baseRef: string
): Promise<void> {
  await pexec('git', ['-C', repoDir, 'worktree', 'add', '-b', branch, worktreePath, baseRef])
}

export interface WorktreeInfo {
  path: string
  branch: string
}

/** List worktrees of the repo (porcelain). Branch is the short name; detached ones are skipped. */
export async function listWorktrees(repoDir: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await pexec('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'])
    const out: WorktreeInfo[] = []
    let path = ''
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        path = normalizeWorktreePath(line.slice('worktree '.length).trim())
      } else if (line.startsWith('branch ') && path) {
        out.push({
          path,
          branch: line
            .slice('branch '.length)
            .trim()
            .replace(/^refs\/heads\//, '')
        })
        path = ''
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Remove a worktree (force by default — discards uncommitted changes in that worktree).
 *
 * Self-heals an ORPHANED worktree. If git refuses `worktree remove` — because the path is
 * no longer a registered worktree (its `.git/worktrees/<id>` admin dir was lost, e.g. an
 * earlier remove that deregistered but couldn't rmdir the folder), or because it can't
 * remove a leftover like a node_modules symlink — we prune git's stale registry and delete
 * the directory ourselves. Both call sites (discard, and merge AFTER the work is committed
 * to the branch) intend the folder gone, so falling back to a direct remove is safe and
 * makes the caller's leftover actually clear instead of lingering forever. `rm` never follows
 * symlinks, so a linked node_modules is unlinked, not nuked.
 */
export async function removeWorktree(repoDir: string, worktreePath: string, force = true): Promise<void> {
  const args = ['-C', repoDir, 'worktree', 'remove']
  if (force) args.push('--force')
  args.push(worktreePath)
  try {
    await pexec('git', args)
  } catch {
    await pexec('git', ['-C', repoDir, 'worktree', 'prune']).catch(() => {})
    if (existsSync(worktreePath)) await rm(worktreePath, { recursive: true, force: true })
  }
}

/** True if the worktree has any uncommitted changes (modified, staged, or untracked). */
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const { stdout } = await pexec('git', ['-C', worktreePath, 'status', '--porcelain'])
  // NB: never .trim() the whole output — porcelain status codes are position-sensitive
  // (col 0-1 = X/Y, path at col 3), so trimming eats the first line's leading space.
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return false
  // Discount a change that is PURELY the app's projected context block. Any change to
  // a non-context file is real dirt; a context file counts only if the agent actually
  // edited its user content (block stripped), not just the app's projection.
  for (const line of lines) {
    const p = porcelainPath(line)
    if (!NATIVE_CONTEXT_FILES.includes(p)) return true
    if (await contextFileHasRealChange(worktreePath, p)) return true
  }
  return false
}

/**
 * Commit everything currently in the worktree onto its branch — used to capture an
 * agent's uncommitted work before a merge so it can't be silently lost when the worktree
 * is later removed. Uses an explicit identity so it never fails on missing git config.
 */
export async function commitAll(worktreePath: string, message: string): Promise<void> {
  await pexec('git', ['-C', worktreePath, 'add', '-A'])
  await pexec('git', [
    '-C',
    worktreePath,
    '-c',
    'user.email=vibechemy@local',
    '-c',
    'user.name=Vibechemy',
    'commit',
    '-m',
    message
  ])
}

/** The repo's current branch name (the target a merge folds into). */
export async function currentBranch(repoDir: string): Promise<string> {
  const { stdout } = await pexec('git', ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  return stdout.trim()
}

/** Force-delete a local branch (used after a merge, or to discard a worker). */
export async function pruneBranch(repoDir: string, branch: string): Promise<void> {
  await pexec('git', ['-C', repoDir, 'branch', '-D', branch])
}

/**
 * Symlink the repo's node_modules into a fresh worktree so isolated workers can
 * build/test immediately. Best-effort: no-op if the repo has no node_modules or
 * the worktree already has one. Never throws.
 */
export async function linkNodeModules(repoDir: string, worktreePath: string): Promise<void> {
  const src = join(repoDir, 'node_modules')
  const dest = join(worktreePath, 'node_modules')
  try {
    await access(src) // repo has deps to link?
  } catch {
    return // nothing to link
  }
  // This node_modules is a SYMLINK that the app creates — never the worker's work. Keep git from
  // ever capturing it: the project's `.gitignore node_modules/` is directory-only and does NOT
  // match a symlink of the same name, so without this a merge's `git add -A` capture commit
  // sweeps the symlink in and leaks it into the origin repo (clobbering the real deps). A bare
  // `node_modules` entry is anchorless, but unlike a context file (see ContextProvider) it is
  // safe here — node_modules is a build artifact no one tracks anywhere. Run before the symlink
  // exists, and on every link (covers worktrees created before this fix), since it is idempotent.
  await ensureExcluded(worktreePath, ['node_modules'])
  try {
    await access(dest) // worktree already has node_modules?
    return
  } catch {
    /* dest absent → create the link below */
  }
  try {
    await symlink(src, dest, 'dir') // 'dir' is required on Windows; ignored elsewhere
  } catch {
    /* best-effort: leave the worktree without a link rather than fail the spawn */
  }
}

export interface MergeOutcome {
  ok: boolean
  conflict: boolean
  message: string
}

/**
 * Run a shell command inside a worktree (used by the control plane's `run_check`
 * so an orchestrator can build/test a worker before merging). Resolves with the
 * exit code and tail-capped combined output — never rejects on a non-zero exit.
 */
export async function runInWorktree(
  cwd: string,
  command: string,
  timeoutMs = 120000
): Promise<{ exitCode: number; output: string }> {
  const cap = (s: string): string => s.slice(-8000)
  try {
    const { stdout, stderr } = await pexec('sh', ['-c', command], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    })
    return { exitCode: 0, output: cap(stdout + stderr) }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    const out = cap((e.stdout ?? '') + (e.stderr ?? '')) || e.message || ''
    return { exitCode: typeof e.code === 'number' ? e.code : 1, output: out }
  }
}

/** Diff of what `branch` added since it diverged from the repo's current HEAD. */
export async function diffBranch(repoDir: string, branch: string): Promise<{ diff: string; files: number }> {
  const { stdout: diff } = await pexec('git', ['-C', repoDir, 'diff', `HEAD...${branch}`])
  const { stdout: names } = await pexec('git', ['-C', repoDir, 'diff', '--name-only', `HEAD...${branch}`])
  const files = names
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean).length
  return { diff, files }
}

/**
 * Merge `branch` into the repo's current branch (fast-forward when possible,
 * a merge commit otherwise). On ANY failure (conflict, dirty tree, etc.) abort
 * so the repo is left exactly as it was, and report. Never throws on conflict.
 */
export async function mergeBranch(repoDir: string, branch: string): Promise<MergeOutcome> {
  try {
    await pexec('git', ['-C', repoDir, 'merge', '--no-edit', branch])
    return { ok: true, conflict: false, message: 'Merged.' }
  } catch (err) {
    // Distinguish a REAL conflict (a merge started, then hit conflicts → MERGE_HEAD
    // exists) from other failures (dirty tree, bad ref, detached HEAD) which the merge
    // refuses before starting. They need different user guidance.
    let conflict = false
    try {
      await pexec('git', ['-C', repoDir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'])
      conflict = true
    } catch {
      /* no merge in progress → not a conflict */
    }
    if (conflict) {
      try {
        await pexec('git', ['-C', repoDir, 'merge', '--abort'])
      } catch {
        /* best-effort — leave nothing half-merged */
      }
    }
    const e = err as { stderr?: string; message?: string }
    const message = conflict
      ? 'Merge conflict — aborted, repo left clean. Resolve manually.'
      : (e.stderr || e.message || 'merge failed').trim()
    return { ok: false, conflict, message }
  }
}
