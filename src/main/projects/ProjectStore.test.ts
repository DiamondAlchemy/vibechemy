import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type DB } from '../db/database'
import { ProjectStore } from './ProjectStore'

let db: DB
let store: ProjectStore

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new ProjectStore(db, () => 1000) // fixed clock
})

describe('ProjectStore', () => {
  it('creates and lists a project', () => {
    const p = store.createProject('Example Project', '/tmp/mc-test/example-project')
    expect(p.id).toBeTruthy()
    expect(p.name).toBe('Example Project')
    expect(p.createdAt).toBe(1000)
    expect(store.listProjects().map((x) => x.name)).toEqual(['Example Project'])
  })

  it('gets a project by id', () => {
    const p = store.createProject('Menu', '/tmp/mc-test/menu')
    expect(store.getProject(p.id)?.rootPath).toBe('/tmp/mc-test/menu')
    expect(store.getProject('nope')).toBeUndefined()
  })

  describe('deleteProject', () => {
    const insertSession = (projectId: string, status: 'running' | 'exited'): void => {
      db.prepare(
        'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(
        `s-${Math.random().toString(36).slice(2)}`,
        projectId,
        'claude-opus',
        `mc_t_${Math.random().toString(36).slice(2)}`,
        '/tmp',
        'T',
        status,
        1000,
        1000
      )
    }

    it('deletes a project with only exited sessions, orphaning them', () => {
      const p = store.createProject('Done', '/tmp/mc-test/done')
      insertSession(p.id, 'exited')
      store.deleteProject(p.id)
      expect(store.getProject(p.id)).toBeUndefined()
      const orphans = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE project_id IS NULL').get() as { n: number }
      expect(orphans.n).toBe(1)
    })

    it('refuses to delete a project with running sessions', () => {
      const p = store.createProject('Live', '/tmp/mc-test/live')
      insertSession(p.id, 'running')
      insertSession(p.id, 'running')
      expect(() => store.deleteProject(p.id)).toThrow(/2 running agents/)
      // nothing was touched: project still there, sessions still linked
      expect(store.getProject(p.id)?.name).toBe('Live')
      const linked = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE project_id=?').get(p.id) as { n: number }
      expect(linked.n).toBe(2)
    })

    it('force-deletes a project despite running sessions', () => {
      const p = store.createProject('Live', '/tmp/mc-test/live')
      insertSession(p.id, 'running')
      store.deleteProject(p.id, { force: true })
      expect(store.getProject(p.id)).toBeUndefined()
    })

    it('uses singular wording for one running agent', () => {
      const p = store.createProject('Solo', '/tmp/mc-test/solo')
      insertSession(p.id, 'running')
      expect(() => store.deleteProject(p.id)).toThrow(/1 running agent —/)
    })
  })
})
