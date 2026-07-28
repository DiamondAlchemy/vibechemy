import { describe, it, expect } from 'vitest'
import { parseMacFeed, pickZipAsset, assetUrl } from './lib.mjs'

const FEED = `version: 1.0.0
files:
  - url: vibechemy-1.0.0-arm64.zip
    sha512: q1w2e3r4t5==
    size: 238000000
  - url: vibechemy-1.0.0-arm64.dmg
    sha512: a1s2d3f4g5==
    size: 240000000
path: vibechemy-1.0.0-arm64.zip
sha512: q1w2e3r4t5==
releaseDate: '2026-07-28T12:00:00.000Z'
`

describe('parseMacFeed', () => {
  it('parses version and file entries with checksums', () => {
    const feed = parseMacFeed(FEED)
    expect(feed).not.toBeNull()
    expect(feed.version).toBe('1.0.0')
    expect(feed.files).toHaveLength(2)
    expect(feed.files[0]).toEqual({ url: 'vibechemy-1.0.0-arm64.zip', sha512: 'q1w2e3r4t5==', size: 238000000 })
  })

  it('returns null on garbage, empties, and feeds without checksums', () => {
    expect(parseMacFeed('')).toBeNull()
    expect(parseMacFeed('not: a\nfeed: at-all\n')).toBeNull()
    expect(parseMacFeed('version: 1.0.0\nfiles:\n  - url: a.zip\n')).toBeNull() // no sha512 → refuse
    expect(parseMacFeed(null)).toBeNull()
    expect(parseMacFeed('x'.repeat(1_100_000))).toBeNull() // absurd size → refuse
  })

  it('does not let a later top-level key bleed entries into files', () => {
    const feed = parseMacFeed('version: 2.0.0\nfiles:\n  - url: a-arm64.zip\n    sha512: abc=\npath: a-arm64.zip\n')
    expect(feed.files).toHaveLength(1)
  })
})

describe('pickZipAsset', () => {
  it('prefers the arch-matching zip and ignores the dmg', () => {
    const feed = parseMacFeed(FEED)
    expect(pickZipAsset(feed, 'arm64')?.url).toBe('vibechemy-1.0.0-arm64.zip')
  })
  it('falls back to any zip when no arch match, null when none', () => {
    const feed = { files: [{ url: 'vibechemy-1.0.0.zip', sha512: 'x=' }] }
    expect(pickZipAsset(feed, 'arm64')?.url).toBe('vibechemy-1.0.0.zip')
    expect(pickZipAsset({ files: [{ url: 'a.dmg', sha512: 'x=' }] }, 'arm64')).toBeNull()
    expect(pickZipAsset(null, 'arm64')).toBeNull()
  })
})

describe('assetUrl', () => {
  const release = {
    assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://example.com/latest-mac.yml' },
      { name: 'vibechemy-1.0.0-arm64.zip', browser_download_url: 'https://example.com/v.zip' }
    ]
  }
  it('finds exact asset names', () => {
    expect(assetUrl(release, 'latest-mac.yml')).toBe('https://example.com/latest-mac.yml')
  })
  it('returns null for missing assets and malformed releases', () => {
    expect(assetUrl(release, 'nope.zip')).toBeNull()
    expect(assetUrl({}, 'latest-mac.yml')).toBeNull()
    expect(assetUrl(null, 'latest-mac.yml')).toBeNull()
  })
})
