import { describe, it, expect } from 'vitest'
import { ShareService } from './ShareService'
import { MAX_ACTIVE_SHARES, SHARE_TTL_MS } from '@shared/artifacts/share'

const ORIGIN = 'https://calm-fox.trycloudflare.com'

function build(opts?: {
  dir?: string | null
  origin?: string | null
  now?: () => number
  files?: string[]
}): ShareService {
  let n = 0
  const files = new Set(opts?.files ?? ['/art/report.pdf', '/art/sub/hero.png', '/etc/passwd'])
  const svc = new ShareService({
    artifactsDir: () => (opts?.dir === undefined ? '/art' : opts.dir),
    publicOrigin: () => (opts?.origin === undefined ? ORIGIN : opts.origin),
    clock: opts?.now ?? ((): number => 1000),
    genToken: () => String(++n).padStart(64, '0'),
    // Identity resolve, except a symlink that escapes the artifacts dir.
    resolve: (p: string) => {
      if (p === '/art/escape-link') return '/etc/passwd'
      if (!files.has(p) && p !== '/art') throw new Error('ENOENT')
      return p
    },
    statFile: (p: string) => ({ isFile: () => p !== '/art/adir', size: 10 })
  })
  return svc
}

describe('ShareService.mint', () => {
  it('mints a link for a real artifact and resolves it back by token', () => {
    const svc = build()
    const m = svc.mint('/art/report.pdf')
    expect(m.ok).toBe(true)
    expect(m.url).toBe(`${ORIGIN}/share/${m.token}`)
    expect(m.expiresAt).toBe(1000 + SHARE_TTL_MS)
    const rec = svc.resolveToken(m.token!)
    expect(rec?.path).toBe('/art/report.pdf')
    expect(rec?.filename).toBe('report.pdf')
  })

  it('REFUSES anything outside the artifacts dir, including via a symlink', () => {
    const svc = build()
    expect(svc.mint('/etc/passwd').ok).toBe(false)
    const viaLink = svc.mint('/art/escape-link') // resolves to /etc/passwd
    expect(viaLink.ok).toBe(false)
    expect(viaLink.message).toContain('inside the artifacts directory')
  })

  it('refuses when remote access is unavailable, or no artifacts dir is set, with an honest message', () => {
    expect(build({ origin: null }).mint('/art/report.pdf').message).toContain('Remote access is unavailable')
    expect(build({ dir: null }).mint('/art/report.pdf').message).toContain('No artifacts directory')
  })

  it('refuses a vanished file and a non-regular file', () => {
    const svc = build()
    expect(svc.mint('/art/gone.pdf').message).toContain('no longer exists')
  })

  it('re-sharing the same file replaces its link instead of piling up', () => {
    const svc = build()
    const a = svc.mint('/art/report.pdf')
    const b = svc.mint('/art/report.pdf')
    expect(a.token).not.toBe(b.token)
    expect(svc.active()).toHaveLength(1)
    expect(svc.resolveToken(a.token!)).toBeNull() // the old link is dead immediately
    expect(svc.resolveToken(b.token!)).not.toBeNull()
  })

  it('caps concurrent links so nothing can bulk-publish a folder', () => {
    const files = Array.from({ length: MAX_ACTIVE_SHARES + 5 }, (_, i) => `/art/f${i}.png`)
    const svc = build({ files })
    for (let i = 0; i < MAX_ACTIVE_SHARES; i++) expect(svc.mint(`/art/f${i}.png`).ok).toBe(true)
    const over = svc.mint(`/art/f${MAX_ACTIVE_SHARES}.png`)
    expect(over.ok).toBe(false)
    expect(over.message).toContain('Too many active share links')
  })
})

describe('ShareService lifetime', () => {
  it('a token stops resolving once it expires', () => {
    let now = 1000
    const svc = build({ now: () => now })
    const m = svc.mint('/art/report.pdf')
    expect(svc.resolveToken(m.token!)).not.toBeNull()
    now = 1000 + SHARE_TTL_MS
    expect(svc.resolveToken(m.token!)).toBeNull()
    expect(svc.active()).toHaveLength(0)
  })

  it('revoke kills one link immediately; revokeAll clears everything', () => {
    const svc = build()
    const a = svc.mint('/art/report.pdf')
    const b = svc.mint('/art/sub/hero.png')
    expect(svc.revoke(a.token!)).toBe(true)
    expect(svc.revoke(a.token!)).toBe(false) // already gone
    expect(svc.resolveToken(a.token!)).toBeNull()
    expect(svc.resolveToken(b.token!)).not.toBeNull()
    svc.revokeAll()
    expect(svc.active()).toHaveLength(0)
  })

  it('an unknown token never resolves', () => {
    const svc = build()
    expect(svc.resolveToken('f'.repeat(64))).toBeNull()
  })
})
