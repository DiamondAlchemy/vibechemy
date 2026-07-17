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

/** Read a Claude Code OAuth bearer from the macOS Keychain (authoritative on macOS; the
 *  ~/.claude/.credentials.json file has empty tokens). Read-only, never persisted, never logged. */
function readKeychainToken(execFile: UsageDeps['execFile'], service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'], (err, stdout) => {
      if (err) return resolve(null)
      try {
        resolve((JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken || null)
      } catch {
        resolve(null)
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
      const token = await readKeychainToken(d.execFile, CLAUDE_KEYCHAIN_SERVICE)
      if (!token) throw new Error('not signed in — use Sign in on this account in Settings → Agents')
      const res = await d.fetch(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, ...HEADERS } })
      if (res.status === 401) throw new Error('token expired — open a pane on this account to refresh')
      if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`)
      const body = (await res.json()) as ClaudeUsageBody
      return { plan: 'Claude Max', windows: parseClaudeUsage(body), health: null, note: null }
    }
  }
}
