import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, isAbsolute, resolve } from 'node:path'

const pexec = promisify(execFile)

export const EXCLUDE_HEADER = '# Vibechemy — keep local artifacts out of git'

// info/exclude is a single file shared by a repo's main checkout and all of its worktrees, so
// overlapping spawns (and the context projection + node_modules linking within one spawn) would
// otherwise read-modify-write it concurrently and clobber each other. Serialize every write —
// from every caller in this process — through one promise chain.
let writeChain: Promise<void> = Promise.resolve()

/**
 * Append `patterns` to the repo's shared `info/exclude` so they're ignored locally — without
 * touching the project's tracked `.gitignore`. `--git-common-dir` resolves the shared git dir
 * even from a linked worktree (works on git ≥ 2.5, unlike `--path-format`); a relative result is
 * resolved against `dir` because `-C` only changes git's cwd, not this process's. Idempotent
 * (skips patterns already present) and best-effort: a non-repo path or any git/fs error is
 * swallowed so a spawn never fails over ignore hygiene.
 */
export async function ensureExcluded(dir: string, patterns: string[]): Promise<void> {
  if (patterns.length === 0) return
  const run = writeChain.then(async () => {
    try {
      const { stdout } = await pexec('git', ['-C', dir, 'rev-parse', '--git-common-dir'])
      const raw = stdout.trim()
      if (!raw) return
      const gitDir = isAbsolute(raw) ? raw : resolve(dir, raw)
      const excludePath = join(gitDir, 'info', 'exclude')
      const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
      const have = new Set(current.split('\n').map((l) => l.trim()))
      const missing = patterns.filter((p) => !have.has(p))
      if (missing.length === 0) return
      const prefix = current.length && !current.endsWith('\n') ? '\n' : ''
      const headerLine = have.has(EXCLUDE_HEADER) ? '' : `${EXCLUDE_HEADER}\n`
      writeFileSync(excludePath, current + prefix + headerLine + missing.join('\n') + '\n')
    } catch {
      /* best-effort: never fail a spawn over ignore hygiene */
    }
  })
  writeChain = run.catch(() => {}) // keep the chain alive for the next caller
  return run
}
