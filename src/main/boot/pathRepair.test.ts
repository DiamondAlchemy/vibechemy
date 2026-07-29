import { describe, it, expect, vi } from 'vitest'
import { mergePath, repairPath, HOMEBREW_SENTINEL, FALLBACK_DIRS } from './pathRepair'

describe('mergePath', () => {
  it('keeps current entries first and appends missing ones without duplicates', () => {
    expect(mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin', ['/usr/local/bin'])).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin'
    )
  })
  it('tolerates undefined captured PATH', () => {
    expect(mergePath('/usr/bin', undefined, ['/opt/homebrew/bin'])).toBe('/usr/bin:/opt/homebrew/bin')
  })
  it('tolerates empty current PATH', () => {
    expect(mergePath('', '/opt/homebrew/bin', [])).toBe('/opt/homebrew/bin')
  })
})

describe('repairPath', () => {
  // 2026-07-28 regression: the sentinel used to skip the WHOLE merge, so a homebrew-having launch
  // (`npm run upgrade:mac` from a terminal) never picked up the fallback dirs — a CLI installed
  // after boot (~/.kimi-code/bin) stayed invisible and every kimi pane exited 127 on spawn.
  it('still appends the fallback dirs when the homebrew sentinel is present (dev terminal)', () => {
    const capture = vi.fn(() => '/should/not/be/called')
    const env: Record<string, string | undefined> = { PATH: `/usr/bin:${HOMEBREW_SENTINEL}` }
    repairPath(env, capture)
    expect(capture).not.toHaveBeenCalled() // the login-shell probe is the only thing the sentinel skips
    expect(env.PATH!.split(':')).toEqual([
      '/usr/bin',
      HOMEBREW_SENTINEL,
      ...FALLBACK_DIRS.filter((d) => d !== HOMEBREW_SENTINEL)
    ])
  })
  it('merges the captured login-shell PATH plus fallbacks when sentinel is missing', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin' }
    repairPath(env, () => '/opt/homebrew/bin:/Users/x/.local/bin')
    expect(env.PATH!.split(':')).toEqual(
      expect.arrayContaining(['/usr/bin', '/bin', '/opt/homebrew/bin', '/Users/x/.local/bin', '/usr/local/bin'])
    )
    expect(env.PATH!.startsWith('/usr/bin:/bin')).toBe(true)
  })
  it('falls back to the known dirs when capture fails', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' }
    repairPath(env, () => undefined)
    expect(env.PATH!.split(':')).toContain('/opt/homebrew/bin')
    expect(env.PATH!.split(':')).toContain('/usr/local/bin')
  })
  it('covers every agent-installer target dir (a CLI installed after boot must still resolve)', () => {
    const env: Record<string, string | undefined> = { PATH: `/usr/bin:${HOMEBREW_SENTINEL}` }
    repairPath(env, () => undefined)
    // The exact regression that killed kimi panes with exit 127 on a fresh rig, plus its siblings.
    for (const dir of ['/.kimi-code/bin', '/.grok/bin', '/.local/bin', '/.bun/bin']) {
      expect(env.PATH).toContain(dir)
    }
  })
  it('is idempotent — repeated boots never duplicate entries', () => {
    const env: Record<string, string | undefined> = { PATH: `/usr/bin:${HOMEBREW_SENTINEL}` }
    repairPath(env, () => undefined)
    const once = env.PATH
    repairPath(env, () => undefined)
    expect(env.PATH).toBe(once)
    const parts = env.PATH!.split(':')
    expect(new Set(parts).size).toBe(parts.length)
  })
})
