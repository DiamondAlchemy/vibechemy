import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  agentConfigSnapshot,
  applyConfigAction,
  type AgentConfigAction,
  type AgentConfigSnapshot
} from '@shared/agents/configOps'
import { applyModelToArgs } from '@shared/agents/models'
import type { KnowledgeEntry, KnowledgeType, StandardCategory, StandardEntry, TaskState } from '@shared/types'
import { buildDigest, startOfDay } from '../activity/digest'
import type { ActivityLog } from '../activity/ActivityLog'
import type { MergeResult, DiffResult, MergeService } from '../git/MergeService'
import type { KnowledgeStore } from '../knowledge/KnowledgeStore'
import { MemoryStore } from '../memory/MemoryStore'
import type { ProjectStore } from '../projects/ProjectStore'
import { waitForPaneStable } from '../sessions/paneReady'
import type { SessionManager } from '../sessions/SessionManager'
import { isWorktreeDirty } from '../sessions/worktree'
import { capturePane, sendKeys } from '../sessions/tmux'
import type { SettingsStore } from '../settings/SettingsStore'
import type { StandardsStore } from '../standards/StandardsStore'
import { ControlEventHub, type AwaitOptions, type AwaitResult, type ControlEventInput } from './ControlEventHub'
import { runWorkspacePrecheck } from './precheck'
import type { PrecheckResult } from '@shared/ipc'

export interface WorkerInfo {
  workerId: string
  preset: string
  branch: string | null
  status: string
  isolated: boolean
  cwd: string
}

export interface SpawnInfo {
  workerId: string
  branch: string | null
  cwd: string
  tmuxName: string
}

function expandHome(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
  return resolve(trimmed)
}

/** Transport-independent business logic for the retained terminal orchestration core. */
export class ControlPlane {
  private settingsWriter?: (key: string, value: string) => void

  constructor(
    private sessions: SessionManager,
    private mergeSvc: MergeService,
    private projects: ProjectStore,
    private notifyExit: (id: string) => void,
    private notifyChanged: () => void = () => {},
    private memory: MemoryStore = new MemoryStore(),
    private activity?: ActivityLog,
    private knowledge?: KnowledgeStore,
    private standards?: StandardsStore,
    private settings?: SettingsStore,
    private eventHub: ControlEventHub = new ControlEventHub()
  ) {}

  private recordEvent(event: ControlEventInput): void {
    this.eventHub.record(event)
  }

  installSettingsWriter(writer: (key: string, value: string) => void): void {
    this.settingsWriter = writer
  }

  getAgentConfig(): AgentConfigSnapshot {
    if (!this.settings) throw new Error('get_agent_config: settings not wired')
    return agentConfigSnapshot((key) => this.settings!.get(key))
  }

  configureAgents(action: AgentConfigAction): { ok: true; summary: string; config: AgentConfigSnapshot } {
    if (!this.settings) throw new Error('configure_agents: settings not wired')
    if (!this.settingsWriter) throw new Error('configure_agents: settings writer not installed yet')
    const { writes, summary } = applyConfigAction((key) => this.settings!.get(key), action)
    for (const write of writes) this.settingsWriter(write.key, write.value)
    return { ok: true, summary, config: this.getAgentConfig() }
  }

  awaitEvent(options: AwaitOptions): Promise<AwaitResult> {
    return this.eventHub.waitFor(options)
  }

  getMemory(projectId: string): {
    ok: boolean
    global?: string
    project?: string
    learnings?: string
    message?: string
  } {
    const project = this.projects.getProject(projectId)
    if (!project) return { ok: false, message: `Unknown project: ${projectId}` }
    return {
      ok: true,
      global: this.memory.readGlobal(),
      project: this.memory.readProject(project.rootPath),
      learnings: this.memory.readLearnings(project.rootPath)
    }
  }

  noteLearning(projectId: string, text: string): { ok: boolean; message: string } {
    const project = this.projects.getProject(projectId)
    if (!project) return { ok: false, message: `Unknown project: ${projectId}` }
    if (!text.trim()) return { ok: false, message: 'note_learning: text is required' }
    this.memory.appendLearning(project.rootPath, text)
    return { ok: true, message: 'Learning recorded.' }
  }

  listProjects(): { id: string; name: string; rootPath: string }[] {
    return this.projects.listProjects().map((project) => ({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath
    }))
  }

  listPresets(): Array<{ id: string; name: string; command: string }> {
    return this.sessions.listPresets().map((preset) => ({
      id: preset.id,
      name: preset.name,
      command: preset.command
    }))
  }

  dayDigest(options: { sinceMs?: number; projectId?: string | null } = {}): {
    ok: boolean
    since: number
    digest: string
  } {
    if (!this.activity) return { ok: false, since: 0, digest: 'Activity ledger unavailable.' }
    const since = options.sinceMs ?? startOfDay()
    const events = this.activity.since(since, options.projectId)
    const knowledge = this.knowledge ? this.knowledge.list({ projectId: options.projectId }) : []
    const nameOf = (projectId: string | null): string =>
      projectId ? (this.projects.getProject(projectId)?.name ?? 'Unknown project') : 'Scratch'
    return { ok: true, since, digest: buildDigest(events, knowledge, nameOf, since) }
  }

  logOutcome(input: {
    projectId?: string | null
    type: KnowledgeType
    title: string
    detail?: string
    status?: string
    branch?: string | null
  }): { ok: boolean; entry?: KnowledgeEntry; message?: string } {
    if (!this.knowledge) return { ok: false, message: 'Knowledge base unavailable.' }
    if (!input.title.trim()) return { ok: false, message: 'logOutcome: title is required' }
    return { ok: true, entry: this.knowledge.log(input) }
  }

  updateOutcome(
    id: string,
    patch: { status?: string; detail?: string; title?: string }
  ): { ok: boolean; entry?: KnowledgeEntry; message?: string } {
    if (!this.knowledge) return { ok: false, message: 'Knowledge base unavailable.' }
    const entry = this.knowledge.update(id, patch)
    return entry ? { ok: true, entry } : { ok: false, message: `updateOutcome: unknown entry ${id}` }
  }

  searchKnowledge(query: string, projectId?: string | null): KnowledgeEntry[] {
    return this.knowledge ? this.knowledge.search(query, projectId) : []
  }

  listKnowledge(options: { projectId?: string | null; type?: KnowledgeType; status?: string } = {}): KnowledgeEntry[] {
    return this.knowledge ? this.knowledge.list(options) : []
  }

  getStandards(projectId?: string | null): {
    ok: boolean
    standards: StandardEntry[]
    rendered: string
    message?: string
  } {
    if (!this.standards) return { ok: false, standards: [], rendered: '', message: 'Standards layer unavailable.' }
    return {
      ok: true,
      standards: this.standards.listActive(projectId),
      rendered: this.standards.renderForProject(projectId)
    }
  }

  logStandard(input: {
    projectId?: string | null
    category: StandardCategory
    rule: string
    detail?: string | null
    sort?: number
  }): { ok: boolean; entry?: StandardEntry; message?: string } {
    if (!this.standards) return { ok: false, message: 'Standards layer unavailable.' }
    if (!input.rule.trim()) return { ok: false, message: 'logStandard: rule is required' }
    return { ok: true, entry: this.standards.log(input) }
  }

  updateStandard(
    id: string,
    patch: {
      rule?: string
      detail?: string | null
      category?: StandardCategory
      status?: 'active' | 'retired'
      sort?: number
    }
  ): { ok: boolean; entry?: StandardEntry; message?: string } {
    if (!this.standards) return { ok: false, message: 'Standards layer unavailable.' }
    const entry = this.standards.update(id, patch)
    return entry ? { ok: true, entry } : { ok: false, message: `updateStandard: unknown entry ${id}` }
  }

  listWorkers(projectId?: string | null): WorkerInfo[] {
    return this.sessions
      .list()
      .filter((record) => projectId === undefined || (record.projectId ?? null) === (projectId ?? null))
      .map((record) => ({
        workerId: record.id,
        preset: record.presetId,
        branch: record.branch ?? null,
        status: record.status,
        isolated: !!record.branch,
        cwd: record.cwd
      }))
  }

  async spawnWorker(options: {
    presetId: string
    cwd?: string
    projectId?: string | null
    isolate?: boolean
    task?: string
    owner?: string | null
    callsign?: string
    model?: string
    effort?: string
  }): Promise<SpawnInfo> {
    const preset = this.sessions.resolvePreset(options.presetId)
    let argsOverride: string[] | undefined
    if (options.model?.trim() || options.effort?.trim()) {
      const applied = applyModelToArgs(preset.command, preset.args, options.model, options.effort)
      if (applied === null) {
        throw new Error(`spawn_worker: preset ${preset.id} does not support a model override`)
      }
      argsOverride = applied
    }

    let projectId = options.projectId ?? null
    let project = projectId ? this.projects.getProject(projectId) : undefined
    if (!project && options.cwd) {
      const cwd = expandHome(options.cwd)
      project = this.projects.listProjects().find((candidate) => candidate.rootPath === cwd)
      if (project) projectId = project.id
    }
    const rawCwd = options.cwd ?? project?.rootPath
    if (!rawCwd) throw new Error('spawn_worker: provide a cwd or a projectId')
    const cwd = expandHome(rawCwd)
    if (!existsSync(cwd)) throw new Error(`spawn_worker: folder does not exist: ${cwd}`)

    const record = await this.sessions.spawn(preset.id, cwd, projectId, {
      isolate: !!options.isolate,
      callsign: options.callsign,
      projectName: project?.name,
      owner: options.owner ?? null,
      task: options.task ?? null,
      argsOverride
    })
    this.notifyChanged()
    this.recordEvent({ kind: 'worker_added', workerId: record.id, preset: preset.id })
    if (options.task?.trim()) {
      await waitForPaneStable(record.tmuxName, { capture: capturePane }).catch(() => {})
      await sendKeys(record.tmuxName, options.task.trim()).catch(() => {})
    }
    return {
      workerId: record.id,
      branch: record.branch ?? null,
      cwd: record.cwd,
      tmuxName: record.tmuxName
    }
  }

  async sendToWorker(workerId: string, text: string): Promise<{ ok: boolean; message?: string }> {
    const worker = this.sessions.get(workerId)
    if (!worker) return { ok: false, message: `unknown worker: ${workerId}` }
    if (worker.status !== 'running' && worker.status !== 'detached') {
      return { ok: false, message: `worker ${workerId} is not running (status: ${worker.status})` }
    }
    await sendKeys(worker.tmuxName, text ?? '')
    return { ok: true }
  }

  setTask(workerId: string, options: { task?: string; state?: TaskState }): { ok: boolean; message?: string } {
    const worker = this.sessions.get(workerId)
    if (!worker) return { ok: false, message: `unknown worker: ${workerId}` }
    const patch: { task?: string; taskState?: TaskState } = {}
    if (options.task !== undefined) patch.task = options.task
    if (options.state !== undefined) patch.taskState = options.state
    this.sessions.setMeta(workerId, patch)
    if (options.state === 'needs_review' || options.state === 'done') {
      this.recordEvent({
        kind: 'worker_state',
        workerId,
        state: options.state,
        branch: worker.branch ?? null,
        owner: worker.owner ?? null
      })
    }
    return { ok: true }
  }

  getDiff(workerId: string): Promise<DiffResult> {
    return this.mergeSvc.diff(workerId)
  }

  runCheck(workerId: string): Promise<PrecheckResult> {
    const worker = this.sessions.get(workerId)
    if (!worker) {
      return Promise.resolve({ configured: true, exitCode: 1, output: `unknown worker: ${workerId}` })
    }
    const workspaceRoot = worker.originRoot ?? this.projects.getProject(worker.projectId ?? '')?.rootPath ?? worker.cwd
    return runWorkspacePrecheck(worker.cwd, workspaceRoot)
  }

  async readOutput(workerId: string, lines = 200): Promise<{ ok: boolean; output: string; message?: string }> {
    const worker = this.sessions.get(workerId)
    if (!worker) return { ok: false, output: '', message: `unknown worker: ${workerId}` }
    return { ok: true, output: await capturePane(worker.tmuxName, lines) }
  }

  async mergeWorker(workerId: string): Promise<MergeResult> {
    const preset = this.sessions.get(workerId)?.presetId ?? 'unknown'
    const result = await this.mergeSvc.merge(workerId)
    if (result.ok) {
      this.notifyExit(workerId)
      this.recordEvent({ kind: 'worker_removed', workerId, preset })
    }
    return result
  }

  async listLeftovers(
    projectId?: string | null
  ): Promise<Array<{ workerId: string; preset: string; branch: string | null; dirty: boolean }>> {
    const rows = this.sessions
      .listLeftovers()
      .filter((record) => projectId === undefined || (record.projectId ?? null) === (projectId ?? null))
    return Promise.all(
      rows.map(async (record) => ({
        workerId: record.id,
        preset: record.presetId,
        branch: record.branch ?? null,
        dirty: await isWorktreeDirty(record.cwd).catch(() => false)
      }))
    )
  }

  async discardWorker(workerId: string): Promise<{ ok: boolean; message?: string }> {
    const worker = this.sessions.get(workerId)
    if (!worker) throw new Error(`discard_worker: unknown worker: ${workerId}`)
    if (
      worker.branch &&
      worker.cwd &&
      existsSync(worker.cwd) &&
      (await isWorktreeDirty(worker.cwd).catch(() => false))
    ) {
      throw new Error(`discard_worker: "${worker.branch}" has uncommitted changes`)
    }
    const result = await this.mergeSvc.discard(workerId)
    if (result.ok) {
      this.notifyExit(workerId)
      this.recordEvent({ kind: 'worker_removed', workerId, preset: worker.presetId })
    }
    return result
  }
}
