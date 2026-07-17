import { describe, it, expect } from 'vitest'
import { parseClaudeUsage, parseCodexRateLimits, parseKimiUsage, parseZaiQuota, parseMinimaxRemains } from './parsers'

describe('parseClaudeUsage', () => {
  it('reads the limits[] shape (percent = USED → remaining)', () => {
    const w = parseClaudeUsage({
      limits: [
        { kind: 'session', percent: 5, severity: 'normal', resets_at: '2026-07-13T20:00:00Z', is_active: true },
        { kind: 'weekly_all', percent: 91, severity: 'warning', resets_at: '2026-07-18T00:00:00Z', is_active: true },
        {
          kind: 'weekly_scoped',
          percent: 100,
          severity: 'critical',
          scope: { model: { display_name: 'Fable' } },
          is_active: true
        }
      ]
    })
    expect(w.map((x) => [x.id, x.remainingPct, x.severity])).toEqual([
      ['session', 95, 'normal'],
      ['weekly', 9, 'warning'],
      ['weekly-fable', 0, 'critical']
    ])
    expect(w[0].resetAt).toBe(Date.parse('2026-07-13T20:00:00Z'))
  })
  it('falls back to five_hour/seven_day utilization', () => {
    const w = parseClaudeUsage({ five_hour: { utilization: 5 }, seven_day: { utilization: 91 } })
    expect(w.map((x) => [x.id, x.remainingPct])).toEqual([
      ['session', 95],
      ['weekly', 9]
    ])
  })
  it('shows ALL windows regardless of is_active (real shape: 5h + weekly both inactive, model active)', () => {
    // The live Anthropic response marks session + weekly_all is_active:false and only the binding
    // per-model limit is_active:true — the old filter wrongly hid the 5h and overall weekly.
    const w = parseClaudeUsage({
      limits: [
        { kind: 'session', percent: 14, is_active: false, severity: 'normal' },
        { kind: 'weekly_all', percent: 92, is_active: false, severity: 'critical' },
        {
          kind: 'weekly_scoped',
          percent: 100,
          is_active: true,
          severity: 'critical',
          scope: { model: { display_name: 'Fable' } }
        }
      ]
    })
    expect(w.map((x) => x.id)).toEqual(['session', 'weekly', 'weekly-fable'])
    expect(w.map((x) => x.remainingPct)).toEqual([86, 8, 0])
  })
  it('drops non-numeric percents; empty → []', () => {
    expect(parseClaudeUsage({ limits: [{ kind: 'session' }] })).toEqual([])
    expect(parseClaudeUsage({})).toEqual([])
  })
})

describe('parseCodexRateLimits', () => {
  it('matches weekly by windowDurationMins even when it is under primary (prolite)', () => {
    const w = parseCodexRateLimits({
      rateLimits: { primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 1784576797 }, secondary: null }
    })
    expect(w).toEqual([{ id: 'weekly', label: 'Weekly', remainingPct: 91, resetAt: 1784576797 * 1000, severity: null }])
  })
  it('handles standard plan (primary=5h, secondary=weekly) and orders session first', () => {
    const w = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 100 },
        secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 200 }
      }
    })
    expect(w.map((x) => x.id)).toEqual(['session', 'weekly'])
    expect(w.map((x) => x.remainingPct)).toEqual([60, 80])
  })
  it('reads rateLimitsByLimitId.codex fallback; empty → []', () => {
    const w = parseCodexRateLimits({
      rateLimitsByLimitId: { codex: { primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1 } } }
    })
    expect(w[0].remainingPct).toBe(100)
    expect(parseCodexRateLimits({})).toEqual([])
  })
})

describe('parseKimiUsage', () => {
  it('maps the live plural /usages shape into rolling 5h and weekly remaining windows', () => {
    const w = parseKimiUsage({
      usage: { limit: '100', remaining: '64', resetTime: '2026-07-23T20:18:06.459578Z' },
      limits: [
        {
          window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
          detail: { limit: '100', remaining: '81', resetTime: '2026-07-17T01:18:06.459578Z' }
        }
      ]
    })
    expect(w.map((x) => [x.id, x.label, x.remainingPct])).toEqual([
      ['session', '5h', 81],
      ['weekly', 'Weekly', 64]
    ])
    expect(w[0].resetAt).toBe(Date.parse('2026-07-17T01:18:06.459578Z'))
    expect(w[1].resetAt).toBe(Date.parse('2026-07-23T20:18:06.459578Z'))
  })

  it('supports used counters, clamps percentages, and rejects figures without a real limit', () => {
    expect(parseKimiUsage({ usage: { limit: 10, used: 3 } })[0].remainingPct).toBe(70)
    expect(parseKimiUsage({ usage: { limit: 10, remaining: 50 } })[0].remainingPct).toBe(100)
    expect(parseKimiUsage({ usage: { remaining: 5 } })).toEqual([])
  })
})

describe('parseZaiQuota', () => {
  it('maps unit 3 → session and unit 6 → weekly (percentage = USED)', () => {
    const w = parseZaiQuota({
      data: {
        level: 'coding-plan',
        limits: [
          { unit: 3, percentage: 62, nextResetTime: 1784570000000 },
          { unit: 6, percentage: 25, nextResetTime: 1785000000000 },
          { unit: 99, percentage: 50 } // TIME_LIMIT/other — ignored
        ]
      }
    })
    expect(w.map((x) => [x.id, x.remainingPct, x.resetAt])).toEqual([
      ['session', 38, 1784570000000],
      ['weekly', 75, 1785000000000]
    ])
  })
  it('empty/malformed → []', () => {
    expect(parseZaiQuota({})).toEqual([])
  })
})

describe('parseMinimaxRemains', () => {
  it('reads the general model remaining percents directly', () => {
    const w = parseMinimaxRemains({
      base_resp: { status_code: 0 },
      model_remains: [
        { model_name: 'general', current_interval_remaining_percent: 89, current_weekly_remaining_percent: 100 }
      ]
    })
    expect(w.map((x) => [x.id, x.remainingPct])).toEqual([
      ['session', 89],
      ['weekly', 100]
    ])
  })
  it('throws on a non-zero status envelope (surfaced as SOURCE ERROR)', () => {
    expect(() => parseMinimaxRemains({ base_resp: { status_code: 1004, status_msg: 'auth' } })).toThrow(/MiniMax 1004/)
  })
  it('empty → []', () => {
    expect(parseMinimaxRemains({ base_resp: { status_code: 0 }, model_remains: [] })).toEqual([])
  })
})

import { parseGrokBilling, parseAntigravityQuota, shortModel } from './parsers'

describe('parseGrokBilling', () => {
  it('weekly from creditUsagePercent (USED) + monthly from limit/used', () => {
    const w = parseGrokBilling(
      { config: { creditUsagePercent: 40, currentPeriod: { end: '2026-07-20T00:00:00Z' } } },
      { config: { monthlyLimit: { val: 15000 }, used: { val: 3000 }, billingPeriodEnd: '2026-08-01T00:00:00Z' } }
    )
    expect(w.map((x) => [x.id, x.remainingPct])).toEqual([
      ['weekly', 60],
      ['monthly', 80]
    ])
    expect(w[0].resetAt).toBe(Date.parse('2026-07-20T00:00:00Z'))
  })
  it('weekly only when no monthly passed; empty → []', () => {
    expect(parseGrokBilling({ config: { creditUsagePercent: 100 } }).map((x) => x.remainingPct)).toEqual([0])
    expect(parseGrokBilling({})).toEqual([])
  })
})

describe('parseAntigravityQuota', () => {
  it('returns at most one PRO and one FLASH row, PRO first, mapped from remainingFraction (0..1)', () => {
    const w = parseAntigravityQuota({
      buckets: [
        { modelId: 'gemini-2.5-flash', remainingFraction: 0.25, resetTime: '2026-07-15T00:00:00Z' },
        {
          modelId: 'gemini-3-pro-preview',
          remainingFraction: 1,
          resetTime: '2026-07-16T00:00:00Z',
          tokenType: 'REQUESTS'
        }
      ]
    })
    expect(w.map((x) => [x.id, x.label, x.remainingPct])).toEqual([
      ['model-gemini-3-pro-preview', '3 pro', 100],
      ['model-gemini-2.5-flash', '2.5 flash', 25]
    ])
    expect(w[0].resetAt).toBe(Date.parse('2026-07-16T00:00:00Z'))
  })
  it('trims each family to the MOST USED model (lowest remainingFraction); other families ignored', () => {
    const w = parseAntigravityQuota({
      buckets: [
        { modelId: 'gemini-3-pro-preview', remainingFraction: 1 },
        { modelId: 'gemini-2.5-pro', remainingFraction: 0.4 },
        { modelId: 'gemini-3.1-flash-lite', remainingFraction: 0.9 },
        { modelId: 'gemini-2.5-flash', remainingFraction: 0.6 },
        { modelId: 'text-embedding-004', remainingFraction: 0.05 }
      ]
    })
    expect(w.map((x) => [x.label, x.remainingPct])).toEqual([
      ['2.5 pro', 40],
      ['2.5 flash', 60]
    ])
  })
  it('breaks usage ties by newest version number (3.1 beats 3 beats 2.5), even over a non-lite older one', () => {
    const w = parseAntigravityQuota({
      buckets: [
        { modelId: 'gemini-2.5-pro', remainingFraction: 1 },
        { modelId: 'gemini-3-pro-preview', remainingFraction: 1 },
        { modelId: 'gemini-2.5-flash', remainingFraction: 1 },
        { modelId: 'gemini-3-flash', remainingFraction: 1 },
        { modelId: 'gemini-3.1-flash-lite', remainingFraction: 1 }
      ]
    })
    expect(w.map((x) => x.label)).toEqual(['3 pro', '3.1 flash lite'])
  })
  it('prefers the non-lite variant over a lite variant at the SAME version on a tie', () => {
    const w = parseAntigravityQuota({
      buckets: [
        { modelId: 'gemini-3.1-flash-lite', remainingFraction: 1 },
        { modelId: 'gemini-3.1-flash', remainingFraction: 1 }
      ]
    })
    expect(w.map((x) => x.label)).toEqual(['3.1 flash'])
  })
  it('drops buckets without modelId/remainingFraction; empty or no pro/flash match → []', () => {
    expect(
      parseAntigravityQuota({ buckets: [{ remainingFraction: 0.5 }, { modelId: 'gemini-3-pro-preview' }] })
    ).toEqual([])
    expect(parseAntigravityQuota({ buckets: [{ modelId: 'text-embedding-004', remainingFraction: 0.5 }] })).toEqual([])
    expect(parseAntigravityQuota({})).toEqual([])
  })
  it('shortModel strips gemini-/-preview', () => {
    expect(shortModel('gemini-3.1-flash-lite-preview')).toBe('3.1 flash lite')
  })
})
