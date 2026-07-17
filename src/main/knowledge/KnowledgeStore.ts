import { v4 as uuid } from 'uuid'
import type { DB } from '../db/database'
import { buildSelect } from '../db/query'
import type { KnowledgeType, KnowledgeEntry } from '@shared/types'

export type { KnowledgeType, KnowledgeEntry }

interface KnowledgeRow {
  id: string
  project_id: string | null
  type: KnowledgeType
  title: string
  detail: string | null
  status: string
  branch: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
}

// Statuses that mean "done" — they stamp resolved_at (shipped feature / fixed bug).
const RESOLVED = new Set(['shipped', 'fixed'])

const toEntry = (r: KnowledgeRow): KnowledgeEntry => ({
  id: r.id,
  projectId: r.project_id,
  type: r.type,
  title: r.title,
  detail: r.detail,
  status: r.status,
  branch: r.branch,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at
})

/**
 * The curated project knowledge base — features and bugs, with status. The institutional memory
 * the leads write to at merge/ship time and the personal agent curates as overseer: "have we built X?",
 * "what bugs are still open?", "what shipped this week?". Distinct from the mechanical ActivityLog.
 */
export class KnowledgeStore {
  constructor(
    private db: DB,
    private now: () => number = () => Date.now()
  ) {}

  log(e: {
    projectId?: string | null
    type: KnowledgeType
    title: string
    detail?: string | null
    status?: string
    branch?: string | null
  }): KnowledgeEntry {
    const ts = this.now()
    const status = e.status ?? (e.type === 'bug' ? 'open' : 'shipped')
    const entry: KnowledgeEntry = {
      id: uuid(),
      projectId: e.projectId ?? null,
      type: e.type,
      title: e.title,
      detail: e.detail ?? null,
      status,
      branch: e.branch ?? null,
      createdAt: ts,
      updatedAt: ts,
      resolvedAt: RESOLVED.has(status) ? ts : null
    }
    this.db
      .prepare(
        'INSERT INTO knowledge (id,project_id,type,title,detail,status,branch,created_at,updated_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        entry.id,
        entry.projectId,
        entry.type,
        entry.title,
        entry.detail,
        entry.status,
        entry.branch,
        entry.createdAt,
        entry.updatedAt,
        entry.resolvedAt
      )
    return entry
  }

  get(id: string): KnowledgeEntry | null {
    const r = this.db.prepare('SELECT * FROM knowledge WHERE id=?').get(id) as KnowledgeRow | undefined
    return r ? toEntry(r) : null
  }

  /** Patch status/detail/title. Stamps resolved_at the first time it reaches shipped/fixed. */
  update(id: string, patch: { status?: string; detail?: string; title?: string }): KnowledgeEntry | null {
    const cur = this.get(id)
    if (!cur) return null
    const status = patch.status ?? cur.status
    const resolvedAt = RESOLVED.has(status) ? (cur.resolvedAt ?? this.now()) : null
    this.db
      .prepare('UPDATE knowledge SET status=?, detail=?, title=?, updated_at=?, resolved_at=? WHERE id=?')
      .run(status, patch.detail ?? cur.detail, patch.title ?? cur.title, this.now(), resolvedAt, id)
    return this.get(id)
  }

  /** Substring search over title + detail — "have we already built/fixed X?". */
  search(query: string, projectId?: string | null): KnowledgeEntry[] {
    const like = `%${query.trim()}%`
    const { sql, args } = buildSelect(
      'knowledge',
      [
        projectId !== undefined && { clause: 'project_id IS ?', arg: projectId ?? null },
        { clause: '(title LIKE ? OR detail LIKE ?)', arg: [like, like] }
      ],
      'updated_at DESC'
    )
    return (this.db.prepare(sql).all(...args) as KnowledgeRow[]).map(toEntry)
  }

  list(
    opts: { projectId?: string | null; type?: KnowledgeType; status?: string; since?: number } = {}
  ): KnowledgeEntry[] {
    const { sql, args } = buildSelect(
      'knowledge',
      [
        opts.projectId !== undefined && { clause: 'project_id IS ?', arg: opts.projectId ?? null },
        opts.type ? { clause: 'type = ?', arg: opts.type } : null,
        opts.status ? { clause: 'status = ?', arg: opts.status } : null,
        opts.since !== undefined && { clause: 'updated_at >= ?', arg: opts.since }
      ],
      'updated_at DESC'
    )
    return (this.db.prepare(sql).all(...args) as KnowledgeRow[]).map(toEntry)
  }
}
