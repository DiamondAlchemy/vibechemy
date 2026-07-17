import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, lstatSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isGitRepo,
  currentRef,
  addWorktree,
  listWorktrees,
  removeWorktree,
  linkNodeModules,
  pruneBranch,
  currentBranch,
  diffBranch,
  mergeBranch,
  runInWorktree,
  isWorktreeDirty
} from './worktree'
import { mergeManagedBlock } from '../memory/projection'

let repo: string
let nonRepo: string
let wt: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mc-repo-'))
  execFileSync('git', ['-C', repo, 'init', '-q'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
  writeFileSync(join(repo, 'a.txt'), 'hi')
  execFileSync('git', ['-C', repo, 'add', '-A'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
  nonRepo = mkdtempSync(join(tmpdir(), 'mc-nonrepo-'))
  wt = join(tmpdir(), `mc-wt-${process.pid}-${Date.now()}`)
})
afterEach(() => {
  for (const d of [repo, nonRepo, wt]) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('worktree helpers (integration, real git)', () => {
  it('detects a git repo vs a non-repo', async () => {
    expect(await isGitRepo(repo)).toBe(true)
    expect(await isGitRepo(nonRepo)).toBe(false)
  })

  it('returns the current commit SHA', async () => {
    const ref = await currentRef(repo)
    expect(ref).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('creates, lists, and removes a worktree on a new branch', async () => {
    const base = await currentRef(repo)
    await addWorktree(repo, wt, 'vc/test-1', base)
    expect(existsSync(join(wt, 'a.txt'))).toBe(true) // worktree is a real checkout
    const list = await listWorktrees(repo)
    expect(list.some((w) => w.path === wt && w.branch === 'vc/test-1')).toBe(true)
    await removeWorktree(repo, wt)
    expect(existsSync(wt)).toBe(false)
  })

  it('self-heals an ORPHANED worktree: removes the dir even when git no longer registers it', async () => {
    const base = await currentRef(repo)
    await addWorktree(repo, wt, 'vc/orphan-1', base)
    expect(existsSync(wt)).toBe(true)
    // Orphan it exactly like the discard-refusal bug: delete git's worktree admin
    // entry so the dir survives on disk but `git worktree remove` refuses ("not a working
    // tree"). Sanity-check that git really does refuse before asserting the self-heal.
    const admin = readdirSync(join(repo, '.git', 'worktrees'))
    expect(admin.length).toBe(1)
    rmSync(join(repo, '.git', 'worktrees', admin[0]), { recursive: true, force: true })
    expect(() => execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt])).toThrow()
    // The fallback (prune + direct rm) must still clear the directory, without throwing.
    await removeWorktree(repo, wt)
    expect(existsSync(wt)).toBe(false)
  })
})

describe('linkNodeModules', () => {
  it('symlinks the repo node_modules into a worktree that lacks one', async () => {
    mkdirSync(join(repo, 'node_modules'))
    writeFileSync(join(repo, 'node_modules', 'marker.txt'), 'dep')
    const base = await currentRef(repo)
    await addWorktree(repo, wt, 'vc/nm-1', base)
    await linkNodeModules(repo, wt)
    expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(wt, 'node_modules', 'marker.txt'))).toBe(true)
  })

  it('is a no-op when the repo has no node_modules (does not throw)', async () => {
    const base = await currentRef(repo)
    await addWorktree(repo, wt, 'vc/nm-2', base)
    await linkNodeModules(repo, wt) // must not throw
    expect(existsSync(join(wt, 'node_modules'))).toBe(false)
  })
})

describe('pruneBranch + currentBranch', () => {
  it('reports the current branch and force-deletes another branch', async () => {
    const cur = await currentBranch(repo)
    expect(cur).toMatch(/\w+/) // e.g. main/master
    const base = await currentRef(repo)
    // create an unmerged branch via a worktree, then remove the worktree and prune the branch
    await addWorktree(repo, wt, 'vc/del-1', base)
    writeFileSync(join(wt, 'b.txt'), 'x')
    execFileSync('git', ['-C', wt, 'add', '-A'])
    execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'on branch'])
    await removeWorktree(repo, wt)
    await pruneBranch(repo, 'vc/del-1') // must not throw even though unmerged
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'vc/del-1']).toString().trim()
    expect(branches).toBe('')
  })
})

describe('diffBranch + mergeBranch', () => {
  async function branchWithCommit(branch: string, file: string, content: string): Promise<void> {
    const base = await currentRef(repo)
    await addWorktree(repo, wt, branch, base)
    writeFileSync(join(wt, file), content)
    execFileSync('git', ['-C', wt, 'add', '-A'])
    execFileSync('git', ['-C', wt, 'commit', '-q', '-m', `add ${file}`])
  }

  it('diffBranch reports what the branch added since divergence', async () => {
    await branchWithCommit('vc/d-1', 'new.txt', 'hello')
    const { diff, files } = await diffBranch(repo, 'vc/d-1')
    expect(diff).toContain('new.txt')
    expect(diff).toContain('hello')
    expect(files).toBe(1)
  })

  it('fast-forward merge succeeds and brings the branch commit into the repo', async () => {
    await branchWithCommit('vc/ff-1', 'ff.txt', 'data')
    const out = await mergeBranch(repo, 'vc/ff-1')
    expect(out.ok).toBe(true)
    expect(out.conflict).toBe(false)
    expect(existsSync(join(repo, 'ff.txt'))).toBe(true)
  })

  it('divergent non-conflicting merge creates a merge commit', async () => {
    await branchWithCommit('vc/dv-1', 'branchfile.txt', 'b')
    // advance the repo's own branch on a DIFFERENT file → divergence, no conflict
    writeFileSync(join(repo, 'mainfile.txt'), 'm')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'main moves'])
    const out = await mergeBranch(repo, 'vc/dv-1')
    expect(out.ok).toBe(true)
    expect(existsSync(join(repo, 'branchfile.txt'))).toBe(true)
    expect(existsSync(join(repo, 'mainfile.txt'))).toBe(true)
  })

  it('a non-conflict failure (dirty working tree) is reported as conflict:false', async () => {
    await branchWithCommit('vc/dirty-1', 'a.txt', 'from-branch') // branch edits a tracked file
    writeFileSync(join(repo, 'a.txt'), 'uncommitted local change') // make repo's tree dirty on that file
    const out = await mergeBranch(repo, 'vc/dirty-1')
    expect(out.ok).toBe(false)
    expect(out.conflict).toBe(false) // refused before a merge started → not a conflict
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  })

  it('conflicting merge aborts cleanly and leaves the repo with no in-progress merge', async () => {
    await branchWithCommit('vc/cf-1', 'a.txt', 'from-branch') // a.txt already exists at base
    // edit the same file on the repo's branch → conflict
    writeFileSync(join(repo, 'a.txt'), 'from-main')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'main edits a'])
    const out = await mergeBranch(repo, 'vc/cf-1')
    expect(out.ok).toBe(false)
    expect(out.conflict).toBe(true)
    // repo is clean: no in-progress merge, no conflict markers
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain']).toString().trim()
    expect(status).toBe('')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  })
})

describe('runInWorktree', () => {
  it('returns exit 0 and captures output for a successful command', async () => {
    const { exitCode, output } = await runInWorktree(repo, 'echo HELLO_CHECK')
    expect(exitCode).toBe(0)
    expect(output).toContain('HELLO_CHECK')
  })

  it('returns the nonzero exit code and output for a failing command (no throw)', async () => {
    const { exitCode, output } = await runInWorktree(repo, 'echo OOPS >&2; exit 7')
    expect(exitCode).toBe(7)
    expect(output).toContain('OOPS')
  })
})

describe('isWorktreeDirty — managed context block', () => {
  it('is CLEAN when the only change is the app projecting its block into a TRACKED context file', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# My real project notes\n')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add claude'])
    // The app projects its managed block into a previously clean tracked file:
    const projected = mergeManagedBlock('# My real project notes\n', 'auto-generated brief for the agent')
    writeFileSync(join(repo, 'CLAUDE.md'), projected)
    expect(await isWorktreeDirty(repo)).toBe(false)
  })
  it('is CLEAN when the app creates a fresh UNTRACKED context file that is only the block', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), mergeManagedBlock('', 'brief'))
    expect(await isWorktreeDirty(repo)).toBe(false)
  })
  it('is DIRTY when the agent edits real content in the context file', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), mergeManagedBlock('# notes\n', 'brief'))
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'x'])
    writeFileSync(join(repo, 'CLAUDE.md'), mergeManagedBlock('# notes\nAGENT ADDED THIS\n', 'brief'))
    expect(await isWorktreeDirty(repo)).toBe(true)
  })
  it('is DIRTY when any non-context file changed (real work)', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), mergeManagedBlock('', 'brief'))
    writeFileSync(join(repo, 'src.js'), 'real work')
    expect(await isWorktreeDirty(repo)).toBe(true)
  })
})
