import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from './MemoryStore'
import { ContextProvider } from '../context/ContextProvider'
import { BLOCK_BEGIN } from './projection'
import { pinSettingKey } from '@shared/pin'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const excludeOf = (repoDir: string): string => {
  const p = join(repoDir, '.git', 'info', 'exclude')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

let projectRoot: string
let globalDir: string
let provider: ContextProvider

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'mc-proj-'))
  globalDir = mkdtempSync(join(tmpdir(), 'mc-global-'))
  writeFileSync(join(projectRoot, 'README.md'), '# Demo\nA test project for memory projection.')
  writeFileSync(
    join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'demo', description: 'd', scripts: { dev: 'x' } })
  )
  provider = new ContextProvider(new MemoryStore(globalDir))
})

describe('ContextProvider projection (integration)', () => {
  it('seeds MEMORY.md and projects the brief into the CLI native file (project-scoped)', async () => {
    await provider.prepare('codex', projectRoot, 'proj-1')
    expect(existsSync(join(projectRoot, '.vibechemy', 'MEMORY.md'))).toBe(true)
    const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8')
    expect(agents).toContain(BLOCK_BEGIN)
    expect(agents).toContain('demo') // indexer pulled package.json/README
    expect(existsSync(join(globalDir, 'GLOBAL.md'))).toBe(true) // global created in injected dir, not real home
  })

  it('projects the workspace pin as the first line for a newly spawned agent', async () => {
    const settings = {
      get: (key: string): string | null => (key === pinSettingKey('proj-1') ? '  nobody touch\nauth.ts today  ' : null)
    }
    provider = new ContextProvider(new MemoryStore(globalDir), undefined, settings)

    await provider.prepare('codex', projectRoot, 'proj-1')

    const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8')
    const pinAt = agents.indexOf('PINNED: nobody touch auth.ts today')
    expect(pinAt).toBeGreaterThan(agents.indexOf(BLOCK_BEGIN))
    expect(pinAt).toBeLessThan(agents.indexOf('# Vibechemy — shared context'))
  })

  it('is a no-op for Scratch (no projectId) and for shells', async () => {
    await provider.prepare('codex', projectRoot, null) // scratch
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false)
    await provider.prepare('zsh', projectRoot, 'proj-1') // shell → no native file
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false)
  })

  it('preserves user content and is idempotent', async () => {
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Mine\nkeep this content around')
    await provider.prepare('claude', projectRoot, 'proj-1')
    const after1 = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')
    expect(after1).toContain('keep this content around')
    expect(after1).toContain(BLOCK_BEGIN)
    await provider.prepare('claude', projectRoot, 'proj-1')
    const after2 = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')
    expect(after2).toBe(after1) // idempotent
  })

  it('does not duplicate the project body back into the file it was seeded from', async () => {
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Project Bible\n' + 'Detailed project knowledge. '.repeat(5))
    await provider.prepare('claude', projectRoot, 'proj-1') // seed source = CLAUDE.md
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain(BLOCK_BEGIN)
    expect(claudeMd).not.toContain('## This project') // global-only block here, no project dup
    await provider.prepare('codex', projectRoot, 'proj-1') // a different agent gets the full brief
    const agentsMd = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('## This project')
    expect(agentsMd).toContain('Detailed project knowledge')
  })

  it('reads memory from the project root but projects into a separate spawnCwd (worktree)', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'mc-wt-'))
    await provider.prepare('codex', projectRoot, 'proj-1', worktree)
    // MEMORY.md created at the ROOT, not the worktree
    expect(existsSync(join(projectRoot, '.vibechemy', 'MEMORY.md'))).toBe(true)
    expect(existsSync(join(worktree, '.vibechemy', 'MEMORY.md'))).toBe(false)
    // brief projected INTO the worktree's AGENTS.md
    const agents = readFileSync(join(worktree, 'AGENTS.md'), 'utf8')
    expect(agents).toContain(BLOCK_BEGIN)
    expect(agents).toContain('demo')
  })

  it('projects shared learnings into every agent file, including the seed-source file', async () => {
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Bible\n' + 'rich knowledge. '.repeat(6))
    // seed memory + create LEARNINGS.md, then append a learning
    const ms = new MemoryStore(globalDir)
    ms.readProject(projectRoot) // creates .vibechemy/ + MEMORY.md + LEARNINGS.md stub
    writeFileSync(
      join(projectRoot, '.vibechemy', 'LEARNINGS.md'),
      '# Shared learnings\n\n- day 1: build script renamed to `npm run ship`'
    )

    await provider.prepare('claude', projectRoot, 'proj-1') // seed source → project body omitted, but learnings included
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).not.toContain('## This project')
    expect(claudeMd).toContain('npm run ship')

    await provider.prepare('codex', projectRoot, 'proj-1') // other agent → full brief + learnings
    const agentsMd = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('## This project')
    expect(agentsMd).toContain('npm run ship')
  })
})

describe('ContextProvider git hygiene (info/exclude)', () => {
  it('excludes artifact dirs in a real repo, idempotently, and never the context file', async () => {
    git(projectRoot, 'init', '-q')
    await provider.prepare('codex', projectRoot, 'proj-1')

    const ex1 = excludeOf(projectRoot)
    expect(ex1).toContain('.vibechemy/')
    expect(ex1).toContain('.playwright-mcp/')
    // The native context file must NEVER be excluded — a bare filename is anchorless and would
    // suppress the user's same-named files across the repo and every worktree.
    expect(ex1.split('\n').map((l) => l.trim())).not.toContain('AGENTS.md')
    // git actually honors the patterns
    expect(git(projectRoot, 'check-ignore', '.vibechemy/MEMORY.md').trim()).toBe('.vibechemy/MEMORY.md')

    // A second spawn (different agent) adds nothing — idempotent, no duplicate lines.
    await provider.prepare('claude', projectRoot, 'proj-1')
    expect(excludeOf(projectRoot)).toBe(ex1)
  })

  it('writes to the shared common-dir exclude when spawned in a linked worktree', async () => {
    git(projectRoot, 'init', '-q')
    git(projectRoot, 'config', 'user.email', 't@t.local')
    git(projectRoot, 'config', 'user.name', 'T')
    git(projectRoot, 'add', '-A')
    git(projectRoot, 'commit', '-qm', 'init')
    const wtPath = join(mkdtempSync(join(tmpdir(), 'mc-wt-')), 'wt') // must not pre-exist
    git(projectRoot, 'worktree', 'add', '-q', wtPath, 'HEAD')

    await provider.prepare('codex', projectRoot, 'proj-1', wtPath)

    // The exclude lands in the MAIN repo's shared info/exclude (worktrees share the common dir).
    expect(excludeOf(projectRoot)).toContain('.playwright-mcp/')
    // …and git, run from inside the worktree, honors it.
    expect(git(wtPath, 'check-ignore', '.playwright-mcp/x.log').trim()).toBe('.playwright-mcp/x.log')
  })
})
