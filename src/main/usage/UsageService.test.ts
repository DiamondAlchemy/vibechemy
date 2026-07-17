import { describe, it, expect, vi } from 'vitest'
import { UsageService } from './UsageService'
import type { UsageDeps } from './types'

// A UsageService whose deps are all faked — no network, no process, no Keychain. We drive the
// adapters through their real code paths (opencode/grok/antigravity/claude); codex spawn is faked too.
function svc(over: Partial<UsageDeps> = {}, getSetting: (key: string) => string | null = () => null): UsageService {
  const deps: Partial<UsageDeps> = {
    fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch,
    grokSubToken: async () => 'tok',
    readOpencodeAuth: () => ({}),
    readKimiAuth: () => null,
    kimiBin: () => 'kimi', // hermetic — the real resolver probes the filesystem
    // a spawn that never yields an id:2 → codex adapter times out fast in these tests via override
    spawn: (() => {
      throw new Error('no codex in test')
    }) as unknown as UsageDeps['spawn'],
    execFile: ((_c: string, _a: string[], cb: (e: Error | null, out: string) => void) =>
      // exit 44 = errSecItemNotFound — models "no Keychain item" (not signed in), not a blocked read
      cb(Object.assign(new Error('no keychain item'), { code: 44 }), '')) as unknown as UsageDeps['execFile'],
    readClaudeCredsFile: () => null,
    now: () => 1000,
    ...over
  }
  return new UsageService(getSetting, deps.now, deps)
}

describe('UsageService', () => {
  it('caches within the 60s window and recomputes past it', async () => {
    let t = 1000
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
    const s = svc({ fetch: fetchSpy, now: () => t })
    const a = await s.report()
    const b = await s.report()
    expect(b).toBe(a) // cache hit — same object
    t += 61_000
    const c = await s.report()
    expect(c).not.toBe(a) // recomputed
  })

  it('single-flight: overlapping report() calls share ONE fan-out', async () => {
    let calls = 0
    const slowFetch = vi.fn(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 5))
      return { ok: true, status: 200, json: async () => ({}) }
    }) as unknown as typeof fetch
    const s = svc({ fetch: slowFetch })
    const [a, b] = await Promise.all([s.report(), s.report()]) // fire concurrently
    expect(b).toBe(a) // same in-flight result
    const oneFanout = calls
    await s.report() // cached → no new calls
    expect(calls).toBe(oneFanout)
  })

  it('invalidate() during a run prevents that stale run from writing the cache', async () => {
    const t = 1000
    const s = svc({ now: () => t })
    const p = s.report() // start a run
    s.invalidate() // bump generation while it's in flight
    await p
    const next = await s.report() // cache was NOT written by the stale run → this recomputes fresh
    expect(next.generatedAt).toBe(t)
  })

  it('a Grok 200 → live health row (windows empty, available true)', async () => {
    const s = svc({
      fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
    })
    const grok = (await s.report()).agents.find((r) => r.id === 'grok')!
    expect(grok.available).toBe(true)
    expect(grok.remaining?.health).toBe('live')
    expect(grok.remaining?.windows).toEqual([])
  })

  it('Kimi Code reports live weekly and 5h remaining quota', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/coding/v1/usages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            usage: { limit: '100', remaining: '60', resetTime: '2026-07-23T20:00:00Z' },
            limits: [
              {
                window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
                detail: { limit: '100', remaining: '75', resetTime: '2026-07-17T01:00:00Z' }
              }
            ]
          })
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }) as unknown as typeof fetch
    const s = svc({
      fetch: fetchSpy,
      readKimiAuth: () => ({ accessToken: 'kimi-token', expiresAt: null })
    })
    const kimi = (await s.report()).agents.find((r) => r.id === 'kimi')!
    expect(kimi).toMatchObject({ label: 'Kimi Code', burnId: 'kimi', available: true, error: null })
    expect(kimi.remaining?.windows.map((w) => [w.id, w.remainingPct])).toEqual([
      ['session', 75],
      ['weekly', 60]
    ])
  })

  it('Kimi delegates an expiring OAuth refresh to the official non-model CLI command', async () => {
    let auth = { accessToken: 'old', expiresAt: 1 }
    const execSpy = vi.fn(
      (
        command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        expect(command).toBe('kimi')
        expect(args).toEqual(['provider', 'list', '--json'])
        auth = { accessToken: 'fresh', expiresAt: 10_000 }
        callback(null, '', '')
      }
    ) as unknown as UsageDeps['execFile']
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/coding/v1/usages')) {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer fresh')
        return {
          ok: true,
          status: 200,
          json: async () => ({ usage: { limit: 100, remaining: 50 } })
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }) as unknown as typeof fetch
    const s = svc({ fetch: fetchSpy, execFile: execSpy, readKimiAuth: () => auth })
    const kimi = (await s.report()).agents.find((r) => r.id === 'kimi')!
    expect(kimi.error).toBeNull()
    expect(kimi.remaining?.windows[0].remainingPct).toBe(50)
    expect(execSpy).toHaveBeenCalledOnce()
  })

  it('Kimi refresh spawns the RESOLVED binary path, not a bare PATH lookup', async () => {
    // The packaged GUI app's PATH lacks /opt/homebrew/bin — the adapter must use the injected
    // resolver's absolute path so the refresh works outside a login shell.
    const seen: string[] = []
    const execSpy = vi.fn(
      (command: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
        seen.push(command)
        callback(null)
      }
    ) as unknown as UsageDeps['execFile']
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ usage: { limit: 100, remaining: 50 } })
    })) as unknown as typeof fetch
    const s = svc({
      fetch: fetchSpy,
      execFile: execSpy,
      kimiBin: () => '/opt/homebrew/bin/kimi',
      readKimiAuth: () => ({ accessToken: 'tok', expiresAt: 1 }) // expiring → refresh path runs
    })
    const kimi = (await s.report()).agents.find((r) => r.id === 'kimi')!
    expect(kimi.error).toBeNull()
    expect(seen).toEqual(['/opt/homebrew/bin/kimi'])
  })

  it('Kimi refresh failure → the actionable expired message, not a raw exec error', async () => {
    const execSpy = vi.fn((_c: string, _a: string[], _o: unknown, callback: (error: Error | null) => void) =>
      callback(new Error('spawn kimi ENOENT'))
    ) as unknown as UsageDeps['execFile']
    const s = svc({ execFile: execSpy, readKimiAuth: () => ({ accessToken: 'tok', expiresAt: 1 }) })
    const kimi = (await s.report()).agents.find((r) => r.id === 'kimi')!
    expect(kimi.error).toBe('Kimi token expired — open a Kimi pane or run: kimi login')
  })

  it('Kimi 401 that survives a forced refresh → the actionable expired message', async () => {
    const execSpy = vi.fn((_c: string, _a: string[], _o: unknown, callback: (error: Error | null) => void) =>
      callback(null)
    ) as unknown as UsageDeps['execFile']
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch
    const s = svc({ fetch: fetchSpy, execFile: execSpy, readKimiAuth: () => ({ accessToken: 'tok', expiresAt: null }) })
    const kimi = (await s.report()).agents.find((r) => r.id === 'kimi')!
    expect(kimi.error).toBe('Kimi token expired — open a Kimi pane or run: kimi login')
    expect(execSpy).toHaveBeenCalledOnce() // the retry really forced one refresh
  })

  it('Kimi non-401 HTTP failure stays verbatim (genuinely unexpected)', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
    const s = svc({ fetch: fetchSpy, readKimiAuth: () => ({ accessToken: 'tok', expiresAt: null }) })
    const kimi = (await s.report()).agents.find((r) => r.id === 'kimi')!
    expect(kimi.error).toBe('Kimi Code usage HTTP 503')
  })

  it('opencode-glm with no key → an explicit error row (never silent zeros)', async () => {
    const s = svc({ readOpencodeAuth: () => ({}) })
    const glm = (await s.report()).agents.find((r) => r.id === 'opencode-glm')!
    expect(glm.available).toBe(true)
    expect(glm.error).toMatch(/GLM.*key not found/)
    expect(glm.remaining).toBeNull()
  })

  it('opencode-glm with a key → parsed windows', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { level: 'coding-plan', limits: [{ unit: 6, percentage: 25, nextResetTime: 5 }] } })
    })) as unknown as typeof fetch
    const s = svc({ fetch: fetchSpy, readOpencodeAuth: () => ({ 'zai-coding-plan': { key: 'k' } }) })
    const glm = (await s.report()).agents.find((r) => r.id === 'opencode-glm')!
    expect(glm.remaining?.windows).toEqual([
      { id: 'weekly', label: 'Weekly', remainingPct: 75, resetAt: 5, severity: null }
    ])
  })

  it('antigravity is opt-in gated: off → needsOptIn, keychain never read', async () => {
    const execSpy = vi.fn((_c: string, _a: string[], cb: (e: Error | null, o: string) => void) =>
      cb(new Error('x'), '')
    ) as unknown as UsageDeps['execFile']
    const s = svc({ execFile: execSpy }, () => null) // both keychain gates off
    const ag = (await s.report()).agents.find((r) => r.id === 'antigravity')!
    expect(ag.available).toBe(false)
    expect(ag.needsOptIn).toBe(true)
    expect(ag.optInKey).toBe('usage.antigravityKeychain')
  })

  it('claude is opt-in gated: off → needsOptIn NO SOURCE YET; the Keychain is never read', async () => {
    const execSpy = vi.fn((_c: string, _a: string[], cb: (e: Error | null, o: string) => void) =>
      cb(new Error('x'), '')
    ) as unknown as UsageDeps['execFile']
    const s = svc({ execFile: execSpy }, () => null) // setting off
    const claude = (await s.report()).agents.find((r) => r.id === 'claude-code')!
    expect(claude.available).toBe(false)
    expect(claude.needsOptIn).toBe(true)
    expect(execSpy).not.toHaveBeenCalled() // gate short-circuits before any Keychain read
  })

  it('claude opt-in ON but no token → an error row (not a fake gauge)', async () => {
    const s = svc({}, (k) => (k === 'usage.claudeKeychain' ? 'on' : null))
    const claude = (await s.report()).agents.find((r) => r.id === 'claude-code')!
    expect(claude.available).toBe(true)
    expect(claude.error).toMatch(/not signed in/)
  })

  it('claude blocked Keychain read falls back to the creds-file token (fresh-machine dogfood find)', async () => {
    const denied = ((_c: string, _a: string[], cb: (e: Error | null, out: string) => void) =>
      cb(Object.assign(new Error('interaction not allowed'), { code: 36 }), '')) as unknown as UsageDeps['execFile']
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
    const s = svc(
      { execFile: denied, fetch: fetchSpy, readClaudeCredsFile: () => 'file-tok' },
      (k) => (k === 'usage.claudeKeychain' ? 'on' : null)
    )
    const claude = (await s.report()).agents.find((r) => r.id === 'claude-code')!
    expect(claude.error).toBeNull()
    const authed = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[1] as { headers: Record<string, string> })?.headers?.Authorization === 'Bearer file-tok'
    )
    expect(authed).toBeTruthy()
  })

  it('claude blocked Keychain read with no file token → the Always Allow hint, not "not signed in"', async () => {
    const denied = ((_c: string, _a: string[], cb: (e: Error | null, out: string) => void) =>
      cb(Object.assign(new Error('interaction not allowed'), { code: 36 }), '')) as unknown as UsageDeps['execFile']
    const s = svc({ execFile: denied }, (k) => (k === 'usage.claudeKeychain' ? 'on' : null))
    const claude = (await s.report()).agents.find((r) => r.id === 'claude-code')!
    expect(claude.error).toMatch(/Keychain read blocked.*Always Allow/)
  })
})
