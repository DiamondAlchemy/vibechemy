import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateReadyMsg } from '@shared/ipc'

/**
 * Auto-update against the GitHub Releases feed (publish config in electron-builder.yml).
 * Packaged builds only — dev / from-source runs never check. Updates download in the
 * background; nothing restarts on its own. The renderer shows a "restart to update" chip
 * (agents may be mid-task, so applying is always the human's call) and the update also
 * applies on the next natural quit via autoInstallOnAppQuit.
 */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    const w = getWindow()
    if (w && !w.webContents.isDestroyed()) {
      const msg: UpdateReadyMsg = { version: info.version }
      w.webContents.send(IPC.updatesReady, msg)
    }
  })
  autoUpdater.on('error', (err) => {
    // Offline / rate-limited / no published release yet — routine, never user-facing.
    console.error('[updates] check failed:', err instanceof Error ? err.message : String(err))
  })

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }
  // First check waits out the boot burst (terminal re-attach storms own the first seconds).
  const first = setTimeout(check, 30_000)
  first.unref?.()
  const recurring = setInterval(check, 12 * 60 * 60 * 1000)
  recurring.unref?.()
}

/** Apply the staged update now (renderer chip → IPC). No-op if nothing is staged. */
export function installUpdateNow(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch (err) {
    console.error('[updates] install failed:', err instanceof Error ? err.message : String(err))
  }
}
