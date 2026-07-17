import type { UsageAdapter, UsageDeps } from '../types'
import { parseKimiUsage, type KimiUsageBody } from '../parsers'

const USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
// The one credential failure the user can actually act on — shown for a failed refresh AND for
// a 401 that survives a forced refresh. Other HTTP statuses stay verbatim (genuinely unexpected).
const EXPIRED_MSG = 'Kimi token expired — open a Kimi pane or run: kimi login'

function refreshKimiCredential(d: UsageDeps): Promise<void> {
  return new Promise((resolve, reject) => {
    d.execFile(d.kimiBin(), ['provider', 'list', '--json'], { timeout: 12_000 }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function accessToken(d: UsageDeps, forceRefresh = false): Promise<string> {
  let auth = d.readKimiAuth()
  if (!auth) throw new Error('Kimi Code not signed in (run: kimi login)')

  const expiresSoon = auth.expiresAt !== null && auth.expiresAt <= Math.floor(d.now() / 1000) + 60
  if (forceRefresh || expiresSoon) {
    try {
      // Let Kimi's own non-model command own refresh-token rotation, file locking, and persistence.
      // Its provider listing initializes managed auth but does not make a model request.
      await refreshKimiCredential(d)
    } catch {
      throw new Error(EXPIRED_MSG)
    }
    auth = d.readKimiAuth()
    if (!auth) throw new Error('Kimi Code not signed in (run: kimi login)')
  }
  return auth.accessToken
}

async function fetchUsage(d: UsageDeps, token: string): Promise<Response> {
  return d.fetch(USAGE_URL, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
  })
}

/** Kimi Code — weekly + rolling 5h quota from the managed coding API's plural usages path. */
export function kimiAdapter(): UsageAdapter {
  return {
    id: 'kimi',
    label: 'Kimi Code',
    burnId: 'kimi',
    available: true,
    async fetchRemaining(d: UsageDeps) {
      let res = await fetchUsage(d, await accessToken(d))
      if (res.status === 401) res = await fetchUsage(d, await accessToken(d, true))
      // A 401 that survived a forced refresh means the credential is dead, not a transient fault.
      if (res.status === 401) throw new Error(EXPIRED_MSG)
      if (!res.ok) throw new Error(`Kimi Code usage HTTP ${res.status}`)
      const body = (await res.json()) as KimiUsageBody
      const windows = parseKimiUsage(body)
      if (windows.length === 0) throw new Error('Kimi Code usage returned no quota figures')
      // The response exposes an internal membership enum, not a stable user-facing tier name.
      return { plan: null, windows, health: null, note: null }
    }
  }
}
