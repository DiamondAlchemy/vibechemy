import { app, BrowserWindow, dialog, Menu, Notification, screen, session, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC, type SessionExitEvent } from '@shared/ipc'
import { CUSTOM_AGENTS_KEY, parseCustomAgents, presetsFromCustomAgents } from '@shared/agents/custom'
import { codexModelArgs, effortSettingKey, modelSettingKey } from '@shared/agents/models'
import { OPENCODE_MODELS_KEY, parseOpencodeModels, presetsFromModels } from '@shared/agents/opencode'
import { PROFILES_KEY, parseAgentProfiles } from '@shared/agents/profiles'
import { PERSONAL_AGENT_PRESET_ID, parsePersonalAgent, personalAgentPreset } from '@shared/agents/personalAgent'
import type { Preset } from '@shared/types'
import { ActivityLog } from './activity/ActivityLog'
import { createBootLogger } from './boot/bootLog'
import { resolveIdentity } from './boot/identity'
import { repairPath } from './boot/pathRepair'
import { ControlEventHub } from './control/ControlEventHub'
import { ControlPlane } from './control/ControlPlane'
import { openDatabase } from './db/database'
import { EventBus } from './events/EventBus'
import { MergeService } from './git/MergeService'
import { WorktreeService } from './git/WorktreeService'
import { registerIpc } from './ipc/handlers'
import { KnowledgeStore } from './knowledge/KnowledgeStore'
import { loadOrCreateToken, startMcpServer, type McpHandle } from './mcp/server'
import {
  codexOrchestratorPreset,
  fableOrchestratorPreset,
  grokOrchestratorPreset,
  opencodeOrchestratorPresets,
  orchestratorPreset,
  writeGrokOrchestratorHome,
  writeOpencodeOrchestratorConfig,
  writeOrchestratorConfig
} from './orchestrator/setup'
import { PresetRegistry } from './presets/PresetRegistry'
import { presetsFromProfiles } from './presets/profilePresets'
import { SEED_PRESETS } from './presets/seeds'
import { ProjectStore } from './projects/ProjectStore'
import { PtyBridge } from './sessions/PtyBridge'
import { SessionManager } from './sessions/SessionManager'
import { configureServer, hasTmux, setTmuxSocket } from './sessions/tmux'
import { SettingsStore } from './settings/SettingsStore'
import { StandardsStore } from './standards/StandardsStore'
import { seedStandards } from './standards/seed'

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow: BrowserWindow | null = null

function createWindow(initialBounds?: Partial<Electron.Rectangle>): void {
  mainWindow = new BrowserWindow({
    width: initialBounds?.width ?? 1280,
    height: initialBounds?.height ?? 820,
    x: initialBounds?.x,
    y: initialBounds?.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#000000',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const identity = resolveIdentity(app.isPackaged, process.env)
app.setPath('userData', join(app.getPath('appData'), identity.userDataDirName))
setTmuxSocket(identity.tmuxSocket)
repairPath()

const gotSingleInstanceLock = app.requestSingleInstanceLock()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }

  electronApp.setAppUserModelId('com.vibechemy.app')
  const bootLog = createBootLogger(join(app.getPath('userData'), 'boot.log'))
  bootLog({
    event: 'boot',
    version: app.getVersion(),
    packaged: app.isPackaged,
    exe: process.execPath,
    port: identity.mcpPort
  })

  // View is spelled out instead of the stock role because the stock viewMenu binds Cmd+= / Cmd+-
  // / Cmd+0 to Chromium PAGE zoom, which swallows those keys before the renderer sees them — and
  // the canvas semantic zoom (Overview/Default/Focus) owns them. Page-zooming a terminal cockpit
  // is never wanted anyway.
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  if (process.platform === 'darwin') menuTemplate.unshift({ role: 'appMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  if (!(await hasTmux())) {
    dialog.showErrorBox(
      'tmux required',
      'Vibechemy needs tmux to keep terminals alive.\n\nInstall it with:\n  brew install tmux\n\nThen relaunch.'
    )
    app.quit()
    return
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

  const db = openDatabase(join(app.getPath('userData'), 'vibechemy.sqlite'))
  const projects = new ProjectStore(db)
  const bus = new EventBus((event) => mainWindow?.webContents.send(IPC.mcEvent, event))
  const activity = new ActivityLog(db, undefined, () => bus.emit('activity'))
  const knowledge = new KnowledgeStore(db)
  const standards = new StandardsStore(db)
  seedStandards(standards)
  const settings = new SettingsStore(db)
  const eventHub = new ControlEventHub()

  const mcpPort = identity.mcpPort
  const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`
  const mcpTokenPath = join(app.getPath('userData'), 'mcp-token')
  const mcpToken = loadOrCreateToken(mcpTokenPath)

  const extraPresets: Preset[] = []
  const mcBaseDir = join(app.getPath('home'), '.vibechemy')
  let claudeMcpConfig: string | undefined
  try {
    const config = writeOrchestratorConfig(mcBaseDir, mcpToken, mcpUrl, identity.orchestratorDirName)
    claudeMcpConfig = config.mcpConfig
    extraPresets.push(orchestratorPreset(config.mcpConfig), fableOrchestratorPreset(config.mcpConfig))
  } catch (error) {
    console.error('[orchestrator] Claude setup failed:', error)
  }
  try {
    extraPresets.push(codexOrchestratorPreset(mcpToken, mcpUrl))
  } catch (error) {
    console.error('[orchestrator] Codex setup failed:', error)
  }
  try {
    const config = writeOpencodeOrchestratorConfig(mcBaseDir, mcpUrl, identity.orchestratorDirName)
    extraPresets.push(...opencodeOrchestratorPresets(mcpToken, config.config))
  } catch (error) {
    console.error('[orchestrator] OpenCode setup failed:', error)
  }
  try {
    const config = writeGrokOrchestratorHome(mcBaseDir, mcpToken, mcpUrl, identity.orchestratorDirName)
    extraPresets.push(grokOrchestratorPreset(config.grokHome))
  } catch (error) {
    console.error('[orchestrator] Grok setup failed:', error)
  }

  const presets = PresetRegistry.from([...SEED_PRESETS, ...extraPresets])
  const reloadPersonalAgent = (): void => {
    const config = parsePersonalAgent((key) => settings.get(key))
    presets.replaceFamily(PERSONAL_AGENT_PRESET_ID, config ? [personalAgentPreset(config)] : [])
  }
  reloadPersonalAgent()
  presets.replaceFamily('opencode-', presetsFromModels(parseOpencodeModels(settings.get(OPENCODE_MODELS_KEY))))
  presets.replaceFamily('custom-', presetsFromCustomAgents(parseCustomAgents(settings.get(CUSTOM_AGENTS_KEY))))

  const modelSetting = (family: 'claude' | 'codex', role: 'lead' | 'worker'): string | undefined =>
    settings.get(modelSettingKey(family, role))?.trim() || undefined
  const effortSetting = (family: 'claude' | 'codex', role: 'lead' | 'worker'): string | undefined =>
    settings.get(effortSettingKey(family, role))?.trim() || undefined
  const reloadProfiles = (): void => {
    if (claudeMcpConfig) {
      presets.replaceFamily(
        'profile-',
        presetsFromProfiles(parseAgentProfiles(settings.get(PROFILES_KEY)), {
          mcpConfigPath: claudeMcpConfig,
          baseDir: mcBaseDir,
          leadModel: modelSetting('claude', 'lead'),
          workerModel: modelSetting('claude', 'worker')
        })
      )
    }
    presets.replaceFamily('orchestrator-codex', [
      codexOrchestratorPreset(mcpToken, mcpUrl, {
        model: modelSetting('codex', 'lead'),
        effort: effortSetting('codex', 'lead')
      })
    ])
    const codexSeed = SEED_PRESETS.find((preset) => preset.id === 'codex')
    if (codexSeed) {
      presets.replaceFamily('codex', [
        {
          ...codexSeed,
          args: codexModelArgs(modelSetting('codex', 'worker'), effortSetting('codex', 'worker'))
        }
      ])
    }
  }
  reloadProfiles()

  const sessions = new SessionManager(db, presets, undefined, undefined, undefined, undefined, activity)
  const notifyExit = (id: string): void => {
    const event: SessionExitEvent = { id, expected: sessions.wasDeliberate(id) }
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(IPC.sessionExit, event)
  }
  const pty = new PtyBridge(
    (sessionId, data) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC.sessionData, { sessionId, data })
      }
    },
    (sessionId) => {
      void sessions
        .markExitedIfGone(sessionId)
        .then((died) => {
          if (died) notifyExit(sessionId)
        })
        .catch(() => {})
    }
  )
  const merge = new MergeService(sessions, pty, activity)
  const worktrees = new WorktreeService(projects, sessions)
  const notifySessions = (): void => bus.emit('sessions')
  const controlPlane = new ControlPlane(
    sessions,
    merge,
    projects,
    notifyExit,
    notifySessions,
    undefined,
    activity,
    knowledge,
    standards,
    settings,
    eventHub
  )

  registerIpc({
    presets,
    projects,
    sessions,
    pty,
    merge,
    worktrees,
    activity,
    settings,
    control: controlPlane,
    notifyExit,
    notifyProjects: () => bus.emit('projects'),
    notifySessions,
    notifyPresets: () => bus.emit('presets'),
    reloadProfiles,
    reloadPersonalAgent
  })

  await sessions.reconcile()
  await configureServer().catch(() => {})

  let mcp: McpHandle | undefined
  try {
    mcp = await startMcpServer({ cp: controlPlane, token: mcpToken, port: mcpPort })
    console.log(`[mcp] control plane on ${mcp.url} — token: ${mcpTokenPath}`)
    bootLog({ event: 'mcp', status: 'up', url: mcp.url })
  } catch (error) {
    console.error('[mcp] failed to start control plane:', error)
    bootLog({ event: 'mcp', status: 'failed', error: String(error) })
    if (Notification.isSupported()) {
      new Notification({
        title: 'Vibechemy — control plane offline',
        body: `Could not bind port ${mcpPort}. Orchestrators have no MCP until the app restarts.`
      }).show()
    }
  }

  app.on('before-quit', () => {
    void mcp?.stop()
    pty.disposeAll()
    bus.dispose()
  })

  let savedBounds: Partial<Electron.Rectangle> | undefined
  try {
    const raw = settings.get('window.bounds')
    if (raw) {
      const bounds = JSON.parse(raw) as Electron.Rectangle
      const display = screen.getDisplayMatching(bounds)
      if (display && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) savedBounds = bounds
    }
  } catch {
    // Invalid saved bounds fall back to the defaults.
  }
  createWindow(savedBounds)

  let boundsTimer: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) settings.set('window.bounds', JSON.stringify(mainWindow.getBounds()))
    }, 500)
  }
  mainWindow?.on('resize', saveBounds)
  mainWindow?.on('move', saveBounds)

  let lastReconcile = 0
  mainWindow?.on('focus', () => {
    const now = Date.now()
    if (now - lastReconcile < 5000) return
    lastReconcile = now
    void sessions.reconcile().catch((error) => console.error('[reconcile on focus]', error))
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
