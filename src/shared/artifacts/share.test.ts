import { describe, it, expect } from 'vitest'
import {
  isShareToken,
  tokenFromPath,
  isExpired,
  sweepExpired,
  isInsideDir,
  contentDisposition,
  shareUrl,
  expiresInLabel,
  SHARE_TTL_MS,
  type ShareRecord
} from './share'

const rec = (over: Partial<ShareRecord> = {}): ShareRecord => ({
  token: 'a'.repeat(64),
  path: '/art/report.pdf',
  filename: 'report.pdf',
  createdAt: 0,
  expiresAt: SHARE_TTL_MS,
  ...over
})

describe('isShareToken / tokenFromPath', () => {
  it('accepts only 64-char hex', () => {
    expect(isShareToken('a'.repeat(64))).toBe(true)
    expect(isShareToken('A'.repeat(64))).toBe(false) // uppercase is not what randomBytes.hex emits
    expect(isShareToken('a'.repeat(63))).toBe(false)
    expect(isShareToken('z'.repeat(64))).toBe(false)
    expect(isShareToken(null)).toBe(false)
  })
  it('extracts a token only from an exactly-shaped path', () => {
    const t = 'b'.repeat(64)
    expect(tokenFromPath(`/share/${t}`)).toBe(t)
    expect(tokenFromPath(`/share/${t}/extra`)).toBeNull()
    expect(tokenFromPath('/share/')).toBeNull()
    expect(tokenFromPath('/share/../../etc/passwd')).toBeNull() // traversal can never parse as a token
    expect(tokenFromPath('/mcp')).toBeNull()
  })
})

describe('expiry', () => {
  it('expires exactly at the deadline and sweeps the dead ones', () => {
    const r = rec({ expiresAt: 1000 })
    expect(isExpired(r, 999)).toBe(false)
    expect(isExpired(r, 1000)).toBe(true)
    const list = [rec({ token: 'a'.repeat(64), expiresAt: 500 }), rec({ token: 'c'.repeat(64), expiresAt: 5000 })]
    expect(sweepExpired(list, 1000).map((x) => x.expiresAt)).toEqual([5000])
  })
  it('labels the remaining time and says expired at zero', () => {
    expect(expiresInLabel(90_000, 0)).toBe('1m 30s')
    expect(expiresInLabel(9_000, 0)).toBe('9s')
    expect(expiresInLabel(1000, 5000)).toBe('expired')
  })
})

describe('isInsideDir — only artifacts may ever be shared', () => {
  it('accepts real descendants', () => {
    expect(isInsideDir('/art/report.pdf', '/art')).toBe(true)
    expect(isInsideDir('/art/sub/deep.png', '/art/')).toBe(true)
  })
  it('rejects escapes, siblings, and the dir itself', () => {
    expect(isInsideDir('/etc/passwd', '/art')).toBe(false)
    expect(isInsideDir('/artifacts-evil/x', '/art')).toBe(false) // prefix trap
    expect(isInsideDir('/art', '/art')).toBe(false)
    expect(isInsideDir('', '/art')).toBe(false)
  })
})

describe('contentDisposition', () => {
  it('neutralizes quotes/controls in the quoted name but keeps the real one in filename*', () => {
    const h = contentDisposition('quarterly "report".pdf')
    expect(h).toContain('attachment;')
    expect(h.split('filename*')[0]).not.toContain('"report"')
    expect(h).toContain(encodeURIComponent('quarterly "report".pdf'))
  })
  it('survives unicode and empty names', () => {
    expect(contentDisposition('café ☕.png')).toContain("filename*=UTF-8''")
    expect(contentDisposition('')).toContain('artifact')
  })
})

describe('shareUrl', () => {
  it('joins without doubling slashes', () => {
    const t = 'd'.repeat(64)
    expect(shareUrl('https://x.trycloudflare.com', t)).toBe(`https://x.trycloudflare.com/share/${t}`)
    expect(shareUrl('https://x.trycloudflare.com/', t)).toBe(`https://x.trycloudflare.com/share/${t}`)
  })
})
