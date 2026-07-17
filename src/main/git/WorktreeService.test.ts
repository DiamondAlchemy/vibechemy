import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/database'
import { PresetRegistry } from '../presets/PresetRegistry'
import { SessionManager } from '../sessions/SessionManager'
import { ProjectStore } from '../projects/ProjectStore'
import { addWorktree, currentRef } from '../sessions/worktree'
import { WorktreeService } from './WorktreeService'
import type { Preset } from '@shared/types'

const presets: Preset[] = [{ id: 'sleeper', name: 'Sleeper', command: 'sleep', args: ['120'], env: {} }]
const INSERT_SESSION =
  'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'mc-wts-repo-'))
  execFileSync('git', ['-C', repo, 'init', '-q'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
  writeFileSync(join(repo, 'a.txt'), 'base')
  execFileSync('git', ['-C', repo, 'add', '-A'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
  return repo
}

function setup(): {
  repo: string
  db: ReturnType<typeof openDatabase>
  svc: WorktreeService
} {
  const repo = makeRepo()
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mc-wts-db-')), 'x.sqlite'))
  db.prepare('INSERT INTO projects (id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)').run(
    'p1',
    'P One',
    repo,
    1,
    1
  )
  const sessions = new SessionManager(db, PresetRegistry.from(presets))
  const svc = new WorktreeService(new ProjectStore(db), sessions)
  return { repo, db, svc }
}

const wtPath = (tag: string): string => join(tmpdir(), `mc-wts-${tag}-${process.pid}-${Date.now()}`)

describe('WorktreeService', () => {
  it('lists Vibechemy worktrees with dirty + in-use status and ignores the main checkout', async () => {
    const { repo, db, svc } = setup()
    const base = await currentRef(repo)
    const clean = wtPath('clean')
    const dirty = wtPath('dirty')
    const live = wtPath('live')
    await addWorktree(repo, clean, 'vc/clean-1', base)
    await addWorktree(repo, dirty, 'vc/dirty-1', base)
    await addWorktree(repo, live, 'vc/live-1', base)
    writeFileSync(join(dirty, 'wip.txt'), 'uncommitted')
    db.prepare(INSERT_SESSION).run(
      's1',
      'p1',
      'sleeper',
      'mc_s1',
      live,
      'Sleeper · vc/live-1',
      'running',
      1,
      1,
      'vc/live-1',
      repo
    )

    const entries = await svc.list()
    const byBranch = Object.fromEntries(entries.map((e) => [e.branch, e]))

    // The main checkout (on its default branch, not vc/*) must NOT appear.
    expect(Object.keys(byBranch).sort()).toEqual(['vc/clean-1', 'vc/dirty-1', 'vc/live-1'])
    expect(byBranch['vc/clean-1'].dirty).toBe(false)
    expect(byBranch['vc/clean-1'].inUse).toBe(false)
    expect(byBranch['vc/dirty-1'].dirty).toBe(true)
    expect(byBranch['vc/live-1'].inUse).toBe(true)
    expect(entries.every((e) => e.projectId === 'p1' && e.projectName === 'P One')).toBe(true)

    db.close()
    rmSync(repo, { recursive: true, force: true })
  })

  it('removes a clean worktree and prunes its branch', async () => {
    const { repo, db, svc } = setup()
    const base = await currentRef(repo)
    const clean = wtPath('rm')
    await addWorktree(repo, clean, 'vc/rm-1', base)

    const r = await svc.remove(clean)
    expect(r.ok).toBe(true)
    expect(existsSync(clean)).toBe(false)
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'vc/rm-1']).toString().trim()).toBe('')

    db.close()
    rmSync(repo, { recursive: true, force: true })
  })

  it('refuses to remove a dirty worktree unless forced', async () => {
    const { repo, db, svc } = setup()
    const base = await currentRef(repo)
    const dirty = wtPath('rmd')
    await addWorktree(repo, dirty, 'vc/rmd-1', base)
    writeFileSync(join(dirty, 'wip.txt'), 'x')

    const blocked = await svc.remove(dirty)
    expect(blocked.ok).toBe(false)
    expect(existsSync(dirty)).toBe(true)

    const forced = await svc.remove(dirty, { force: true })
    expect(forced.ok).toBe(true)
    expect(existsSync(dirty)).toBe(false)

    db.close()
    rmSync(repo, { recursive: true, force: true })
  })

  it('refuses to remove a worktree a live session is using', async () => {
    const { repo, db, svc } = setup()
    const base = await currentRef(repo)
    const live = wtPath('rml')
    await addWorktree(repo, live, 'vc/rml-1', base)
    // a running session occupies the worktree → removal must be blocked
    db.prepare(INSERT_SESSION).run(
      's1',
      'p1',
      'sleeper',
      'mc_s1',
      live,
      'Sleeper · mc/rml-1',
      'running',
      1,
      1,
      'vc/rml-1',
      repo
    )

    const r = await svc.remove(live)
    expect(r.ok).toBe(false)
    expect(existsSync(live)).toBe(true)

    db.close()
    rmSync(repo, { recursive: true, force: true })
  })
})
