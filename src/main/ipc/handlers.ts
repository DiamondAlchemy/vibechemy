import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import packageJson from '../../../package.json'
import { IPC } from '@shared/ipc'
import { CUSTOM_AGENTS_KEY, parseCustomAgents, presetsFromCustomAgents } from '@shared/agents/custom'
import { EFFORT_SETTING_PREFIX, MODEL_SETTING_PREFIX } from '@shared/agents/models'
import { OPENCODE_MODELS_KEY, parseOpencodeModels, presetsFromModels } from '@shared/agents/opencode'
import { PROFILES_KEY } from '@shared/agents/profiles'
import {
  LEGACY_PERSONAL_AGENT_IDS,
  PA_KEYS,
  PERSONAL_AGENT_PRESET_ID,
  buildPaOversightBriefing,
  parsePersonalAgent
} from '@shared/agents/personalAgent'
import { AgentSetupService } from '../agents/AgentSetupService'
import { startOfDay } from '../activity/digest'
import type { ActivityLog } from '../activity/ActivityLog'
import type { ControlPlane } from '../control/ControlPlane'
import type { MergeService } from '../git/MergeService'
import type { WorktreeService } from '../git/WorktreeService'
import type { PresetRegistry } from '../presets/PresetRegistry'
import type { ProjectStore } from '../projects/ProjectStore'
import type { PtyBridge } from '../sessions/PtyBridge'
import type { SessionManager } from '../sessions/SessionManager'
import { capturePane, hasSession, sendKeys, sendKeysNoEnter, cancelCopyMode } from '../sessions/tmux'
import type { SettingsStore } from '../settings/SettingsStore'
import type { UsageService } from '../usage/UsageService'
import type { AsrProvider } from '../voice/AsrProvider'

function expandHome(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
  return resolve(trimmed)
}

// Self-contained (login-shell probes only) — no reason to thread through IpcDeps.
const agentSetup = new AgentSetupService()

export interface IpcDeps {
  presets: PresetRegistry
  projects: ProjectStore
  sessions: SessionManager
  pty: PtyBridge
  merge: MergeService
  worktrees: WorktreeService
  activity: ActivityLog
  settings: SettingsStore
  usage: UsageService
  voice: AsrProvider
  control: ControlPlane
  notifyExit: (id: string) => void
  notifyProjects: () => void
  notifySessions: () => void
  notifyPresets: () => void
  reloadProfiles: () => void
  reloadPersonalAgent: () => void
}

export function registerIpc({
  presets,
  projects,
  sessions,
  pty,
  merge,
  worktrees,
  activity,
  settings,
  usage,
  voice,
  control,
  notifyExit,
  notifyProjects,
  notifySessions,
  notifyPresets,
  reloadProfiles,
  reloadPersonalAgent
}: IpcDeps): void {
  ipcMain.handle(
    IPC.sessionSpawn,
    async (
      _event,
      {
        presetId,
        projectId,
        isolate,
        cwd
      }: { presetId: string; projectId: string | null; isolate?: boolean; cwd?: string }
    ) => {
      const project = projectId ? projects.getProject(projectId) : undefined
      const root = cwd ? expandHome(cwd) : (project?.rootPath ?? homedir())
      if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Folder not found: ${root}`)
      const record = await sessions.spawn(presetId, root, projectId, {
        isolate: !!isolate,
        projectName: project?.name
      })
      notifySessions()
      return record
    }
  )

  ipcMain.handle(IPC.sessionList, (_event, projectId: string | null) =>
    sessions.list().filter((session) => (session.projectId ?? null) === (projectId ?? null))
  )
  ipcMain.handle(IPC.sessionListAll, () => sessions.list())
  ipcMain.handle(IPC.sessionKill, async (_event, id: string) => {
    await sessions.kill(id)
    pty.detach(id)
    notifyExit(id)
  })
  ipcMain.handle(IPC.sessionRevive, async (_event, id: string) => {
    const row = sessions.rowById(id)
    const fallback = row?.projectId ? projects.getProject(row.projectId)?.rootPath : undefined
    const result = await sessions.revive(id, fallback)
    if (result.ok) notifySessions()
    return result
  })
  ipcMain.handle(IPC.orchestratorsClosed, () => sessions.listClosedOrchestrators())
  ipcMain.handle(IPC.orchestratorReopen, async (_event, id: string) => {
    const result = await sessions.reopen(id)
    if (result.ok) notifySessions()
    return result
  })
  ipcMain.handle(IPC.orchestratorReopenDismiss, (_event, id: string) => sessions.dismissClosedOrchestrator(id))
  ipcMain.handle(
    IPC.sessionRename,
    (_event, { id, title, callsign }: { id: string; title?: string; callsign?: string }) => {
      const result = sessions.rename(id, { title, callsign })
      if (result.ok) notifySessions()
      return result
    }
  )

  ipcMain.on(IPC.paneContextMenu, (event, selection: string) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Copy', enabled: !!selection, click: () => clipboard.writeText(selection) },
      { label: 'Paste', click: () => event.sender.paste() }
    ])
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined })
  })
  // Exit tmux copy-mode on a pane when it receives the focusing click. A primary-screen pane
  // (Codex, shells) enters copy-mode on a wheel-scroll; the focus-click swallow means a click never
  // reaches tmux to cancel it, so paste/typing stays trapped in copy-mode. Fire-and-forget; cancel
  // is a harmless no-op when the pane isn't in a mode.
  ipcMain.on(IPC.paneCancelCopyMode, (_event, id: string) => {
    const s = sessions.get(id)
    if (s) void cancelCopyMode(s.tmuxName)
  })
  ipcMain.handle(IPC.paneType, async (_event, { id, text, submit }: { id: string; text: string; submit: boolean }) => {
    const row = sessions.rowById(id)
    if (!row) return { ok: false, message: 'unknown session' }
    if (row.status !== 'running' && row.status !== 'detached') {
      return { ok: false, message: `that pane has exited (${row.status})` }
    }
    if (!(await hasSession(row.tmuxName).catch(() => false))) {
      await sessions.markExitedIfGone(id).catch(() => {})
      return { ok: false, message: 'that pane is gone — its terminal has ended' }
    }
    try {
      if (submit) await sendKeys(row.tmuxName, text)
      else await sendKeysNoEnter(row.tmuxName, text)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  })

  ipcMain.handle(
    IPC.sessionAttach,
    (_event, { id, cols, rows, viewerId }: { id: string; cols: number; rows: number; viewerId: string }) => {
      const record = sessions.list().find((session) => session.id === id)
      if (record) pty.attach(record.id, record.tmuxName, cols, rows, viewerId)
    }
  )
  ipcMain.handle(IPC.sessionDetach, async (_event, id: string) => pty.detach(id))
  ipcMain.on(IPC.sessionWrite, (_event, { id, data }: { id: string; data: string }) => pty.write(id, data))
  ipcMain.on(IPC.sessionResize, (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
    pty.resize(id, cols, rows)
  )

  ipcMain.handle(IPC.sessionDiff, (_event, id: string) => merge.diff(id))
  ipcMain.handle(IPC.sessionMerge, async (_event, id: string) => {
    const result = await merge.merge(id)
    if (result.ok) notifyExit(id)
    return result
  })
  ipcMain.handle(IPC.sessionDiscard, async (_event, id: string) => {
    const result = await merge.discard(id)
    if (result.ok) notifyExit(id)
    return result
  })
  ipcMain.handle(IPC.worktreeLeftovers, (_event, projectId: string | null) =>
    sessions.listLeftovers().filter((session) => (session.projectId ?? null) === (projectId ?? null))
  )
  ipcMain.handle(IPC.worktreesList, () => worktrees.list())
  ipcMain.handle(IPC.worktreesRemove, (_event, { path, force }: { path: string; force?: boolean }) =>
    worktrees.remove(path, { force })
  )

  ipcMain.handle(IPC.handoffToPersonalAgent, async (_event, projectId: string | null) => {
    try {
      const config = parsePersonalAgent((key) => settings.get(key))
      if (!config) return { ok: false, sessionId: null, summoned: false, message: 'no personal agent configured' }
      const briefing = buildPaOversightBriefing(config.label)
      const candidates = sessions
        .list()
        .filter(
          (session) =>
            LEGACY_PERSONAL_AGENT_IDS.includes(session.presetId) && (session.projectId ?? null) === (projectId ?? null)
        )
      for (const candidate of candidates) {
        if (await hasSession(candidate.tmuxName).catch(() => false)) {
          await sendKeys(candidate.tmuxName, briefing)
          return { ok: true, sessionId: candidate.id, summoned: false }
        }
      }
      const project = projectId ? projects.getProject(projectId) : undefined
      const record = await sessions.spawn(PERSONAL_AGENT_PRESET_ID, project?.rootPath ?? homedir(), projectId, {
        openingPrompt: briefing,
        projectName: project?.name
      })
      notifySessions()
      return { ok: true, sessionId: record.id, summoned: true }
    } catch (error) {
      return { ok: false, sessionId: null, summoned: false, message: (error as Error).message }
    }
  })

  ipcMain.handle(IPC.activityFeed, () => activity.since(startOfDay()))
  ipcMain.handle(IPC.agentsStatus, () => agentSetup.probeAll())
  ipcMain.handle(IPC.paneHistory, async (_event, id: string) => {
    const session = sessions.get(id)
    return session ? capturePane(session.tmuxName, 5000).catch(() => '') : ''
  })
  ipcMain.handle(IPC.appVersion, () => {
    const version = app.getVersion()
    // Direct-file dev launches identify as the Electron binary; packaged builds already carry
    // the package version in app metadata.
    return !app.isPackaged && version === process.versions.electron ? packageJson.version : version
  })
  ipcMain.handle(IPC.usageReport, () => usage.report())
  ipcMain.handle(IPC.voiceStatus, () => voice.status())
  ipcMain.handle(IPC.voiceTranscribe, (_event, wav: ArrayBuffer) => voice.transcribe(Buffer.from(wav)))
  ipcMain.handle(IPC.settingsGet, (_event, key: string) => settings.get(key))
  const writeSetting = (key: string, value: string): void => {
    settings.set(key, value)
    // A usage-setting change (e.g. enabling the Claude Keychain card) must show up on the NEXT
    // poll, not after the 60s cache expires — bust it so the enable click reflects immediately.
    if (key.startsWith('usage.')) usage.invalidate()
    if (key === OPENCODE_MODELS_KEY) {
      presets.replaceFamily('opencode-', presetsFromModels(parseOpencodeModels(value)))
      notifyPresets()
    }
    if (key === CUSTOM_AGENTS_KEY) {
      presets.replaceFamily('custom-', presetsFromCustomAgents(parseCustomAgents(value)))
      notifyPresets()
    }
    if (Object.values(PA_KEYS).some((settingKey) => settingKey === key)) {
      reloadPersonalAgent()
      notifyPresets()
    }
    if (key === PROFILES_KEY || key.startsWith(MODEL_SETTING_PREFIX) || key.startsWith(EFFORT_SETTING_PREFIX)) {
      reloadProfiles()
      notifyPresets()
    }
  }
  control.installSettingsWriter(writeSetting)
  ipcMain.handle(IPC.settingsSet, (_event, { key, value }: { key: string; value: string }) => writeSetting(key, value))

  ipcMain.handle(IPC.presetList, () => presets.list())
  ipcMain.handle(IPC.projectList, () => projects.listProjects())
  ipcMain.handle(IPC.projectCreate, (_event, { name, rootPath }: { name: string; rootPath: string }) => {
    const root = expandHome(rootPath)
    if (!existsSync(root)) throw new Error(`Folder not found: ${root}`)
    if (!statSync(root).isDirectory()) throw new Error(`Not a folder: ${root}`)
    const project = projects.createProject(name.trim(), root)
    notifyProjects()
    return project
  })
  ipcMain.handle(IPC.projectOpen, async (_event, id: string) => {
    await sessions.reconcile()
    return { sessions: sessions.list().filter((session) => session.projectId === id) }
  })
  ipcMain.handle(IPC.projectDelete, async (_event, id: string, options?: { force?: boolean }) => {
    await sessions.reconcile()
    const result = projects.deleteProject(id, options)
    notifyProjects()
    return result
  })
  ipcMain.handle(IPC.dialogPickFolder, async () => {
    const window = BrowserWindow.getFocusedWindow()
    const options = { properties: ['openDirectory', 'createDirectory'] } as Electron.OpenDialogOptions
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.dialogPickImage, async () => {
    const window = BrowserWindow.getFocusedWindow()
    const options = {
      defaultPath: homedir(),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    } as Electron.OpenDialogOptions
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
}
