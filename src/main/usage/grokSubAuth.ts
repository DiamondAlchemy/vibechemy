/**
 * SuperGrok / X Premium+ SUBSCRIPTION auth for Grok usage reads — no XAI_API_KEY.
 *
 * Rides the OAuth token the `grok` CLI stores at ~/.grok/auth.json (device-code sign-in via
 * auth.x.ai): a Bearer usable directly against the grok CLI's own billing endpoints. The refresh
 * recipe is a form-encoded POST to https://auth.x.ai/oauth2/token with grant_type=refresh_token,
 * the public grok CLI client_id, and the refresh_token. Rotated tokens are written back to
 * ~/.grok/auth.json (atomic, 0600) so the grok CLI stays in sync.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const GROK_AUTH = join(homedir(), '.grok', 'auth.json')
const XAI_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
// Public OAuth client id of the official grok CLI (embedded in the binary; also the auth.json
// session-key prefix). Not a secret. Validated against the stored oidc_client_id at read time.
const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const SKEW_S = 120 // refresh when <2 min of life remains

interface GrokSession {
  storeKey: string // the "<issuer>::<client>" key the session lives under in auth.json
  access: string
  refresh: string
}

/** JWT `exp` (epoch seconds) or 0 if undecodable. */
function jwtExp(token: string): number {
  try {
    const json = Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return (JSON.parse(json) as { exp?: number }).exp ?? 0
  } catch {
    return 0
  }
}

/** The grok CLI's stored session (its auth.json is keyed by "<issuer>::<client>"), or null. */
function readGrokSession(): GrokSession | null {
  try {
    const d = JSON.parse(readFileSync(GROK_AUTH, 'utf8')) as Record<string, unknown>
    for (const [storeKey, v] of Object.entries(d)) {
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        const access = typeof o.key === 'string' ? o.key : ''
        const refresh = typeof o.refresh_token === 'string' ? o.refresh_token : ''
        // Only ride the official grok client's session (guards against a hand-edited endpoint).
        const client = typeof o.oidc_client_id === 'string' ? o.oidc_client_id : XAI_CLIENT_ID
        if (access && client === XAI_CLIENT_ID) return { storeKey, access, refresh }
      }
    }
  } catch {
    /* not signed in to the grok CLI */
  }
  return null
}

/** Persist the rotated token back into ~/.grok/auth.json (preserve shape, atomic write, 0600). */
function writeBackGrok(storeKey: string, access: string, refresh: string, expiresIn?: number): void {
  try {
    const d = JSON.parse(readFileSync(GROK_AUTH, 'utf8')) as Record<string, Record<string, unknown>>
    const sess = d[storeKey]
    if (!sess || typeof sess !== 'object') return
    sess.key = access
    sess.refresh_token = refresh
    if (expiresIn) sess.expires_at = new Date(Date.now() + expiresIn * 1000).toISOString()
    const tmp = `${GROK_AUTH}.usage-tmp`
    writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 })
    renameSync(tmp, GROK_AUTH) // atomic on the same fs — the grok CLI never sees a half-written file
  } catch {
    /* best-effort — a failed writeback just forces the next refresh */
  }
}

/** Refresh the grok CLI session; returns the new access token (and writes it back), or null. */
async function refreshGrok(session: GrokSession): Promise<string | null> {
  if (!session.refresh) return null
  try {
    const res = await fetch(XAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: XAI_CLIENT_ID,
        refresh_token: session.refresh
      }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) return null
    const t = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!t.access_token) return null
    writeBackGrok(session.storeKey, t.access_token, t.refresh_token ?? session.refresh, t.expires_in)
    return t.access_token
  } catch {
    return null
  }
}

/**
 * A valid SuperGrok Bearer, or null if not signed in. Uses the grok CLI's token (refreshing it
 * if it's within the skew window).
 */
export async function grokSubToken(): Promise<string | null> {
  const session = readGrokSession()
  if (session) {
    if (jwtExp(session.access) - Date.now() / 1000 > SKEW_S) return session.access
    const fresh = await refreshGrok(session)
    if (fresh) return fresh
    // Refresh failed — the current token may still have a few seconds; better than nothing.
    if (jwtExp(session.access) - Date.now() / 1000 > 0) return session.access
  }
  return null
}
