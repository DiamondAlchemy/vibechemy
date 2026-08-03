import { randomBytes } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { basename, sep } from 'node:path'
import {
  MAX_ACTIVE_SHARES,
  SHARE_TTL_MS,
  isInsideDir,
  shareUrl,
  sweepExpired,
  type ShareRecord
} from '@shared/artifacts/share'

export interface ShareMint {
  ok: boolean
  url?: string
  token?: string
  expiresAt?: number
  message?: string
}

interface Deps {
  /** The configured artifacts dir, or null when unset. */
  artifactsDir: () => string | null
  /** Public origin the link must use, or null when remote access is unavailable. */
  publicOrigin: () => string | null
  clock?: () => number
  genToken?: () => string
  /** Injected for tests; production resolves symlinks so a link can never escape the artifacts dir. */
  resolve?: (p: string) => string
  statFile?: (p: string) => { isFile: () => boolean; size: number }
}

/**
 * Shares ONE artifact to another device as a short-lived secret link.
 *
 * The receiving device is unpaired, so the token in the URL is the whole credential. Three
 * guards make that acceptable, all enforced here at MINT time rather than at fetch time:
 *   - the file must resolve (symlinks included) to somewhere INSIDE the artifacts dir,
 *   - the link dies after SHARE_TTL_MS and can be revoked instantly,
 *   - at most MAX_ACTIVE_SHARES are live, so nothing can bulk-publish a folder.
 * The fetch handler then only ever looks a token up in this map — it never accepts a path.
 */
export class ShareService {
  private records: ShareRecord[] = []
  private readonly clock: () => number
  private readonly genToken: () => string
  private readonly resolve: (p: string) => string
  private readonly statFile: (p: string) => { isFile: () => boolean; size: number }

  constructor(private deps: Deps) {
    this.clock = deps.clock ?? Date.now
    this.genToken = deps.genToken ?? ((): string => randomBytes(32).toString('hex'))
    this.resolve = deps.resolve ?? realpathSync
    this.statFile = deps.statFile ?? statSync
  }

  /** Mint a link for one artifact. Returns an honest refusal rather than a broken link. */
  mint(filePath: string): ShareMint {
    const now = this.clock()
    this.records = sweepExpired(this.records, now)

    const dir = this.deps.artifactsDir()
    if (!dir) return { ok: false, message: 'No artifacts directory is set.' }

    const origin = this.deps.publicOrigin()
    if (!origin)
      return {
        ok: false,
        message:
          'Remote access is unavailable in this Vibechemy build. Configure a public remote-access origin to share a link.'
      }

    let resolvedFile: string
    let resolvedDir: string
    try {
      resolvedFile = this.resolve(filePath)
      resolvedDir = this.resolve(dir)
    } catch {
      return { ok: false, message: 'That file no longer exists.' }
    }
    // Containment is checked on the RESOLVED paths, so a symlink inside the artifacts dir
    // cannot be used to publish something outside it.
    if (!isInsideDir(resolvedFile, resolvedDir, sep))
      return { ok: false, message: 'Only files inside the artifacts directory can be shared.' }

    try {
      if (!this.statFile(resolvedFile).isFile()) return { ok: false, message: 'Only regular files can be shared.' }
    } catch {
      return { ok: false, message: 'That file no longer exists.' }
    }

    if (this.records.length >= MAX_ACTIVE_SHARES)
      return { ok: false, message: `Too many active share links (${MAX_ACTIVE_SHARES}). Revoke one first.` }

    // Re-sharing the same file replaces its link rather than accumulating duplicates.
    this.records = this.records.filter((r) => r.path !== resolvedFile)
    const token = this.genToken()
    const rec: ShareRecord = {
      token,
      path: resolvedFile,
      filename: basename(resolvedFile),
      createdAt: now,
      expiresAt: now + SHARE_TTL_MS
    }
    this.records.push(rec)
    return { ok: true, token, url: shareUrl(origin, token), expiresAt: rec.expiresAt }
  }

  /** The fetch path: token → record, or null when unknown/expired. Never accepts a path. */
  resolveToken(token: string): ShareRecord | null {
    const now = this.clock()
    this.records = sweepExpired(this.records, now)
    return this.records.find((r) => r.token === token) ?? null
  }

  revoke(token: string): boolean {
    const before = this.records.length
    this.records = this.records.filter((r) => r.token !== token)
    return this.records.length !== before
  }

  /** Live links (for the UI) — newest first. */
  active(): ShareRecord[] {
    this.records = sweepExpired(this.records, this.clock())
    return [...this.records].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Kill every link — used on quit and when remote access is switched off. */
  revokeAll(): void {
    this.records = []
  }
}
