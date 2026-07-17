import { v4 as uuid } from 'uuid'
import type { DB } from '../db/database'
import { buildSelect } from '../db/query'
import type { StandardCategory, StandardEntry } from '@shared/types'

export type { StandardCategory, StandardEntry }

interface StandardRow {
  id: string
  project_id: string | null
  category: StandardCategory
  rule: string
  detail: string | null
  status: string
  sort: number
  created_at: number
  updated_at: number
}

// Soft cap on how many standards get injected into a single worker's brief — they ride into every
// pane on every spawn, so an unbounded list would inflate the whole fleet's context. Curate, don't
// pile up (retire stale rules instead).
export const MAX_INJECTED = 40

const toEntry = (r: StandardRow): StandardEntry => ({
  id: r.id,
  projectId: r.project_id,
  category: r.category,
  rule: r.rule,
  detail: r.detail,
  status: r.status as StandardEntry['status'],
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/**
 * Render active standards as a rule-first markdown block for injection into a worker's brief.
 * Pure (no DB) so it's unit-testable regardless of the better-sqlite3 ABI: lead with the rule as a
 * bullet, indent any detail under it, cap the count. Returns '' when there's nothing to inject.
 */
export function renderStandards(entries: StandardEntry[], cap = MAX_INJECTED): string {
  const shown = entries.slice(0, cap)
  if (!shown.length) return ''
  return shown
    .map((s) => {
      const head = `- ${s.rule.trim()}`
      const detail = s.detail?.trim()
      return detail ? `${head}\n  ${detail.replace(/\n/g, '\n  ')}` : head
    })
    .join('\n')
}

/**
 * Curated, rule-first coding standards — "how we write code here". The leads and personal agent author them
 * (ask→draft→confirm) and they are injected into EVERY worker's brief before it writes code so a
 * multi-model fleet stays consistent. Global rows (project_id NULL) apply everywhere; project rows
 * scope to one project. Mirrors KnowledgeStore's better-sqlite3 patterns.
 */
export class StandardsStore {
  constructor(
    private db: DB,
    private now: () => number = () => Date.now()
  ) {}

  log(e: {
    projectId?: string | null
    category: StandardCategory
    rule: string
    detail?: string | null
    status?: 'active' | 'retired'
    sort?: number
  }): StandardEntry {
    const ts = this.now()
    const entry: StandardEntry = {
      id: uuid(),
      projectId: e.projectId ?? null,
      category: e.category,
      rule: e.rule,
      detail: e.detail ?? null,
      status: e.status ?? 'active',
      sort: e.sort ?? this.nextSort(e.projectId ?? null),
      createdAt: ts,
      updatedAt: ts
    }
    this.db
      .prepare(
        'INSERT INTO standards (id,project_id,category,rule,detail,status,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(
        entry.id,
        entry.projectId,
        entry.category,
        entry.rule,
        entry.detail,
        entry.status,
        entry.sort,
        entry.createdAt,
        entry.updatedAt
      )
    return entry
  }

  get(id: string): StandardEntry | null {
    const r = this.db.prepare('SELECT * FROM standards WHERE id=?').get(id) as StandardRow | undefined
    return r ? toEntry(r) : null
  }

  /** Patch rule/detail/category/sort or retire (status:'retired' drops it from injection). */
  update(
    id: string,
    patch: {
      rule?: string
      detail?: string | null
      category?: StandardCategory
      status?: 'active' | 'retired'
      sort?: number
    }
  ): StandardEntry | null {
    const cur = this.get(id)
    if (!cur) return null
    this.db
      .prepare('UPDATE standards SET rule=?, detail=?, category=?, status=?, sort=?, updated_at=? WHERE id=?')
      .run(
        patch.rule ?? cur.rule,
        patch.detail !== undefined ? patch.detail : cur.detail,
        patch.category ?? cur.category,
        patch.status ?? cur.status,
        patch.sort ?? cur.sort,
        this.now(),
        id
      )
    return this.get(id)
  }

  /**
   * Active standards that apply to a project: globals (project_id NULL) first, then this project's,
   * each ordered by sort. This is what gets injected. Uses `project_id IS ?` per codebase convention.
   */
  listActive(projectId?: string | null): StandardEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM standards WHERE status='active' AND (project_id IS ? OR project_id IS NULL) ORDER BY project_id IS NULL DESC, sort ASC, updated_at ASC"
      )
      .all(projectId ?? null) as StandardRow[]
    return rows.map(toEntry)
  }

  /** All standards (for curation views) — optionally scoped/filtered. */
  list(opts: { projectId?: string | null; status?: 'active' | 'retired' } = {}): StandardEntry[] {
    const { sql, args } = buildSelect(
      'standards',
      [
        opts.projectId !== undefined && { clause: 'project_id IS ?', arg: opts.projectId ?? null },
        opts.status ? { clause: 'status = ?', arg: opts.status } : null
      ],
      'project_id IS NULL DESC, sort ASC, updated_at ASC'
    )
    return (this.db.prepare(sql).all(...args) as StandardRow[]).map(toEntry)
  }

  /** Rule-first markdown for a worker's brief: globals + project's active standards, capped. */
  renderForProject(projectId?: string | null, cap = MAX_INJECTED): string {
    return renderStandards(this.listActive(projectId), cap)
  }

  private nextSort(projectId: string | null): number {
    const r = this.db
      .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM standards WHERE project_id IS ?')
      .get(projectId) as { m: number }
    return (r?.m ?? 0) + 1
  }
}
