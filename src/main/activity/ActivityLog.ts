import { v4 as uuid } from 'uuid'
import type { DB } from '../db/database'
import type { ActivityKind, ActivityEvent } from '@shared/types'

export type { ActivityKind, ActivityEvent }

export interface ActivityInput {
  projectId?: string | null
  kind: ActivityKind
  presetId?: string | null
  branch?: string | null
  summary: string
  meta?: Record<string, unknown>
}

interface ActivityRow {
  id: string
  ts: number
  project_id: string | null
  kind: ActivityKind
  preset_id: string | null
  branch: string | null
  summary: string
  meta_json: string | null
}

/**
 * Append-only ledger of what actually happened across Vibechemy — spawns, merges, and discards —
 * as they happen. The foundation the daily digest and personal-agent hand-off read from.
 * `record()` is BEST-EFFORT: logging an event must never throw or break the operation it describes.
 */
export class ActivityLog {
  constructor(
    private db: DB,
    private now: () => number = () => Date.now(),
    // Called after a successful record so the renderer's live activity strip can refresh.
    private onRecord: () => void = () => {}
  ) {}

  record(e: ActivityInput): void {
    try {
      this.db
        .prepare(
          'INSERT INTO activity (id,ts,project_id,kind,preset_id,branch,summary,meta_json) VALUES (?,?,?,?,?,?,?,?)'
        )
        .run(
          uuid(),
          this.now(),
          e.projectId ?? null,
          e.kind,
          e.presetId ?? null,
          e.branch ?? null,
          e.summary,
          e.meta ? JSON.stringify(e.meta) : null
        )
      this.onRecord()
    } catch (err) {
      console.error('[ActivityLog] record failed (ignored):', err)
    }
  }

  /** Events at/after `tsFrom`, newest first; pass `projectId` to scope to one project. */
  since(tsFrom: number, projectId?: string | null): ActivityEvent[] {
    const rows = (
      projectId === undefined
        ? this.db.prepare('SELECT * FROM activity WHERE ts >= ? ORDER BY ts DESC').all(tsFrom)
        : this.db
            .prepare('SELECT * FROM activity WHERE ts >= ? AND project_id IS ? ORDER BY ts DESC')
            .all(tsFrom, projectId ?? null)
    ) as ActivityRow[]
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      projectId: r.project_id,
      kind: r.kind,
      presetId: r.preset_id,
      branch: r.branch,
      summary: r.summary,
      meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : null
    }))
  }
}
