import { watch, existsSync, type FSWatcher } from 'node:fs'
import type { SettingsStore } from '../settings/SettingsStore'
import type { ArtifactList } from '@shared/types'
import { scanArtifacts } from './scanArtifacts'

export const ARTIFACTS_DIR_KEY = 'artifacts.dir'

/** The single source for artifact listing — reads the configured dir and scans it. Also owns an
 *  optional fs.watch on that dir so the UI can auto-refresh instead of relying on the manual refresh. */
export class ArtifactsService {
  constructor(private settings: SettingsStore) {}

  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private onChange?: () => void
  private debounceMs = 300

  list(): ArtifactList {
    const dir = this.settings.get(ARTIFACTS_DIR_KEY)
    if (!dir) return { dir: null, files: [] }
    return { dir, files: scanArtifacts(dir) }
  }

  /**
   * Watch the configured artifacts dir and call `onChange` (trailing-debounced) on any change, so
   * the panel can refresh itself. Recursive — artifacts can live in subdirs. Best-effort: a missing
   * or unset dir simply arms nothing. Call `retarget()` after the dir setting changes.
   */
  startWatching(onChange: () => void, debounceMs = 300): void {
    this.onChange = onChange
    this.debounceMs = debounceMs
    this.arm()
  }

  /** Re-point the watcher at the (possibly new) configured dir — call when artifacts.dir changes. */
  retarget(): void {
    if (this.onChange) this.arm()
  }

  stopWatching(): void {
    this.disarm()
    this.onChange = undefined
  }

  private arm(): void {
    this.disarm()
    const dir = this.settings.get(ARTIFACTS_DIR_KEY)
    if (!dir || !existsSync(dir)) return
    try {
      this.watcher = watch(dir, { recursive: true }, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => this.onChange?.(), this.debounceMs)
      })
    } catch {
      /* watch unsupported / dir vanished — leave the manual refresh as the fallback */
    }
  }

  private disarm(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}
