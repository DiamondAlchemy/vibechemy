import type { SessionRecord } from '../types'

/** One workspace that currently holds running worker sessions you can't see from here. */
export interface WorkerGroup {
  /** projectId of the workspace (null = Scratch). */
  projectId: string | null
  /** Display label — the resolved workspace name, or 'Scratch' for the null project. */
  label: string
  /** How many ALIVE worker sessions live in that workspace. */
  count: number
}

export interface WorkersElsewhereInput {
  /** The cockpit's current workspace; sessions here are NOT "elsewhere" and are excluded. */
  currentProjectId: string | null
  /** Preset ids that mark a session as an orchestrator (App's `orchPresetIds`). */
  orchPresetIds: ReadonlySet<string>
  /** Session ids explicitly promoted to leads (App's global `leadIds`) — treated as orchestrators. */
  leadIds: readonly string[]
  /** projectId → workspace name, for labelling non-Scratch groups. */
  projectNames: ReadonlyMap<string, string>
}

/** A terminal is "running" for chip purposes when its tmux session is alive. Mirrors the
 *  main-side `sessions.list()` filter, so a session:list-all payload is already this set —
 *  the guard is a self-contained safety net for the pure helper. */
const ALIVE: ReadonlySet<SessionRecord['status']> = new Set(['running', 'detached'])

/**
 * Group ALIVE worker sessions that live in workspaces OTHER than the current one, one entry
 * per workspace with a count. Orchestrators/leads are excluded — this is purely about
 * background *workers* that would otherwise be invisible from the current cockpit.
 *
 * Pure: no IPC, no DOM, no clock. Classification mirrors App.tsx exactly (orchPresetIds
 * plus the global leadIds), so callers must gate on presets being loaded before trusting
 * the result — an empty orchPresetIds set would misclassify preset-based leads as workers.
 */
export function groupWorkersElsewhere(sessions: readonly SessionRecord[], input: WorkersElsewhereInput): WorkerGroup[] {
  const current = input.currentProjectId ?? null
  const counts = new Map<string | null, number>()
  for (const s of sessions) {
    if (!ALIVE.has(s.status)) continue
    const isOrchestrator = input.orchPresetIds.has(s.presetId) || input.leadIds.includes(s.id)
    if (isOrchestrator) continue
    const projectId = s.projectId ?? null
    if (projectId === current) continue
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1)
  }
  const groups: WorkerGroup[] = []
  for (const [projectId, count] of counts) {
    const label = projectId === null ? 'Scratch' : (input.projectNames.get(projectId) ?? 'Workspace')
    groups.push({ projectId, label, count })
  }
  // Most workers first, then alphabetical by label — a stable, human-friendly order.
  groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return groups
}
