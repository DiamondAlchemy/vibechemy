import { v4 as uuid } from 'uuid'
import type { DB } from '../db/database'
import type { Project } from '@shared/types'

type Clock = () => number

export class ProjectStore {
  constructor(
    private db: DB,
    private now: Clock = () => Date.now()
  ) {}

  createProject(name: string, rootPath: string): Project {
    const p: Project = { id: uuid(), name, rootPath, createdAt: this.now(), updatedAt: this.now() }
    this.db
      .prepare('INSERT INTO projects (id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(p.id, p.name, p.rootPath, p.createdAt, p.updatedAt)
    return p
  }

  listProjects(): Project[] {
    return this.db
      .prepare(
        'SELECT id,name,root_path as rootPath,created_at as createdAt,updated_at as updatedAt FROM projects ORDER BY created_at'
      )
      .all() as Project[]
  }

  getProject(id: string): Project | undefined {
    return this.db
      .prepare(
        'SELECT id,name,root_path as rootPath,created_at as createdAt,updated_at as updatedAt FROM projects WHERE id=?'
      )
      .get(id) as Project | undefined
  }

  /** Delete a workspace; callers must confirm before forcing deletion with running sessions. */
  deleteProject(id: string, opts: { force?: boolean } = {}): void {
    const tx = this.db.transaction((pid: string) => {
      if (!opts.force) {
        const { n } = this.db
          .prepare("SELECT COUNT(*) AS n FROM sessions WHERE project_id=? AND status='running'")
          .get(pid) as { n: number }
        if (n > 0)
          throw new Error(`Workspace has ${n} running agent${n === 1 ? '' : 's'} — close them first, or force-delete.`)
      }
      this.db.prepare('UPDATE sessions SET project_id=NULL WHERE project_id=?').run(pid)
      this.db.prepare('DELETE FROM projects WHERE id=?').run(pid)
    })
    tx(id)
  }
}
