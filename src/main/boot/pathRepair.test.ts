import { describe, it, expect } from 'vitest'
import { mergePath, repairPath, HOMEBREW_SENTINEL } from './pathRepair'

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
  it('skips the login-shell capture when homebrew is present, but STILL folds in the fallback dirs', () => {
    const env = { PATH: `/usr/bin:${HOMEBREW_SENTINEL}` }
    let captureCalled = false
    repairPath(env, () => {
      captureCalled = true
      return '/should/not/be/used'
    })
    expect(captureCalled).toBe(false) // no expensive zsh -ilc spawn when homebrew already reachable
    const parts = env.PATH.split(':')
    // The regression: the kimi fallback dir used to be dropped whenever homebrew was present.
    expect(env.PATH).toContain('/.kimi-code/bin')
    expect(parts).toContain('/usr/local/bin')
    expect(parts.slice(0, 2)).toEqual(['/usr/bin', HOMEBREW_SENTINEL]) // current entries keep priority
    expect(env.PATH).not.toContain('/should/not/be/used')
  })
  it('merges the captured login-shell PATH plus fallbacks when sentinel is missing', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin' }
    repairPath(env, () => '/opt/homebrew/bin:/tmp/mc-test/.local/bin')
    expect(env.PATH!.split(':')).toEqual(
      expect.arrayContaining(['/usr/bin', '/bin', '/opt/homebrew/bin', '/tmp/mc-test/.local/bin', '/usr/local/bin'])
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
