/**
 * Pure logic for sharing one artifact to another device.
 *
 * The model is a SECRET LINK: the token in the URL *is* the credential, because the receiving
 * device (a phone, someone else's laptop) is not paired and has no token of its own. That makes
 * three properties load-bearing, and they live here so they are testable:
 *   1. the token must be unguessable (32 random bytes, hex — supplied by the caller),
 *   2. it must expire quickly (a share is a hand-off, not hosting),
 *   3. it must name ONE already-resolved file — a share never carries a caller-supplied path,
 *      so there is no traversal surface at fetch time by construction.
 */

export interface ShareRecord {
  token: string
  /** Absolute path, already validated as inside the artifacts dir at mint time. */
  path: string
  /** Basename shown to the downloader. */
  filename: string
  createdAt: number
  expiresAt: number
}

/** A share is a hand-off, not hosting — long enough to walk to another desk, short enough to forget. */
export const SHARE_TTL_MS = 15 * 60 * 1000

/** Bound how many links can be live at once, so a runaway loop can't publish an entire folder. */
export const MAX_ACTIVE_SHARES = 20

export const SHARE_ROUTE_PREFIX = '/share/'

/** Tokens are hex from randomBytes(32); anything else is a malformed/hostile request. */
export function isShareToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
}

/** Pull the token out of a request path, or null when the shape doesn't match exactly. */
export function tokenFromPath(reqPath: string): string | null {
  if (typeof reqPath !== 'string' || !reqPath.startsWith(SHARE_ROUTE_PREFIX)) return null
  const rest = reqPath.slice(SHARE_ROUTE_PREFIX.length)
  return isShareToken(rest) ? rest : null
}

export function isExpired(rec: Pick<ShareRecord, 'expiresAt'>, now: number): boolean {
  return now >= rec.expiresAt
}

/** Drop expired records. Returns a NEW array — callers replace their list wholesale. */
export function sweepExpired(records: ShareRecord[], now: number): ShareRecord[] {
  return records.filter((r) => !isExpired(r, now))
}

/**
 * Is `filePath` inside `dir`? Mint-time containment check so only artifacts can ever be shared —
 * a renderer (or a compromised caller) cannot hand us /etc/passwd. Both inputs must already be
 * absolute and symlink-resolved by the caller; this is the pure comparison half.
 */
export function isInsideDir(filePath: string, dir: string, sep = '/'): boolean {
  if (!filePath || !dir) return false
  const base = dir.endsWith(sep) ? dir.slice(0, -sep.length) : dir
  return filePath === base ? false : filePath.startsWith(base + sep)
}

/**
 * Content-Disposition filename. Quotes and control characters would let a filename break out of
 * the header, so the quoted form is stripped to a safe subset and the real name rides the
 * RFC 5987 `filename*` parameter where UTF-8 is legal.
 */
export function contentDisposition(filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'artifact'
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** The link handed to the other device. `base` is the public origin (no trailing slash). */
export function shareUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}${SHARE_ROUTE_PREFIX}${token}`
}

/** Human countdown for the UI — the operator must see that the link dies. */
export function expiresInLabel(expiresAt: number, now: number): string {
  const left = Math.max(0, expiresAt - now)
  if (left === 0) return 'expired'
  const mins = Math.floor(left / 60000)
  const secs = Math.floor((left % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}
