import type { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process'
import type { UsageRemaining } from '@shared/types'

/** Injected I/O so every adapter is testable behind fakes — no real network, process, or Keychain
 *  in unit tests. */
export interface UsageDeps {
  fetch: typeof fetch
  spawn: typeof nodeSpawn
  execFile: typeof nodeExecFile
  grokSubToken: () => Promise<string | null>
  /** ~/.local/share/opencode/auth.json (chmod 600) parsed — the same file OpenCode itself uses. */
  readOpencodeAuth: () => Record<string, { key?: string }>
  /** Current Kimi Code OAuth bearer metadata. The adapter may ask the official Kimi CLI to refresh
   *  an expiring token, then re-read this source; the app never rotates the token itself. */
  readKimiAuth: () => { accessToken: string; expiresAt: number | null } | null
  /** Resolved `kimi` CLI command for the refresh spawn — an absolute path when installed in a
   *  known location, else the bare name (the packaged GUI app's PATH lacks /opt/homebrew/bin). */
  kimiBin: () => string
  /** Read a settings value — used by Keychain-reading adapters (Claude, Antigravity) to check
   *  their explicit opt-in gate before touching a credential store. */
  getSetting: (key: string) => string | null
  /** ~/.claude/.credentials.json parsed (main login only). Where the Keychain owns the creds the
   *  file exists with empty tokens; where the Keychain was unavailable at login claude writes the
   *  real token here — the fallback source when a cross-app Keychain read is blocked. */
  readClaudeCredsFile: () => { exists: boolean; token: string | null }
  now: () => number
}

/** One provider's remaining-usage source. `available:false` = no source at all (NO SOURCE YET);
 *  `gated` = a source exists but is behind an explicit opt-in (Claude Keychain). `fetchRemaining`
 *  may throw → the service turns it into an explicit error row (never silent zeros). */
export interface UsageAdapter {
  id: string
  label: string
  burnId: string | null
  available: boolean
  gated?: (d: UsageDeps) => boolean
  /** The setting key the panel's Enable button flips when this adapter is opt-in gated. */
  optInKey?: string
  fetchRemaining(d: UsageDeps): Promise<UsageRemaining>
}
