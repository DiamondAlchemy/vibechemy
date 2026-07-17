import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database'

describe('openDatabase migration', () => {
  it('adds branch + origin_root to an old sessions table and reads existing rows as null', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mc-db-')), 'old.sqlite')
    // Simulate a pre-migration DB: sessions table WITHOUT the new columns.
    const old = new Database(file)
    old.exec(
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, preset_id TEXT NOT NULL,
       tmux_name TEXT NOT NULL UNIQUE, cwd TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
       created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`
    )
    old
      .prepare(
        'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run('s1', null, 'shell', 'mc_old_1', '/tmp', 'Shell', 'running', 1, 1)
    old.close()

    const db = openDatabase(file)
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    expect(cols.some((c) => c.name === 'branch')).toBe(true)
    expect(cols.some((c) => c.name === 'origin_root')).toBe(true)
    const row = db.prepare('SELECT branch, origin_root FROM sessions WHERE id=?').get('s1') as {
      branch: string | null
      origin_root: string | null
    }
    expect(row.branch).toBeNull()
    expect(row.origin_root).toBeNull()
    db.close()

    // Idempotent: opening again must not error or duplicate the column.
    const db2 = openDatabase(file)
    const cols2 = db2.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    expect(cols2.filter((c) => c.name === 'branch').length).toBe(1)
    db2.close()
  })

  it('adds task + owner + task_state to an old sessions table and reads existing rows as null', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mc-db-dash-')), 'old.sqlite')
    const old = new Database(file)
    old.exec(
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, preset_id TEXT NOT NULL,
       tmux_name TEXT NOT NULL UNIQUE, cwd TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
       created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`
    )
    old
      .prepare(
        'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run('s1', null, 'shell', 'mc_dash_old_1', '/tmp', 'Shell', 'running', 1, 1)
    old.close()

    const db = openDatabase(file)
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    expect(cols.some((c) => c.name === 'task')).toBe(true)
    expect(cols.some((c) => c.name === 'owner')).toBe(true)
    expect(cols.some((c) => c.name === 'task_state')).toBe(true)
    const row = db.prepare('SELECT task, owner, task_state FROM sessions WHERE id=?').get('s1') as {
      task: string | null
      owner: string | null
      task_state: string | null
    }
    expect(row.task).toBeNull()
    expect(row.owner).toBeNull()
    expect(row.task_state).toBeNull()
    db.close()
  })
})
