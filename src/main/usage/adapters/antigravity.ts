import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageAdapter, UsageDeps } from '../types'
import { parseAntigravityQuota, type AntigravityQuotaBody } from '../parsers'

const KEYCHAIN_SERVICE = 'gemini'
const KEYCHAIN_ACCOUNT = 'antigravity'
const CODE_ASSIST = 'https://cloudcode-pa.googleapis.com'
// agy's installed-app OAuth client id — PUBLIC (ships in every agy binary), not secret-shaped.
const AGY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface AgToken {
  access: string
  refresh?: string
  expiry?: number
}

/** Read the Antigravity token from the macOS Keychain — a "go-keyring-base64:<b64>" blob wrapping
 *  JSON {token:{access_token,refresh_token,expiry}}. Read-only, never persisted/logged. */
function readAgToken(execFile: UsageDeps['execFile']): Promise<AgToken | null> {
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      (err, stdout) => {
        if (err) return resolve(null)
        try {
          const raw = stdout.trim().replace(/^go-keyring-base64:/, '')
          const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
            token?: { access_token?: string; refresh_token?: string; expiry?: string }
          }
          const access = json.token?.access_token
          if (!access) return resolve(null)
          const exp = json.token?.expiry ? Date.parse(json.token.expiry) : NaN
          resolve({ access, refresh: json.token?.refresh_token, expiry: Number.isNaN(exp) ? undefined : exp })
        } catch {
          resolve(null)
        }
      }
    )
  })
}

// The Keychain token lives ~1h and agy refreshes it in-memory (not always persisted back), so the
// app often reads a stale copy. We refresh it ourselves — with agy's OWN installed-app secret,
// EXTRACTED from the user's binary at runtime rather than committed here (installed-app secrets
// are public by OAuth design but secret-shaped). Google concatenates the two secrets in the
// binary, so we bound each GOCSPX to exactly 28 chars and try them all. Cached once per session.
let cachedSecrets: string[] | undefined
function agyClientSecrets(): string[] {
  if (cachedSecrets !== undefined) return cachedSecrets
  cachedSecrets = []
  try {
    const bin = realpathSync(join(homedir(), '.local', 'bin', 'agy'))
    const text = readFileSync(bin).toString('latin1')
    cachedSecrets = [...new Set(text.match(/GOCSPX-[A-Za-z0-9_-]{28}/g) ?? [])]
  } catch {
    /* binary not found → no refresh, fall back to "run agy" */
  }
  return cachedSecrets
}

/** Refresh a stale Antigravity access token via Google's OAuth endpoint, trying each extracted secret. */
async function refreshAgToken(fetchImpl: typeof fetch, refresh: string): Promise<string | null> {
  for (const secret of agyClientSecrets()) {
    try {
      const res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: AGY_CLIENT_ID,
          client_secret: secret,
          grant_type: 'refresh_token',
          refresh_token: refresh
        })
      })
      if (res.ok) return ((await res.json()) as { access_token?: string }).access_token ?? null
    } catch {
      /* try the next secret */
    }
  }
  return null
}

// cloudaicompanion project id + tier are stable per user — resolve once via loadCodeAssist, cache.
let cached: { project: string; plan: string | null } | null = null

/**
 * Antigravity (Google Code Assist) — per-model remaining quota from retrieveUserQuota. Reads the
 * Keychain token (opt-in gated); refreshes a stale ~1h token itself using agy's own creds so the
 * card stays live between agy runs.
 */
export function antigravityAdapter(): UsageAdapter {
  return {
    id: 'antigravity',
    label: 'Antigravity',
    burnId: null,
    available: true,
    optInKey: 'usage.antigravityKeychain',
    gated: (d) => d.getSetting('usage.antigravityKeychain') === 'on',
    async fetchRemaining(d: UsageDeps) {
      const tok = await readAgToken(d.execFile)
      if (!tok) throw new Error('Antigravity not signed in')
      let access = tok.access
      if (tok.expiry && tok.expiry <= d.now() + 60_000) {
        const fresh = tok.refresh ? await refreshAgToken(d.fetch, tok.refresh) : null
        if (!fresh) throw new Error('Antigravity token expired — run agy to refresh')
        access = fresh
      }
      const headers = { authorization: `Bearer ${access}`, 'content-type': 'application/json' }

      if (!cached) {
        const lc = await d.fetch(`${CODE_ASSIST}/v1internal:loadCodeAssist`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }
          })
        })
        if (lc.status === 401) throw new Error('Antigravity token expired — run agy to refresh')
        if (!lc.ok) throw new Error(`Code Assist HTTP ${lc.status}`)
        const b = (await lc.json()) as { cloudaicompanionProject?: string; currentTier?: { id?: string } }
        if (!b.cloudaicompanionProject) throw new Error('Antigravity: no project id')
        cached = { project: b.cloudaicompanionProject, plan: b.currentTier?.id ?? null }
      }

      const q = await d.fetch(`${CODE_ASSIST}/v1internal:retrieveUserQuota`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: cached.project })
      })
      if (q.status === 401) throw new Error('Antigravity token expired — run agy to refresh')
      if (!q.ok) throw new Error(`Code Assist quota HTTP ${q.status}`)
      const body = (await q.json()) as AntigravityQuotaBody
      return { plan: cached.plan, windows: parseAntigravityQuota(body), health: null, note: null }
    }
  }
}
