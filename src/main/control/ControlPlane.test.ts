import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Preset } from '@shared/types'
import { ActivityLog } from '../activity/ActivityLog'
import { openDatabase } from '../db/database'
import { MergeService } from '../git/MergeService'
import { KnowledgeStore } from '../knowledge/KnowledgeStore'
import { MemoryStore } from '../memory/MemoryStore'
import { PresetRegistry } from '../presets/PresetRegistry'
import { ProjectStore } from '../projects/ProjectStore'
import { PtyBridge } from '../sessions/PtyBridge'
import { SessionManager } from '../sessions/SessionManager'
import { hasSession, killSession } from '../sessions/tmux'
import { SettingsStore } from '../settings/SettingsStore'
import { StandardsStore } from '../standards/StandardsStore'
import { ControlEventHub } from './ControlEventHub'
import { ControlPlane } from './ControlPlane'

const presets: Preset[] = [{ id: 'sleeper', name: 'Sleeper', command: 'sleep', args: ['120'], env: {} }]
const INSERT =
  'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'

const roots: string[] = []
let spawnedTmux: string | null = null

interface Fixture {
  db: ReturnType<typeof openDatabase>
  sessions: SessionManager
  projects: ProjectStore
  activity: ActivityLog | undefined
  knowledge: KnowledgeStore | undefined
  standards: StandardsStore | undefined
  settings: SettingsStore | undefined
  cp: ControlPlane
}

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function fixture(options: { stores?: boolean } = {}): Fixture {
  const root = temp('mc-cp-')
  const db = openDatabase(join(root, 'control.sqlite'))
  const registry = PresetRegistry.from(presets)
  const sessions = new SessionManager(db, registry)
  const merge = new MergeService(
    sessions,
    new PtyBridge(
      () => {},
      () => {}
    )
  )
  const projects = new ProjectStore(db)
  const eventHub = new ControlEventHub()
  const activity = options.stores ? new ActivityLog(db, () => 1000) : undefined
  const knowledge = options.stores ? new KnowledgeStore(db, () => 1000) : undefined
  const standards = options.stores ? new StandardsStore(db, () => 1000) : undefined
  const settings = options.stores ? new SettingsStore(db) : undefined
  const cp = new ControlPlane(
    sessions,
    merge,
    projects,
    () => {},
    () => {},
    new MemoryStore(join(root, 'global')),
    activity,
    knowledge,
    standards,
    settings,
    eventHub
  )
  return { db, sessions, projects, activity, knowledge, standards, settings, cp }
}

afterEach(async () => {
  if (spawnedTmux && (await hasSession(spawnedTmux))) await killSession(spawnedTmux)
  spawnedTmux = null
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('ControlPlane core', () => {
  it('maps workers and reports isolation from the persisted branch', () => {
    const { db, cp } = fixture()
    db.prepare(INSERT).run('a', null, 'codex', 'mc_a', '/tmp', 'Codex', 'running', 1, 1, null, null)
    db.prepare(INSERT).run('b', null, 'sleeper', 'mc_b', '/tmp/wt', 'Sleeper', 'running', 1, 1, 'vc/x', '/tmp')
    expect(cp.listWorkers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workerId: 'a', isolated: false, branch: null }),
        expect.objectContaining({ workerId: 'b', isolated: true, branch: 'vc/x' })
      ])
    )
    db.close()
  })

  it('spawns a real session, notifies the renderer, and lists the worker', async () => {
    const root = temp('mc-cp-spawn-')
    const db = openDatabase(join(root, 'spawn.sqlite'))
    const sessions = new SessionManager(db, PresetRegistry.from(presets))
    const merge = new MergeService(
      sessions,
      new PtyBridge(
        () => {},
        () => {}
      )
    )
    let changed = 0
    const cp = new ControlPlane(
      sessions,
      merge,
      new ProjectStore(db),
      () => {},
      () => changed++
    )
    const info = await cp.spawnWorker({ presetId: 'sleeper', cwd: tmpdir() })
    spawnedTmux = info.tmuxName
    expect(changed).toBe(1)
    expect(cp.listWorkers()).toEqual(expect.arrayContaining([expect.objectContaining({ workerId: info.workerId })]))
    db.close()
  })

  it('rejects a spawn without a cwd or project and reports unknown worker operations honestly', async () => {
    const { db, cp } = fixture()
    await expect(cp.spawnWorker({ presetId: 'sleeper' })).rejects.toThrow(/cwd or a projectId/)
    await expect(cp.discardWorker('missing')).rejects.toThrow(/unknown worker/)
    await expect(cp.readOutput('missing')).resolves.toEqual(
      expect.objectContaining({ ok: false, output: '', message: expect.stringContaining('unknown worker') })
    )
    db.close()
  })

  it('round-trips shared project memory and lists registered projects', () => {
    const { db, projects, cp } = fixture()
    const projectRoot = temp('mc-cp-project-')
    const project = projects.createProject('Project One', projectRoot)
    expect(cp.listProjects()).toContainEqual({ id: project.id, name: 'Project One', rootPath: projectRoot })
    expect(cp.noteLearning(project.id, 'Use the retained seam.').ok).toBe(true)
    const memory = cp.getMemory(project.id)
    expect(memory.ok).toBe(true)
    expect(memory.learnings).toContain('Use the retained seam.')
    db.close()
  })

  it('logs, updates, searches, and lists knowledge entries', () => {
    const { db, cp } = fixture({ stores: true })
    const logged = cp.logOutcome({ type: 'bug', title: 'Broken core seam' })
    expect(logged.ok).toBe(true)
    const id = logged.entry!.id
    expect(cp.searchKnowledge('core')).toHaveLength(1)
    expect(cp.updateOutcome(id, { status: 'fixed' }).entry?.status).toBe('fixed')
    expect(cp.listKnowledge({ type: 'bug', status: 'fixed' })).toHaveLength(1)
    db.close()
  })

  it('logs, renders, and retires coding standards', () => {
    const { db, cp } = fixture({ stores: true })
    const logged = cp.logStandard({
      category: 'testing',
      rule: 'Run focused tests first',
      detail: 'Then run the gate.'
    })
    expect(logged.ok).toBe(true)
    expect(cp.getStandards().rendered).toContain('Run focused tests first')
    expect(cp.updateStandard(logged.entry!.id, { status: 'retired' }).ok).toBe(true)
    expect(cp.getStandards().standards).toHaveLength(0)
    db.close()
  })

  it('reports an unavailable standards layer without fabricating data', () => {
    const { db, cp } = fixture()
    expect(cp.getStandards()).toEqual({
      ok: false,
      standards: [],
      rendered: '',
      message: 'Standards layer unavailable.'
    })
    db.close()
  })

  it('updates worker task state and publishes review events', async () => {
    const { db, sessions, cp } = fixture()
    db.prepare(INSERT).run('w', null, 'sleeper', 'mc_w', '/tmp', 'Sleeper', 'running', 1, 1, 'vc/review', '/tmp')
    expect(cp.setTask('w', { task: 'Review core', state: 'needs_review' }).ok).toBe(true)
    expect(sessions.get('w')).toMatchObject({ task: 'Review core', taskState: 'needs_review' })
    const event = await cp.awaitEvent({ sinceSeq: 0, timeoutMs: 10 })
    expect(event.events).toEqual([expect.objectContaining({ kind: 'worker_state', workerId: 'w' })])
    db.close()
  })

  it('applies agent config through the installed settings writer', () => {
    const { db, settings, cp } = fixture({ stores: true })
    cp.installSettingsWriter((key, value) => settings!.set(key, value))
    const result = cp.configureAgents({ action: 'add_custom_agent', label: 'Local Agent', command: 'local-agent' })
    expect(result.ok).toBe(true)
    expect(result.config.customAgents).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Local Agent', command: 'local-agent' })])
    )
    db.close()
  })

  it('builds a day digest from retained activity and knowledge stores', () => {
    const { db, activity, cp } = fixture({ stores: true })
    activity!.record({ kind: 'merge', projectId: null, summary: 'Merged core shell' })
    cp.logOutcome({ type: 'feature', title: 'Core shell', status: 'shipped' })
    const digest = cp.dayDigest({ sinceMs: 0 })
    expect(digest.ok).toBe(true)
    expect(digest.digest).toContain('Core shell')
    db.close()
  })
})
