import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '@shared/ipc'
import type { DiffResult, MergeResult, SessionDataMsg, SessionExitEvent } from '@shared/ipc'
import type { McEvent } from '@shared/events'
import type { AgentStatus } from '@shared/agents/catalog'
import type { ActivityEvent, Preset, Project, SessionRecord, WorktreeEntry } from '@shared/types'

type HandoffResult = { ok: boolean; sessionId: string | null; summoned: boolean; message?: string }

const api = {
  spawnSession: (presetId: string, projectId: string | null, isolate = false, cwd?: string): Promise<SessionRecord> =>
    ipcRenderer.invoke(IPC.sessionSpawn, { presetId, projectId, isolate, cwd }),
  listSessions: (projectId: string | null): Promise<SessionRecord[]> => ipcRenderer.invoke(IPC.sessionList, projectId),
  killSession: (id: string): Promise<void> => ipcRenderer.invoke(IPC.sessionKill, id),
  reviveSession: (id: string): Promise<{ ok: boolean; message?: string; newId?: string }> =>
    ipcRenderer.invoke(IPC.sessionRevive, id),
  orchestratorsClosed: (): Promise<SessionRecord[]> => ipcRenderer.invoke(IPC.orchestratorsClosed),
  reopenOrchestrator: (id: string): Promise<{ ok: boolean; message?: string; newId?: string }> =>
    ipcRenderer.invoke(IPC.orchestratorReopen, id),
  dismissClosedOrchestrator: (id: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.orchestratorReopenDismiss, id),
  renameSession: (
    id: string,
    patch: { title?: string; callsign?: string }
  ): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke(IPC.sessionRename, { id, ...patch }),
  paneType: (id: string, text: string, submit: boolean): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.paneType, { id, text, submit }),
  paneContextMenu: (selection: string): void => ipcRenderer.send(IPC.paneContextMenu, selection),
  paneCancelCopyMode: (id: string): void => ipcRenderer.send(IPC.paneCancelCopyMode, id),
  attach: (id: string, cols: number, rows: number, viewerId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionAttach, { id, cols, rows, viewerId }),
  detach: (id: string): Promise<void> => ipcRenderer.invoke(IPC.sessionDetach, id),
  write: (id: string, data: string): void => ipcRenderer.send(IPC.sessionWrite, { id, data }),
  resize: (id: string, cols: number, rows: number): void => ipcRenderer.send(IPC.sessionResize, { id, cols, rows }),
  onData: (cb: (msg: SessionDataMsg) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: SessionDataMsg): void => cb(msg)
    ipcRenderer.on(IPC.sessionData, handler)
    return () => ipcRenderer.removeListener(IPC.sessionData, handler)
  },
  onExit: (cb: (event: SessionExitEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ev: SessionExitEvent): void => cb(ev)
    ipcRenderer.on(IPC.sessionExit, handler)
    return () => ipcRenderer.removeListener(IPC.sessionExit, handler)
  },
  onMcEvent: (cb: (event: McEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ev: McEvent): void => cb(ev)
    ipcRenderer.on(IPC.mcEvent, handler)
    return () => ipcRenderer.removeListener(IPC.mcEvent, handler)
  },
  listPresets: (): Promise<Preset[]> => ipcRenderer.invoke(IPC.presetList),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke(IPC.projectList),
  createProject: (name: string, rootPath: string): Promise<Project> =>
    ipcRenderer.invoke(IPC.projectCreate, { name, rootPath }),
  openProject: (id: string): Promise<{ sessions: SessionRecord[] }> => ipcRenderer.invoke(IPC.projectOpen, id),
  deleteProject: (id: string, opts?: { force?: boolean }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.projectDelete, id, opts),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickFolder),
  pickImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickImage),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  clipboardWriteText: (text: string): void => clipboard.writeText(text),
  sessionDiff: (id: string): Promise<DiffResult> => ipcRenderer.invoke(IPC.sessionDiff, id),
  sessionMerge: (id: string): Promise<MergeResult> => ipcRenderer.invoke(IPC.sessionMerge, id),
  sessionDiscard: (id: string): Promise<MergeResult> => ipcRenderer.invoke(IPC.sessionDiscard, id),
  listLeftovers: (projectId: string | null): Promise<SessionRecord[]> =>
    ipcRenderer.invoke(IPC.worktreeLeftovers, projectId),
  listWorktrees: (): Promise<WorktreeEntry[]> => ipcRenderer.invoke(IPC.worktreesList),
  removeWorktree: (path: string, force = false): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.worktreesRemove, { path, force }),
  handoffToPersonalAgent: (projectId: string | null): Promise<HandoffResult> =>
    ipcRenderer.invoke(IPC.handoffToPersonalAgent, projectId),
  agentsStatus: (): Promise<AgentStatus[]> => ipcRenderer.invoke(IPC.agentsStatus),
  activityFeed: (): Promise<ActivityEvent[]> => ipcRenderer.invoke(IPC.activityFeed),
  paneHistory: (id: string): Promise<string> => ipcRenderer.invoke(IPC.paneHistory, id),
  getSetting: (key: string): Promise<string | null> => ipcRenderer.invoke(IPC.settingsGet, key),
  setSetting: (key: string, value: string): Promise<void> => ipcRenderer.invoke(IPC.settingsSet, { key, value })
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const exposed = window as unknown as { electron: typeof electronAPI; api: typeof api }
  exposed.electron = electronAPI
  exposed.api = api
}

export type Api = typeof api
