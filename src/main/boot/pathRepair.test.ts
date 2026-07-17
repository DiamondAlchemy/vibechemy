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
  it('no-ops when the homebrew sentinel is already present (dev terminal)', () => {
    const env = { PATH: `/usr/bin:${HOMEBREW_SENTINEL}` }
    repairPath(env, () => '/should/not/be/called')
    expect(env.PATH).toBe(`/usr/bin:${HOMEBREW_SENTINEL}`)
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
})
