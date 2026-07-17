import type { Project, Preset, SessionRecord } from './types'

export const IPC = {
  sessionSpawn: 'session:spawn',
  sessionList: 'session:list',
  sessionListAll: 'session:list-all', // ALL projects' sessions (session:list with null = Scratch, NOT all)
  sessionKill: 'session:kill',
  sessionRevive: 'session:revive',
  orchestratorsClosed: 'orchestrator:closed',
  orchestratorReopen: 'orchestrator:reopen',
  orchestratorReopenDismiss: 'orchestrator:reopen-dismiss',
  paneContextMenu: 'pane:context-menu',
  paneCancelCopyMode: 'pane:cancel-copy-mode', // exit tmux copy-mode on a pane (the focusing-click un-stick)
  sessionRename: 'session:rename',
  paneType: 'pane:type',
  sessionDetach: 'session:detach',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionAttach: 'session:attach',
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  mcEvent: 'mc:event',
  presetList: 'preset:list',
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectOpen: 'project:open',
  projectDelete: 'project:delete',
  dialogPickFolder: 'dialog:pick-folder',
  dialogPickImage: 'dialog:pick-image',
  sessionDiff: 'session:diff',
  sessionMerge: 'session:merge',
  sessionDiscard: 'session:discard',
  worktreeLeftovers: 'worktree:leftovers',
  worktreesList: 'worktrees:list',
  worktreesRemove: 'worktrees:remove',
  handoffToPersonalAgent: 'activity:handoff-personal-agent',
  activityFeed: 'activity:feed',
  agentsStatus: 'agents:status', // probe installed/authed state of every agent CLI family
  paneHistory: 'session:history',
  appVersion: 'app:version', // package.json version via app.getVersion() → the titlebar "vX.Y"
  voiceStatus: 'voice:status', // honest on-device speech recognition availability
  voiceTranscribe: 'voice:transcribe', // mono PCM16 WAV ArrayBuffer → local transcript
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  usageReport: 'usage:report' // per-agent remaining plan usage (quota left) → UsageReport
} as const

export interface SessionDataMsg {
  sessionId: string
  data: string
  /** Unique renderer viewer generation; stale attach clients can never write into a replacement xterm. */
  viewerId: string
}

export interface SessionExitEvent {
  id: string
  /** true = deliberate end (UI close / merge / discard); false = the CLI died on its own. */
  expected: boolean
}

export interface DiffResult {
  ok: boolean
  diff: string
  files: number
  message?: string
}

export interface MergeResult {
  ok: boolean
  conflict?: boolean
  message: string
  mergedInto?: string
}

/** Honest on-device speech-recognition state for Settings and push-to-talk. */
export interface VoiceStatus {
  available: boolean
  engine?: string
  model?: string
  modelPath?: string
  modelInstalled?: boolean
  reason?: string
  /** Shell-safe command for the visible model-download pane. */
  downloadCommand?: string
}

export type { Project, Preset, SessionRecord }
