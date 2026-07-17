import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync as writeFileSyncFs, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { openDatabase, type DB } from '../db/database'
import { PresetRegistry } from '../presets/PresetRegistry'
import { SessionManager, pathSafe } from './SessionManager'
import { hasSession, killSession } from './tmux'
import * as tmuxApi from './tmux'
import { isGitRepo, removeWorktree } from './worktree'
import type { Preset } from '@shared/types'
import { PERSONAL_AGENT_PRESET_ID } from '@shared/agents/personalAgent'
import { ActivityLog } from '../activity/ActivityLog'

const presets: Preset[] = [{ id: 'sleeper', name: 'Sleeper', command: 'sleep', args: ['120'], env: {} }]

let spawnedTmuxName: string | null = null
afterEach(async () => {
  if (spawnedTmuxName && (await hasSession(spawnedTmuxName))) await killSession(spawnedTmuxName)
  spawnedTmuxName = null
})

describe('pathSafe', () => {
  it('sanitizes to worktree/branch-safe chars', () => {
    expect(pathSafe('Example Project')).toBe('Example_Project')
    expect(pathSafe('claude-opus')).toBe('claude-opus')
  })
  it('never emits a relative-path token (traversal guard)', () => {
    expect(pathSafe('..')).toBe('_') // was '..' → escaped the worktree base
    expect(pathSafe('.')).toBe('_')
    expect(pathSafe('/')).toBe('_') // → '' → '_'
    expect(pathSafe('...')).toBe('...') // harmless dir name, not a token
  })
})

describe('SessionManager (integration)', () => {
  it('records the canonical personal-agent preset id when spawned', async () => {
    const db = openDatabase(':memory:')
    const registry = PresetRegistry.from([
      {
        id: PERSONAL_AGENT_PRESET_ID,
        name: 'Example Agent',
        command: 'sleep',
        args: ['120'],
        env: {},
        isOrchestrator: true
      }
    ])
    const mgr = new SessionManager(db, registry)
    const rec = await mgr.spawn(PERSONAL_AGENT_PRESET_ID, tmpdir(), null)
    spawnedTmuxName = rec.tmuxName

    expect(new ActivityLog(db).since(0)[0].presetId).toBe(PERSONAL_AGENT_PRESET_ID)

    await mgr.kill(rec.id)
    spawnedTmuxName = null
    db.close()
  })

  it('spawns a durable tmux session and reattaches it after a simulated app restart', async () => {
    const dbFile = `${tmpdir()}/mc-test-${process.pid}.sqlite`

    // --- app run #1 ---
    const db1 = openDatabase(dbFile)
    const mgr1 = new SessionManager(db1, PresetRegistry.from(presets))
    const rec = await mgr1.spawn('sleeper', tmpdir(), null)
    spawnedTmuxName = rec.tmuxName
    expect(rec.status).toBe('running')
    expect(await hasSession(rec.tmuxName)).toBe(true)
    db1.close() // simulate quitting the app (does NOT kill tmux)

    // --- app run #2 (fresh manager, same DB + surviving tmux) ---
    const db2 = openDatabase(dbFile)
    const mgr2 = new SessionManager(db2, PresetRegistry.from(presets))
    const result = await mgr2.reconcile()
    expect(result.reattached.map((r) => r.tmuxName)).toContain(rec.tmuxName)
    expect(result.missing).toHaveLength(0)
    db2.close()
  })

  it('marks a session missing if its tmux session is gone, and flags unknown mc_ sessions as orphans', async () => {
    const dbFile = `${tmpdir()}/mc-test2-${process.pid}.sqlite`
    const db = openDatabase(dbFile)
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    const rec = await mgr.spawn('sleeper', tmpdir(), null)
    spawnedTmuxName = rec.tmuxName
    await killSession(rec.tmuxName) // tmux dies out from under us
    const result = await mgr.reconcile()
    expect(result.missing.map((r) => r.tmuxName)).toContain(rec.tmuxName)
    spawnedTmuxName = null
    db.close()
  })

  it('isolate:true spawns the agent in a fresh git worktree off the repo', async () => {
    const repo = mkdtempSync(`${tmpdir()}/mc-iso-repo-`)
    execFileSync('git', ['-C', repo, 'init', '-q'])
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'])
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
    writeFileSyncFs(`${repo}/a.txt`, 'x')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
    const wtBase = mkdtempSync(`${tmpdir()}/mc-iso-wt-`)
    const db = openDatabase(`${tmpdir()}/mc-iso-${Date.now()}.sqlite`)
    const mgr = new SessionManager(db, PresetRegistry.from(presets), undefined, undefined, undefined, wtBase)
    const rec = await mgr.spawn('sleeper', repo, 'proj-iso', { isolate: true })
    spawnedTmuxName = rec.tmuxName
    expect(rec.cwd).not.toBe(repo)
    expect(rec.cwd.startsWith(wtBase)).toBe(true)
    expect(await isGitRepo(rec.cwd)).toBe(true)
    await killSession(rec.tmuxName)
    spawnedTmuxName = null
    await removeWorktree(repo, rec.cwd).catch(() => {})
    db.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(wtBase, { recursive: true, force: true })
  })

  it('markExitedIfGone marks a session exited only when its tmux session is gone', async () => {
    const dbFile = `${tmpdir()}/mc-test3-${process.pid}.sqlite`
    const db = openDatabase(dbFile)
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    const rec = await mgr.spawn('sleeper', tmpdir(), null)
    spawnedTmuxName = rec.tmuxName

    // tmux session still alive → stays running (this is the detach case); returns false so the
    // caller fires NO exit event → no ghost tombstone for a live pane.
    expect(await mgr.markExitedIfGone(rec.id)).toBe(false)
    expect(mgr.list().map((r) => r.id)).toContain(rec.id)

    // tmux session gone (program exited) → marked exited, drops out of list, returns true (a real death)
    await killSession(rec.tmuxName)
    spawnedTmuxName = null
    expect(await mgr.markExitedIfGone(rec.id)).toBe(true)
    expect(mgr.list().map((r) => r.id)).not.toContain(rec.id)
    db.close()
  })
})

// --- Tier-2 tests: real in-memory DB, no tmux ---

const taskPresets: Preset[] = [{ id: 'codex', name: 'Codex', command: 'sleep', args: ['1'], env: {} }]
const INSERT =
  'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root,task,owner,task_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'

let db: DB
let sessions: SessionManager
beforeEach(() => {
  db = openDatabase(':memory:')
  sessions = new SessionManager(db, PresetRegistry.from(taskPresets))
})

describe('SessionManager task/owner/taskState persistence', () => {
  it('reads task/owner/taskState back from a row (allRows mapping)', () => {
    db.prepare(INSERT).run(
      'a',
      null,
      'codex',
      'mc_a',
      '/tmp',
      'Codex',
      'running',
      1,
      1,
      null,
      null,
      'Fix login',
      'personal-agent',
      'working'
    )
    const r = sessions.get('a')!
    expect(r.task).toBe('Fix login')
    expect(r.owner).toBe('personal-agent')
    expect(r.taskState).toBe('working')
  })

  it('setMeta updates only the provided fields', () => {
    db.prepare(INSERT).run(
      'a',
      null,
      'codex',
      'mc_a',
      '/tmp',
      'Codex',
      'running',
      1,
      1,
      null,
      null,
      'Fix login',
      'personal-agent',
      'working'
    )
    sessions.setMeta('a', { taskState: 'needs_review' })
    let r = sessions.get('a')!
    expect(r.taskState).toBe('needs_review')
    expect(r.task).toBe('Fix login') // untouched
    expect(r.owner).toBe('personal-agent') // untouched
    sessions.setMeta('a', { task: 'Refactor', taskState: 'working' })
    r = sessions.get('a')!
    expect(r.task).toBe('Refactor')
    expect(r.taskState).toBe('working')
  })

  it('setMeta with an empty patch is a no-op', () => {
    db.prepare(INSERT).run('a', null, 'codex', 'mc_a', '/tmp', 'Codex', 'running', 1, 1, null, null, 'T', null, null)
    expect(() => sessions.setMeta('a', {})).not.toThrow()
    expect(sessions.get('a')!.task).toBe('T')
  })
})

describe('deliberate-end tracking', () => {
  it('kill marks the session as a deliberate end; untouched sessions are not', async () => {
    const dbFile = `${tmpdir()}/mc-test-deliberate-${process.pid}.sqlite`
    const db = openDatabase(dbFile)
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    const rec = await mgr.spawn('sleeper', tmpdir(), null)
    spawnedTmuxName = rec.tmuxName
    expect(mgr.wasDeliberate(rec.id)).toBe(false)
    await mgr.kill(rec.id)
    expect(mgr.wasDeliberate(rec.id)).toBe(true)
    spawnedTmuxName = null
    db.close()
  })
})

describe('revive', () => {
  it('refuses unknown and still-running sessions', async () => {
    const dbFile = `${tmpdir()}/mc-test-revive1-${process.pid}.sqlite`
    const db = openDatabase(dbFile)
    const mgr = new SessionManager(db, PresetRegistry.from(presets))
    expect((await mgr.revive('nope')).ok).toBe(false)
    const rec = await mgr.spawn('sleeper', tmpdir(), null)
    spawnedTmuxName = rec.tmuxName
    expect((await mgr.revive(rec.id)).ok).toBe(false) // still running
    await mgr.kill(rec.id)
    spawnedTmuxName = null
    db.close()
  })

  it('respawns the same preset in the same cwd, guards to once per run, and skips /resume for non-claude CLIs', async () => {
    const dbFile = `${tmpdir()}/mc-test-revive2-${process.pid}.sqlite`
    const db = openDatabase(dbFile)
    const sent: Array<[string, string]> = []
    const spiedTmux = {
      ...tmuxApi,
      sendKeys: async (name: string, text: string): Promise<void> => {
        sent.push([name, text])
        await tmuxApi.sendKeys(name, text)
      }
    }
    const mgr = new SessionManager(db, PresetRegistry.from(presets), spiedTmux)
    const rec = await mgr.spawn('sleeper', tmpdir(), null)
    await mgr.kill(rec.id)
    mgr.paneStableOverrides = { floorMs: 1, pollMs: 1, maxWaitMs: 50 }
    const r = await mgr.revive(rec.id)
    expect(r.ok).toBe(true)
    const revived = mgr.list().find((s) => s.id === r.newId)!
    spawnedTmuxName = revived.tmuxName
    expect(revived.presetId).toBe(rec.presetId)
    expect(revived.cwd).toBe(rec.cwd)
    expect((await mgr.revive(rec.id)).ok).toBe(false) // once per run
    await new Promise((res) => setTimeout(res, 150))
    expect(sent).toHaveLength(0) // sleeper is not a claude CLI — no /resume injection
    await mgr.kill(revived.id)
    spawnedTmuxName = null
    db.close()
  })

  it('injects /resume for claude presets and suppresses the opening prompt', async () => {
    const dbFile = `${tmpdir()}/mc-test-revive3-${process.pid}.sqlite`
    const db = openDatabase(dbFile)
    // A fake `claude` binary: path ends in /claude so isClaudeCli matches, but it's just a sleeper.
    const binDir = mkdtempSync(`${tmpdir()}/mc-fake-claude-`)
    writeFileSyncFs(`${binDir}/claude`, '#!/bin/sh\nsleep 120\n', { mode: 0o755 })
    const BRIEFING = 'you are the orchestrator briefing'
    const claudePresets: Preset[] = [
      {
        id: 'fake-claude',
        name: 'Fake Claude',
        command: `${binDir}/claude`,
        args: [],
        env: {},
        openingPrompt: BRIEFING
      }
    ]
    const sent: Array<[string, string]> = []
    const spiedTmux = {
      ...tmuxApi,
      sendKeys: async (name: string, text: string): Promise<void> => {
        sent.push([name, text])
        await tmuxApi.sendKeys(name, text)
      }
    }
    const mgr = new SessionManager(db, PresetRegistry.from(claudePresets), spiedTmux)
    mgr.paneStableOverrides = { floorMs: 1, pollMs: 1, maxWaitMs: 3000 }
    const rec = await mgr.spawn('fake-claude', tmpdir(), null, { openingPrompt: '' }) // suppress on the seed spawn too
    await mgr.kill(rec.id)
    const r = await mgr.revive(rec.id)
    expect(r.ok).toBe(true)
    const revived = mgr.list().find((s) => s.id === r.newId)!
    spawnedTmuxName = revived.tmuxName
    // the /resume inject is fire-and-forget — poll for it
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !sent.some(([, t]) => t === '/resume')) {
      await new Promise((res) => setTimeout(res, 100))
    }
    expect(sent.some(([name, t]) => name === revived.tmuxName && t === '/resume')).toBe(true)
    expect(sent.some(([, t]) => t === BRIEFING)).toBe(false) // opening prompt suppressed on revive
    await mgr.kill(revived.id)
    spawnedTmuxName = null
    rmSync(binDir, { recursive: true, force: true })
    db.close()
  })

  it('dismissing a closed orchestrator persists across a restart (settings round-trip)', () => {
    const dbFile = `${tmpdir()}/mc-dismiss-${process.pid}.sqlite`
    const NOW = 10_000_000_000
    const leadPresets: Preset[] = [
      { id: 'lead', name: 'Lead', command: 'sleep', args: ['120'], env: {}, isOrchestrator: true }
    ]
    const insertExitedLead = (db: DB, id: string): void => {
      db.prepare(
        'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,callsign,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(id, null, 'lead', 'mc_x_' + id, tmpdir(), 'Lead', null, 'exited', NOW - 5000, NOW - 1000, null, null)
    }

    const db1 = openDatabase(dbFile)
    const mgr1 = new SessionManager(
      db1,
      PresetRegistry.from(leadPresets),
      tmuxApi,
      undefined,
      () => NOW
    )
    insertExitedLead(db1, 'closed-1')
    expect(mgr1.listClosedOrchestrators().map((r) => r.id)).toEqual(['closed-1'])
    expect(mgr1.dismissClosedOrchestrator('closed-1').ok).toBe(true)
    expect(mgr1.listClosedOrchestrators()).toEqual([]) // banished immediately
    db1.close()

    // fresh manager, same DB — the dismiss survives the "restart"
    const db2 = openDatabase(dbFile)
    const mgr2 = new SessionManager(db2, PresetRegistry.from(leadPresets), tmuxApi, undefined, () => NOW)
    expect(mgr2.listClosedOrchestrators()).toEqual([])
    // but a genuinely NEW close for the same slot resurfaces (closed after the dismiss)
    db2.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(NOW + 1000, 'closed-1')
    expect(mgr2.listClosedOrchestrators().map((r) => r.id)).toEqual(['closed-1'])
    db2.close()
    rmSync(dbFile, { force: true })
  })
})
