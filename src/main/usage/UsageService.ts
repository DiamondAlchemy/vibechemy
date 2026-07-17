import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageReport, UsageRow } from '@shared/types'
import type { UsageAdapter, UsageDeps } from './types'
import { grokSubToken } from './grokSubAuth'
import { findKimiBin } from './kimiBin'
import { claudeAdapter } from './adapters/claude'
import { codexAdapter } from './adapters/codex'
import { grokAdapter } from './adapters/grok'
import { kimiAdapter } from './adapters/kimi'
import { opencodeGlmAdapter, opencodeMinimaxAdapter } from './adapters/opencode'
import { antigravityAdapter } from './adapters/antigravity'

// The renderer polls ~60s and this owns the same cache cadence — network reads shouldn't fire
// faster than the numbers move (weekly windows) and codex spawns a process per refresh.
const CACHE_MS = 60_000
// One slow adapter (a hung codex spawn, a stalled fetch) must not stall the whole report.
const PER_ADAPTER_MS = 15_000

function readOpencodeAuth(): Record<string, { key?: string }> {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf8'))
  } catch {
    return {}
  }
}

function readKimiAuth(): { accessToken: string; expiresAt: number | null } | null {
  const home = homedir()
  // v0.24+ stores credentials here; older installs used oauth/kimi-code directly. Prefer the
  // current store when both exist because the legacy path is now Kimi's empty refresh-lock target.
  const paths = [
    join(home, '.kimi-code', 'credentials', 'kimi-code.json'),
    join(home, '.kimi-code', 'oauth', 'kimi-code')
  ]
  for (const path of paths) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { access_token?: unknown; expires_at?: unknown }
      if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) continue
      return {
        accessToken: parsed.access_token,
        expiresAt:
          typeof parsed.expires_at === 'number' && Number.isFinite(parsed.expires_at) ? parsed.expires_at : null
      }
    } catch {
      /* try the other Kimi token location */
    }
  }
  return null
}

function readClaudeCredsFile(): { exists: boolean; token: string | null } {
  const path = join(homedir(), '.claude', '.credentials.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { claudeAiOauth?: { accessToken?: unknown } }
    const token = parsed.claudeAiOauth?.accessToken
    return { exists: true, token: typeof token === 'string' && token.length > 0 ? token : null }
  } catch {
    return { exists: existsSync(path), token: null }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/**
 * The REMAINING-usage source — one adapter per agent, each returning its plan quota left, behind
 * {@link UsageAdapter}. Honesty contract: a source that fails → an explicit error row (verbatim);
 * no source at all → an unavailable NO SOURCE YET row; never invented, never silently zero.
 * Per-adapter timeout + try/catch means one bad provider can't take down the report.
 */
export class UsageService {
  private adapters: UsageAdapter[]
  private deps: UsageDeps
  private cached: UsageReport | null = null
  private cachedAt = 0
  // Single-flight + generation guard: the panel polls every few seconds and each report() fans out
  // to every provider; without a shared in-flight promise, overlapping polls run N parallel
  // Keychain/network fetches. `generation` is bumped by invalidate() so a run that started before
  // an invalidate never writes its now-stale result over a fresher cache.
  private inFlight: Promise<UsageReport> | null = null
  private generation = 0

  constructor(
    getSetting: (key: string) => string | null,
    now: () => number = Date.now,
    depsOverride?: Partial<UsageDeps>
  ) {
    this.deps = {
      fetch: globalThis.fetch.bind(globalThis),
      spawn: nodeSpawn,
      execFile: nodeExecFile,
      grokSubToken,
      readOpencodeAuth,
      readKimiAuth,
      kimiBin: findKimiBin,
      getSetting,
      readClaudeCredsFile,
      now,
      ...depsOverride
    }
    this.adapters = [
      claudeAdapter(),
      codexAdapter(),
      kimiAdapter(),
      opencodeGlmAdapter(),
      opencodeMinimaxAdapter(),
      grokAdapter(),
      antigravityAdapter()
    ]
  }

  /** Drop the cache so the next report() recomputes — used when a usage setting changes (e.g. the
   *  user enables the Claude Keychain card) so the change shows on the next poll, not in 60s. */
  invalidate(): void {
    this.cached = null
    this.cachedAt = 0
    this.generation++ // any in-flight run is now stale and must not write its result over the cache
  }

  async report(): Promise<UsageReport> {
    const now = this.deps.now()
    if (this.cached && now - this.cachedAt < CACHE_MS) return this.cached
    if (this.inFlight) return this.inFlight // coalesce overlapping polls onto one fan-out
    const gen = this.generation
    this.inFlight = (async () => {
      try {
        const agents = await Promise.all(this.adapters.map((a) => this.row(a)))
        const report: UsageReport = { generatedAt: now, agents }
        if (gen === this.generation) {
          // Not invalidated mid-run → publish. (A stale run still returns to its awaiters below.)
          this.cached = report
          this.cachedAt = this.deps.now()
        }
        return report
      } finally {
        this.inFlight = null
      }
    })()
    return this.inFlight
  }

  private async row(a: UsageAdapter): Promise<UsageRow> {
    const base = { id: a.id, label: a.label, burnId: a.burnId }
    if (!a.available) return { ...base, available: false, error: null, remaining: null }
    if (a.gated && !a.gated(this.deps))
      return { ...base, available: false, needsOptIn: true, optInKey: a.optInKey, error: null, remaining: null }
    try {
      const remaining = await withTimeout(a.fetchRemaining(this.deps), PER_ADAPTER_MS)
      return { ...base, available: true, error: null, remaining }
    } catch (e) {
      return { ...base, available: true, error: e instanceof Error ? e.message : String(e), remaining: null }
    }
  }
}
