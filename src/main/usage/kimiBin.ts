import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Common install locations for the `kimi` CLI (usage-adapter token refresh). */
export const KIMI_BIN_CANDIDATES = [
  '/opt/homebrew/bin/kimi',
  '/usr/local/bin/kimi',
  join(homedir(), '.local', 'bin', 'kimi'),
  // The official code.kimi.com installer's default target (brew/npm never use it).
  join(homedir(), '.kimi-code', 'bin', 'kimi')
]

/**
 * Resolve the first existing `kimi` binary path. The packaged GUI app's PATH lacks
 * /opt/homebrew/bin, so a bare `kimi` there would ENOENT — probe absolute locations first and
 * fall back to the bare name (dev shells resolve it) instead of null: the caller already turns
 * a failed launch into an actionable sign-in error.
 */
export function findKimiBin(): string {
  for (const p of KIMI_BIN_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return 'kimi'
}
