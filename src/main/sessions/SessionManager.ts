import { v4 as uuid } from 'uuid'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DB } from '../db/database'
import { pickCallsign } from '../../shared/agents/callsigns'
import type { PresetRegistry } from '../presets/PresetRegistry'
import type { SessionRecord, SessionStatus, TaskState, Preset } from '@shared/types'
import { ContextProvider } from '../context/ContextProvider'
import { StandardsStore } from '../standards/StandardsStore'
import { isGitRepo, currentRef, addWorktree, linkNodeModules } from './worktree'
import * as tmuxDefault from './tmux'
import { waitForPaneStable, type PaneStableOpts } from './paneReady'
import { isClaudeCli } from '@shared/sessions/cliKind'
import {
  selectClosedOrchestrators,
  closedOrchestratorKey,
  type ReopenDismissMap
} from '@shared/sessions/closedOrchestrators'
import { SettingsStore } from '../settings/SettingsStore'
import { ActivityLog } from '../activity/ActivityLog'
import { PRODUCT_IDENTITY } from '@shared/product'

export type TmuxApi = typeof tmuxDefault

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_')
}

// Like sanitize but keeps hyphens/dots — for human-readable path segments and branch names.
export function pathSafe(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9._-]/g, '_')
  // '.', '..', or empty is a relative-path token — as a worktree/branch segment it would traverse
  // out of the worktree base or collide (a project literally named ".." escaped it). Never emit one.
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned
}

function makeTmuxName(projectId: string | null, presetId: string): string {
  const proj = sanitize(projectId ?? 'noproj').slice(0, 16)
  const short = uuid().slice(0, 8)
  return `mc_${proj}_${sanitize(presetId)}_${short}`
}

export class SessionManager {
  constructor(
    private db: DB,
    private presets: PresetRegistry,
    private tmux: TmuxApi = tmuxDefault,
    private context: ContextProvider = new ContextProvider(undefined, new StandardsStore(db)),
    private now: () => number = () => Date.now(),
    private worktreeBase: string = join(homedir(), '.vibechemy', 'worktrees'),
    private activity: ActivityLog = new ActivityLog(db, now)
  ) {}

  /** Spawnable worker presets (excludes orchestrator leads) — for the list_presets control-plane tool. */
  listPresets(): Preset[] {
    return this.presets.spawnable()
  }

  /** Resolve a preset id forgivingly (exact, else unique fuzzy); throws a clear listing error. */
  resolvePreset(id: string): Preset {
    return this.presets.resolve(id)
  }

  async spawn(
    presetId: string,
    cwd: string,
    projectId: string | null,
    opts: {
      isolate?: boolean
      projectName?: string
      openingPrompt?: string
      /** Explicit callsign ("Nova") — overrides the auto-drafted one. */
      callsign?: string
      owner?: string | null
      task?: string | null
      /** Revive of an isolated worker: reuse its existing worktree (passed as cwd) and carry the
       *  original branch/originRoot so MergeService still treats it as isolated. */
      inheritIsolation?: { branch: string | null; originRoot: string | null }
      /** Launch the preset with THESE args instead of its own — used by reopen() to relaunch a Codex
       *  orchestrator as `codex resume …` (same command + env, resume subcommand + its -c config). */
      argsOverride?: string[]
      /** Prepend these args to the preset's OWN args (keeping --mcp-config etc.) — used by
       *  sub-failover to add `--continue` while an orchestrator KEEPS its product MCP config. */
      argsPrepend?: string[]
      /** Extra env merged over the preset's env — e.g. an account profile's isolated creds dir on a
       *  sign-in login pane, so a plain `claude` worker signs into that account's store. */
      envOverride?: Record<string, string>
    } = {}
  ): Promise<SessionRecord> {
    const preset = this.presets.get(presetId)
    if (!preset) throw new Error(`Unknown preset: ${presetId}`)

    // Optionally isolate the agent in its own git worktree, branched off the repo's current HEAD.
    // Never isolate a shell (it's usually used to run the dev server / poke the real tree) or an
    // orchestrator (a lead works through tools, not a worktree) — a worktree for them is pointless.
    const isolatable = !!opts.isolate && preset.id !== 'shell' && !preset.isOrchestrator
    let runCwd = cwd
    let branch: string | undefined
    if (isolatable && (await isGitRepo(cwd))) {
      const short = uuid().slice(0, 8)
      branch = `${PRODUCT_IDENTITY.worktreeBranchPrefix}${pathSafe(presetId)}-${short}`
      const folder = pathSafe(opts.projectName ?? projectId ?? 'scratch')
      const worktreePath = join(this.worktreeBase, folder, short)
      const base = await currentRef(cwd)
      await addWorktree(cwd, worktreePath, branch, base)
      await linkNodeModules(cwd, worktreePath)
      runCwd = worktreePath
    }

    // Memory is read from the project root (cwd) and projected into runCwd (the worktree when isolated).
    await this.context.prepare(preset.command, cwd, projectId, runCwd)

    const tmuxName = makeTmuxName(projectId, presetId)
    const overrideArgs = opts.argsOverride ?? (opts.argsPrepend ? [...opts.argsPrepend, ...preset.args] : undefined)
    const launchPreset =
      overrideArgs || opts.envOverride
        ? {
            ...preset,
            ...(overrideArgs ? { args: overrideArgs } : {}),
            ...(opts.envOverride ? { env: { ...preset.env, ...opts.envOverride } } : {})
          }
        : preset
    const command = this.presets.buildLaunchCommand(launchPreset)
    await this.tmux.newDetachedSession(tmuxName, runCwd, command)

    // Some leads have no system-prompt/instructions flag, so their opening briefing
    // is typed in as the first turn once the pane is ready. An explicit opts.openingPrompt overrides
    // the preset's default (used to summon a personal agent in oversight mode instead of orchestrator mode).
    // Fire-and-forget so spawn returns immediately; the inject is best-effort.
    const opening = opts.openingPrompt ?? preset.openingPrompt
    if (opening && opening.trim()) {
      this.scheduleOpeningPrompt(tmuxName, opening.trim())
    }

    const ts = this.now()
    // Workers draft a unique callsign at spawn; leads and plain shells stay unnamed. An explicitly
    // requested callsign always wins.
    const isLead = !!preset.isOrchestrator
    const autoName =
      opts.callsign?.trim().slice(0, 24) ||
      (isLead || presetId === 'shell'
        ? null
        : pickCallsign(
            this.allRows()
              .filter((r) => r.status === 'running' || r.status === 'detached')
              .map((r) => r.callsign ?? '')
              .filter(Boolean)
          ))
    // Isolation on the record: a fresh worktree sets `branch` (above); a REVIVE of an isolated
    // worker reuses its existing worktree (cwd) and inherits the original branch/originRoot so
    // MergeService still recognizes it as isolated for merge/discard.
    const recBranch = branch ?? opts.inheritIsolation?.branch ?? null
    const recOriginRoot = branch ? cwd : (opts.inheritIsolation?.originRoot ?? null)
    const rec: SessionRecord = {
      id: uuid(),
      projectId,
      presetId,
      tmuxName,
      cwd: runCwd,
      title: recBranch ? `${preset.name} · ${recBranch}` : preset.name,
      callsign: autoName,
      status: 'running',
      createdAt: ts,
      lastSeenAt: ts,
      branch: recBranch,
      originRoot: recOriginRoot
    }
    this.db
      .prepare(
        'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,callsign,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        rec.id,
        rec.projectId,
        rec.presetId,
        rec.tmuxName,
        rec.cwd,
        rec.title,
        rec.callsign ?? null,
        rec.status,
        rec.createdAt,
        rec.lastSeenAt,
        rec.branch ?? null,
        rec.originRoot ?? null
      )
    if (opts.owner != null || opts.task != null) {
      this.setMeta(rec.id, { owner: opts.owner ?? null, task: opts.task ?? null })
    }
    this.activity.record({
      projectId,
      kind: 'spawn',
      presetId: preset.id,
      branch: branch ?? null,
      summary: `Spawned ${preset.name}${branch ? ` on ${branch}` : ''}`
    })
    return rec
  }

  /**
   * Type a one-line opening prompt into a freshly-spawned pane once it's ready. Heavy CLIs
   * (a personal agent may load skills, MCP, and a large system prompt) reach their input prompt after a variable
   * few seconds, so we wait past a floor and then until the pane output stops changing (the banner
   * finished rendering) before typing — rather than a brittle fixed delay. send-keys submits on
   * every newline, so the prompt is expected to be a single line. Best-effort throughout.
   */
  private scheduleOpeningPrompt(tmuxName: string, text: string): void {
    void (async () => {
      try {
        // Shared readiness logic (paneReady.ts) — the control plane's task injection
        // uses the same wait, so both inject paths behave identically.
        await waitForPaneStable(tmuxName, { capture: (n, l) => this.tmux.capturePane(n, l) })
        await this.tmux.sendKeys(tmuxName, text)
      } catch {
        /* best-effort: a mistimed/failed briefing inject must never affect the session */
      }
    })()
  }

  private allRows(): SessionRecord[] {
    return this.db
      .prepare(
        'SELECT id,project_id as projectId,preset_id as presetId,tmux_name as tmuxName,cwd,title,callsign,status,created_at as createdAt,last_seen_at as lastSeenAt,branch,origin_root as originRoot,task,owner,task_state as taskState FROM sessions'
      )
      .all() as SessionRecord[]
  }

  private setStatus(id: string, status: SessionStatus): void {
    this.db.prepare('UPDATE sessions SET status=?, last_seen_at=? WHERE id=?').run(status, this.now(), id)
  }

  /** Rename a pane; titles flow to dock tabs and the pane resolver so renamed workers remain addressable. */
  rename(id: string, names: { title?: string; callsign?: string }): { ok: boolean; message?: string } {
    const title = names.title?.trim().slice(0, 60)
    const callsign = names.callsign?.trim().slice(0, 24)
    if (names.title !== undefined && !title) return { ok: false, message: 'empty title' }
    const sets: string[] = []
    const vals: (string | null)[] = []
    if (title) {
      sets.push('title=?')
      vals.push(title)
    }
    if (names.callsign !== undefined) {
      sets.push('callsign=?')
      vals.push(callsign || null) // clearing the callsign is legal
    }
    if (sets.length === 0) return { ok: false, message: 'nothing to change' }
    const r = this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id=?`).run(...vals, id)
    return r.changes > 0 ? { ok: true } : { ok: false, message: 'unknown session' }
  }

  /** Update a session's task, owner, and task-state metadata. Only provided keys are written. */
  setMeta(id: string, patch: { task?: string | null; owner?: string | null; taskState?: TaskState | null }): void {
    const sets: string[] = []
    const vals: (string | null)[] = []
    if ('task' in patch) {
      sets.push('task=?')
      vals.push(patch.task ?? null)
    }
    if ('owner' in patch) {
      sets.push('owner=?')
      vals.push(patch.owner ?? null)
    }
    if ('taskState' in patch) {
      sets.push('task_state=?')
      vals.push(patch.taskState ?? null)
    }
    if (sets.length === 0) return
    sets.push('last_seen_at=?')
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id=?`).run(...vals, this.now(), id)
  }

  list(): SessionRecord[] {
    return this.allRows().filter((r) => r.status === 'running' || r.status === 'detached')
  }

  /**
   * Leftover isolated worktrees: sessions that have ended but whose git worktree + branch
   * still sit on disk (unmerged work from a closed terminal). These aren't reopenable
   * (the agent is gone) but their branches can be merged or discarded to reclaim space.
   */
  listLeftovers(): SessionRecord[] {
    return this.allRows().filter(
      (r) => r.status !== 'running' && r.status !== 'detached' && !!r.branch && !!r.cwd && existsSync(r.cwd)
    )
  }

  get(id: string): SessionRecord | undefined {
    return this.allRows().find((r) => r.id === id)
  }

  // Sessions ended ON PURPOSE (UI close / merge / discard) — their exit events are
  // 'expected', so the renderer never tombstones them under the deliberate-exit rule.
  private deliberateEnds = new Set<string>()

  /** True if this session was ended on purpose rather than its CLI dying on its own. Consume-once:
   *  reading the flag also removes it, so `deliberateEnds` can't grow unbounded on an always-on
   *  app (the exit event that reads it fires exactly once per death). */
  wasDeliberate(id: string): boolean {
    return this.deliberateEnds.delete(id)
  }

  async kill(id: string): Promise<void> {
    const row = this.allRows().find((r) => r.id === id)
    if (!row) return
    this.deliberateEnds.add(id) // BEFORE the tmux kill — the pty exit callback fires during it
    if (await this.tmux.hasSession(row.tmuxName)) await this.tmux.killSession(row.tmuxName)
    this.setStatus(id, 'exited')
  }

  /** Raw row lookup incl. exited sessions (list() filters those) — for the revive IPC handler. */
  rowById(id: string): SessionRecord | undefined {
    return this.allRows().find((r) => r.id === id)
  }

  // Dead sessions already revived this run — a tombstone can be revived exactly once.
  private revivedIds = new Set<string>()
  /** Test hook: shrink waitForPaneStable delays for the /resume injection. */
  paneStableOverrides: Partial<Pick<PaneStableOpts, 'floorMs' | 'pollMs' | 'maxWaitMs'>> = {}

  /**
   * Respawn an unexpectedly-dead session in place: same preset, same cwd (an isolated
   * worker's worktree still exists on disk), carrying owner/task metadata. For claude
   * CLIs the preset opening prompt is suppressed and `/resume` is injected instead, so
   * the resume picker opens with the dead conversation on top.
   */
  async revive(id: string, fallbackCwd?: string): Promise<{ ok: boolean; message?: string; newId?: string }> {
    const row = this.rowById(id)
    if (!row) return { ok: false, message: `unknown session: ${id}` }
    if (row.status !== 'exited' && row.status !== 'failed') return { ok: false, message: 'session is still running' }
    if (this.revivedIds.has(id)) return { ok: false, message: 'already revived this run' }
    const preset = this.presets.get(row.presetId)
    if (!preset) return { ok: false, message: `unknown preset: ${row.presetId}` }
    const cwd = existsSync(row.cwd) ? row.cwd : fallbackCwd
    if (!cwd || !existsSync(cwd)) return { ok: false, message: 'working directory no longer exists' }
    const claude = isClaudeCli(preset.command)
    let rec: SessionRecord
    try {
      rec = await this.spawn(row.presetId, cwd, row.projectId, {
        owner: row.owner,
        task: row.task,
        // Reuse the original worktree + carry its isolation so the revived pane stays merge/discardable
        // only when the original was isolated (row.branch set).
        ...(row.branch ? { inheritIsolation: { branch: row.branch, originRoot: row.originRoot ?? null } } : {}),
        // claude revives restore context via /resume — replaying the briefing would collide with it
        ...(claude ? { openingPrompt: '' } : {})
      })
    } catch (err) {
      return { ok: false, message: `respawn failed: ${String(err)}` } // guard NOT set — retry allowed
    }
    this.revivedIds.add(id)
    // Cap the "revived once" guard set — an evicted id's tombstone is long gone from the UI, so it
    // can't be re-revived anyway; this just bounds memory on an always-on app.
    if (this.revivedIds.size > 500) {
      const oldest = this.revivedIds.values().next().value
      if (oldest !== undefined) this.revivedIds.delete(oldest)
    }
    if (claude) {
      void (async () => {
        try {
          await waitForPaneStable(rec.tmuxName, {
            capture: (n, l) => this.tmux.capturePane(n, l),
            ...this.paneStableOverrides
          })
          await this.tmux.sendKeys(rec.tmuxName, '/resume')
        } catch {
          /* best-effort: the pane is alive either way; the user can type /resume */
        }
      })()
    }
    return { ok: true, newId: rec.id }
  }

  /**
   * Recently-closed orchestrators (exited leads whose cwd still exists) — the reopen-tray candidates,
   * deduped by preset+cwd, newest first, within the recency window and minus anything the user
   * dismissed. Pure selection logic lives in `@shared/sessions/closedOrchestrators`; here we just
   * feed it live DB rows + the persisted dismiss map. Excludes slots that are live again (reopened).
   */
  listClosedOrchestrators(): SessionRecord[] {
    return selectClosedOrchestrators(this.allRows(), {
      isOrchestrator: (pid) => !!this.presets.get(pid)?.isOrchestrator,
      cwdExists: (cwd) => existsSync(cwd),
      dismissed: this.reopenDismissMap(),
      now: this.now()
    })
  }

  /**
   * Banish a closed orchestrator from the reopen tray (persisted across restarts). It only comes
   * back if a session is closed for the same preset+cwd slot AFTER now — a genuinely new close,
   * never an already-buried older one.
   */
  dismissClosedOrchestrator(id: string): { ok: boolean; message?: string } {
    const row = this.rowById(id)
    if (!row) return { ok: false, message: `unknown session: ${id}` }
    const map = this.reopenDismissMap()
    map[closedOrchestratorKey(row)] = Math.max(this.now(), row.lastSeenAt)
    new SettingsStore(this.db).set(SessionManager.REOPEN_DISMISS_KEY, JSON.stringify(map))
    return { ok: true }
  }

  private static readonly REOPEN_DISMISS_KEY = 'orchestrator.reopenDismissed'
  private reopenDismissMap(): ReopenDismissMap {
    try {
      const raw = new SettingsStore(this.db).get(SessionManager.REOPEN_DISMISS_KEY)
      if (!raw) return {}
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as ReopenDismissMap) : {}
    } catch {
      return {}
    }
  }

  /**
   * Reopen a closed orchestrator, restoring BOTH its tools (respawned through the orchestrator
   * preset → the product MCP) and its conversation. Codex has no in-session /resume, so it
   * relaunches as `codex resume <its -c config>` (dropping the opening-prompt arg; the conversation
   * already carries the briefing) — the resume picker opens inside a pane that already has the
   * tools. Claude (and others) go through revive(), which respawns the preset and injects /resume.
   */
  async reopen(id: string): Promise<{ ok: boolean; message?: string; newId?: string }> {
    const row = this.rowById(id)
    if (!row) return { ok: false, message: `unknown session: ${id}` }
    const preset = this.presets.get(row.presetId)
    if (!preset?.isOrchestrator) return { ok: false, message: 'not an orchestrator' }
    if (!existsSync(row.cwd)) return { ok: false, message: 'working directory no longer exists' }
    if (preset.command === 'codex') {
      try {
        const rec = await this.spawn(row.presetId, row.cwd, row.projectId, {
          owner: row.owner,
          task: row.task,
          argsOverride: ['resume', ...(preset.args ?? []).slice(0, -1)],
          openingPrompt: ''
        })
        return { ok: true, newId: rec.id }
      } catch (err) {
        return { ok: false, message: `reopen failed: ${String(err)}` }
      }
    }
    return this.revive(id)
  }

  /**
   * Called when a session's pty attach-client exits. If the tmux session is
   * actually gone (the program inside it exited), mark the record 'exited' so its
   * pane closes instead of lingering on a "[lost tty]" screen. A deliberate detach
   * leaves the tmux session alive, so it correctly stays 'running'.
   */
  /** Mark a session exited iff its tmux session is actually gone. Returns whether it FLIPPED
   *  running→exited (i.e. the session really died) — a plain viewer detach leaves tmux alive and
   *  returns false, so callers can avoid firing a spurious exit/tombstone event for a live session;
   *  tab/layout-switch detaches must not tombstone still-running panes. */
  async markExitedIfGone(id: string): Promise<boolean> {
    const row = this.allRows().find((r) => r.id === id)
    if (!row || row.status === 'exited') return false
    if (await this.tmux.hasSession(row.tmuxName)) return false // still alive — a detach, not a death
    this.setStatus(id, 'exited')
    return true
  }

  async reconcile(): Promise<{ reattached: SessionRecord[]; missing: SessionRecord[]; orphans: string[] }> {
    const live = new Set(await this.tmux.listSessions())
    const rows = this.allRows().filter((r) => r.status !== 'exited')
    const reattached: SessionRecord[] = []
    const missing: SessionRecord[] = []
    for (const r of rows) {
      if (live.has(r.tmuxName)) {
        this.setStatus(r.id, 'running')
        reattached.push(r)
      } else {
        this.setStatus(r.id, 'exited')
        missing.push(r)
      }
    }
    const known = new Set(this.allRows().map((r) => r.tmuxName))
    const orphans = [...live].filter((n) => n.startsWith('mc_') && !known.has(n))
    return { reattached, missing, orphans }
  }
}
