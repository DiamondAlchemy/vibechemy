import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, lstatSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/database'
import { PresetRegistry } from '../presets/PresetRegistry'
import { SessionManager } from '../sessions/SessionManager'
import { PtyBridge } from '../sessions/PtyBridge'
import { addWorktree, currentRef, linkNodeModules } from '../sessions/worktree'
import { MergeService } from './MergeService'
import type { Preset } from '@shared/types'

const presets: Preset[] = [{ id: 'sleeper', name: 'Sleeper', command: 'sleep', args: ['120'], env: {} }]

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'mc-ms-repo-'))
  execFileSync('git', ['-C', repo, 'init', '-q'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
  writeFileSync(join(repo, 'a.txt'), 'base')
  execFileSync('git', ['-C', repo, 'add', '-A'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
  return repo
}

describe('MergeService', () => {
  it('returns ok:false for a non-isolated session', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mc-ms-db-')), 'x.sqlite'))
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run('plain', null, 'shell', 'mc_plain', '/tmp', 'Shell', 'running', 1, 1, null, null)
    const ms = new MergeService(
      mgr,
      new PtyBridge(
        () => {},
        () => {}
      )
    )
    expect((await ms.diff('plain')).ok).toBe(false)
    expect((await ms.merge('plain')).ok).toBe(false)
    db.close()
  })

  it('discard of a NON-isolated worker still kills it and reports ok (no false ghost)', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mc-ms-db3-')), 'z.sqlite'))
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run('plain2', null, 'shell', 'mc_plain2', '/tmp', 'Shell', 'running', 1, 1, null, null)
    let killed = ''
    const mgr2 = mgr as unknown as { kill: (id: string) => Promise<void> }
    const origKill = mgr2.kill.bind(mgr2)
    mgr2.kill = async (id: string): Promise<void> => {
      killed = id
      await origKill(id)
    }
    const ms = new MergeService(mgr, new PtyBridge(() => {}, () => {}))
    const r = await ms.discard('plain2')
    expect(r.ok).toBe(true) // truthfully closed
    expect(killed).toBe('plain2') // the pane was actually killed (was skipped before the fix)
    db.close()
  })

  it('discard of an unknown session is a no-op ok (already gone)', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mc-ms-db4-')), 'q.sqlite'))
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    const ms = new MergeService(mgr, new PtyBridge(() => {}, () => {}))
    expect(await ms.discard('ghost')).toEqual({ ok: true })
    db.close()
  })

  it('merges a worker branch into the origin repo and tears the worker down', async () => {
    const repo = makeRepo()
    const wt = join(tmpdir(), `mc-ms-wt-${process.pid}-${Date.now()}`)
    const base = await currentRef(repo)
    await addWorktree(repo, wt, 'vc/work-1', base)
    writeFileSync(join(wt, 'fix.txt'), 'the fix')
    execFileSync('git', ['-C', wt, 'add', '-A'])
    execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'fix'])

    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mc-ms-db2-')), 'y.sqlite'))
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    // Insert a worker row pointing at the worktree (tmux_name is fake — kill() no-ops when absent).
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run('w1', null, 'sleeper', 'mc_fake_w1', wt, 'Sleeper · vc/work-1', 'running', 1, 1, 'vc/work-1', repo)

    const ms = new MergeService(
      mgr,
      new PtyBridge(
        () => {},
        () => {}
      )
    )
    const res = await ms.merge('w1')

    expect(res.ok).toBe(true)
    expect(existsSync(join(repo, 'fix.txt'))).toBe(true) // merged into the origin repo
    expect(existsSync(wt)).toBe(false) // worktree removed
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'vc/work-1']).toString().trim()).toBe('') // branch pruned
    expect(mgr.get('w1')?.status).toBe('exited') // session torn down

    db.close()
    rmSync(repo, { recursive: true, force: true })
  })

  it('does not capture or leak the worktree node_modules symlink into the origin repo', async () => {
    const repo = makeRepo()
    // The repo has installed deps it ignores the standard way: a node_modules/ dir + a
    // dir-only gitignore rule. This is exactly what trips the bug — the rule matches the
    // directory but not a symlink of the same name.
    mkdirSync(join(repo, 'node_modules'))
    writeFileSync(join(repo, 'node_modules', 'dep.js'), 'module.exports = 1')
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add gitignore'])

    const wt = join(tmpdir(), `mc-ms-nmwt-${process.pid}-${Date.now()}`)
    const base = await currentRef(repo)
    await addWorktree(repo, wt, 'vc/nm-1', base)
    // The app links the repo's node_modules into the worktree as a symlink (the build convenience).
    await linkNodeModules(repo, wt)
    expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(true)
    // Real work the worker leaves UNCOMMITTED — so merge's capture step (git add -A) runs.
    writeFileSync(join(wt, 'fix.txt'), 'the real fix')

    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mc-ms-db3-')), 'z.sqlite'))
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run('w2', null, 'sleeper', 'mc_fake_w2', wt, 'Sleeper · vc/nm-1', 'running', 1, 1, 'vc/nm-1', repo)

    const ms = new MergeService(
      mgr,
      new PtyBridge(
        () => {},
        () => {}
      )
    )
    const res = await ms.merge('w2')

    expect(res.ok).toBe(true)
    expect(existsSync(join(repo, 'fix.txt'))).toBe(true) // the real work merged
    // The bug: the node_modules symlink slips past the dir-only ignore, gets swept into the
    // capture commit, and the merge leaks it into the origin repo (clobbering real deps).
    const tracked = execFileSync('git', ['-C', repo, 'ls-files']).toString()
    expect(tracked.split('\n')).not.toContain('node_modules')
    // The origin's node_modules must remain the real installed directory, untouched.
    expect(lstatSync(join(repo, 'node_modules')).isDirectory()).toBe(true)
    expect(existsSync(join(repo, 'node_modules', 'dep.js'))).toBe(true)

    db.close()
    rmSync(repo, { recursive: true, force: true })
  })
})
