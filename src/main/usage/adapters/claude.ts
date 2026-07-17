import type { UsageAdapter, UsageDeps } from '../types'
import { parseClaudeUsage, type ClaudeUsageBody } from '../parsers'

// The exact call Claude Code's `/usage` makes. UA is required (Anthropic rejects a blank UA).
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const HEADERS = {
  'anthropic-beta': 'oauth-2025-04-20',
  'anthropic-version': '2023-06-01',
  'User-Agent': 'claude-cli/2.1.207 (external, cli)'
}

/** The Keychain service claude stores its main-login OAuth creds under. */
export const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'
export const CLAUDE_KEYCHAIN_OPT_IN_KEY = 'usage.claudeKeychain'

/** Read a Claude Code OAuth bearer from the macOS Keychain (authoritative on macOS when readable).
 *  Read-only, never persisted, never logged. `denied` distinguishes a BLOCKED read (the item's ACL
 *  only auto-allows the app that wrote it — another app's read needs the user's Always Allow) from
 *  the item simply not existing (`security` exits 44, errSecItemNotFound = not signed in). */
function readKeychainToken(
  execFile: UsageDeps['execFile'],
  service: string
): Promise<{ token: string | null; denied: boolean }> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'], (err, stdout) => {
      if (err) {
        const code = (err as { code?: unknown }).code
        return resolve({ token: null, denied: code !== 44 })
      }
      try {
        const token =
          (JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken || null
        resolve({ token, denied: false })
      } catch {
        resolve({ token: null, denied: false })
      }
    })
  })
}

/** Claude Code (Claude Max) — the 5h + weekly quota from api.anthropic.com/api/oauth/usage.
 *  GATED: reads the Keychain bearer, which crosses the app's detect-only boundary, so it only
 *  runs after the user opts in (the card offers a one-click Enable). */
export function claudeAdapter(): UsageAdapter {
  return {
    id: 'claude-code',
    label: 'Claude Code',
    burnId: 'claude-code',
    available: true,
    optInKey: CLAUDE_KEYCHAIN_OPT_IN_KEY,
    gated: (d) => d.getSetting(CLAUDE_KEYCHAIN_OPT_IN_KEY) === 'on',
    async fetchRemaining(d: UsageDeps) {
      const kc = await readKeychainToken(d.execFile, CLAUDE_KEYCHAIN_SERVICE)
      // Blocked Keychain fallback: claude's file store carries the real token on installs where
      // the Keychain was unavailable at login (seen live on a fresh second machine).
      const token = kc.token ?? d.readClaudeCredsFile().token
      if (!token)
        throw new Error(
          kc.denied
            ? 'Keychain read blocked — approve the macOS Keychain prompt (Always Allow), then retry'
            : 'not signed in — use Sign in on this account in Settings → Agents'
        )
      const res = await d.fetch(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, ...HEADERS } })
      if (res.status === 401) throw new Error('token expired — open a pane on this account to refresh')
      if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`)
      const body = (await res.json()) as ClaudeUsageBody
      return { plan: 'Claude Max', windows: parseClaudeUsage(body), health: null, note: null }
    }
  }
}
