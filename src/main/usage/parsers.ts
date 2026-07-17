import type { UsageWindow } from '@shared/types'

// Pure parsers for each provider's remaining-usage response. All return UsageWindow[] with
// remainingPct already normalized to 0..100 REMAINING. Shapes are from live-verified provider
// responses. Defensive by construction: an unrecognized shape yields [] (→ an honest empty card),
// never a throw — except MiniMax, whose explicit error envelope is surfaced as a real SOURCE ERROR.

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}
function parseIso(s: string | undefined | null): number | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}
const WINDOW_RANK: Record<string, number> = { session: 0, weekly: 1, monthly: 2 }
function orderWindows(w: UsageWindow[]): UsageWindow[] {
  return w.sort((a, b) => (WINDOW_RANK[a.id] ?? 2) - (WINDOW_RANK[b.id] ?? 2))
}

// ── Claude Code — GET api.anthropic.com/api/oauth/usage ──────────────────────────────────────
interface ClaudeLimit {
  kind?: string
  percent?: number // USED %
  severity?: string
  resets_at?: string
  is_active?: boolean // marks the currently-BINDING limit — NOT a visibility filter (show them all)
  scope?: { model?: { display_name?: string } }
}
export interface ClaudeUsageBody {
  limits?: ClaudeLimit[]
  five_hour?: { utilization?: number; resets_at?: string }
  seven_day?: { utilization?: number; resets_at?: string }
}
const claudeSev = (s?: string): UsageWindow['severity'] =>
  s === 'warning' || s === 'critical' || s === 'normal' ? s : null

export function parseClaudeUsage(body: ClaudeUsageBody): UsageWindow[] {
  const limits = body?.limits
  if (Array.isArray(limits) && limits.length) {
    return orderWindows(
      limits
        // Show EVERY limit (5h, overall weekly, and each per-model weekly). is_active only flags
        // the binding one — filtering on it wrongly hid the 5h + overall weekly (both is_active:false).
        .filter((l) => typeof l.percent === 'number')
        .map((l): UsageWindow => {
          const model = l.scope?.model?.display_name
          const id =
            l.kind === 'session'
              ? 'session'
              : l.kind === 'weekly_all'
                ? 'weekly'
                : `weekly-${(model ?? l.kind ?? 'scoped').toLowerCase()}`
          const label = l.kind === 'session' ? '5h' : model ? `Weekly (${model})` : 'Weekly'
          return {
            id,
            label,
            remainingPct: clampPct(100 - (l.percent as number)),
            resetAt: parseIso(l.resets_at),
            severity: claudeSev(l.severity)
          }
        })
    )
  }
  // Fallback: top-level utilization objects (no limits[] present)
  const out: UsageWindow[] = []
  if (typeof body?.five_hour?.utilization === 'number')
    out.push({
      id: 'session',
      label: '5h',
      remainingPct: clampPct(100 - body.five_hour.utilization),
      resetAt: parseIso(body.five_hour.resets_at),
      severity: null
    })
  if (typeof body?.seven_day?.utilization === 'number')
    out.push({
      id: 'weekly',
      label: 'Weekly',
      remainingPct: clampPct(100 - body.seven_day.utilization),
      resetAt: parseIso(body.seven_day.resets_at),
      severity: null
    })
  return out
}

// ── Codex — `codex app-server` JSON-RPC account/rateLimits/read ──────────────────────────────
interface RateWindow {
  usedPercent?: number
  windowDurationMins?: number | null
  resetsAt?: number | null // epoch SECONDS
}
export interface CodexRateLimitsResult {
  rateLimits?: { primary?: RateWindow | null; secondary?: RateWindow | null }
  rateLimitsByLimitId?: Record<string, { primary?: RateWindow | null; secondary?: RateWindow | null }> | null
}
export function parseCodexRateLimits(result: CodexRateLimitsResult): UsageWindow[] {
  const snap = result?.rateLimits ?? result?.rateLimitsByLimitId?.codex
  if (!snap) return []
  const out: UsageWindow[] = []
  // Match by windowDurationMins, NOT the primary/secondary slot: plans differ (prolite puts weekly
  // under primary with secondary=null; standard puts 5h primary / weekly secondary).
  for (const w of [snap.primary, snap.secondary]) {
    if (!w || typeof w.usedPercent !== 'number' || typeof w.windowDurationMins !== 'number') continue
    const isWeekly = w.windowDurationMins >= 10080
    const isSession = w.windowDurationMins > 0 && w.windowDurationMins <= 300
    if (!isWeekly && !isSession) continue
    out.push({
      id: isWeekly ? 'weekly' : 'session',
      label: isWeekly ? 'Weekly' : '5h',
      remainingPct: clampPct(100 - w.usedPercent),
      resetAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null,
      severity: null
    })
  }
  return orderWindows(out)
}

// ── Kimi Code — GET api.kimi.com/coding/v1/usages ────────────────────────────────────────────
interface KimiQuota {
  used?: number | string
  limit?: number | string
  remaining?: number | string
  resetAt?: string
  reset_at?: string
  resetTime?: string
  reset_time?: string
}
interface KimiLimit {
  detail?: KimiQuota
  window?: { duration?: number | string; timeUnit?: string }
}
export interface KimiUsageBody {
  usage?: KimiQuota
  limits?: KimiLimit[]
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function kimiResetAt(row: KimiQuota): number | null {
  return parseIso(row.resetTime ?? row.reset_time ?? row.resetAt ?? row.reset_at)
}

function kimiWindow(row: KimiQuota, id: string, label: string): UsageWindow | null {
  const limit = finiteNumber(row.limit)
  const remaining = finiteNumber(row.remaining)
  const used = finiteNumber(row.used)
  if (limit === null || limit <= 0 || (remaining === null && used === null)) return null
  const remainingValue = remaining !== null ? remaining : Math.max(0, limit - (used ?? 0))
  return {
    id,
    label,
    remainingPct: clampPct((remainingValue / limit) * 100),
    resetAt: kimiResetAt(row),
    severity: null
  }
}

function kimiWindowIdentity(window: KimiLimit['window'], index: number): { id: string; label: string } {
  const duration = finiteNumber(window?.duration)
  const unit = window?.timeUnit ?? ''
  const minutes =
    duration === null
      ? null
      : unit.includes('MINUTE')
        ? duration
        : unit.includes('HOUR')
          ? duration * 60
          : unit.includes('DAY')
            ? duration * 1440
            : null
  if (minutes !== null && minutes <= 300) return { id: 'session', label: minutes === 300 ? '5h' : `${minutes}m` }
  if (minutes !== null && minutes >= 10080) return { id: 'weekly', label: 'Weekly' }
  return {
    id: `limit-${index + 1}`,
    label:
      duration === null
        ? `Limit ${index + 1}`
        : `${duration}${unit.includes('HOUR') ? 'h' : unit.includes('DAY') ? 'd' : 'm'}`
  }
}

export function parseKimiUsage(body: KimiUsageBody): UsageWindow[] {
  const byId = new Map<string, UsageWindow>()
  if (Array.isArray(body?.limits)) {
    body.limits.forEach((limit, index) => {
      if (!limit?.detail) return
      const identity = kimiWindowIdentity(limit.window, index)
      const parsed = kimiWindow(limit.detail, identity.id, identity.label)
      if (parsed) byId.set(parsed.id, parsed)
    })
  }
  const weekly = body?.usage ? kimiWindow(body.usage, 'weekly', 'Weekly') : null
  if (weekly) byId.set('weekly', weekly)
  return orderWindows([...byId.values()])
}

// ── OpenCode · GLM — GET api.z.ai/api/monitor/usage/quota/limit ───────────────────────────────
interface ZaiLimit {
  unit?: number // 3 = 5h window, 6 = weekly (TIME_LIMIT/others ignored)
  percentage?: number // USED %
  nextResetTime?: number // epoch ms
}
export interface ZaiQuotaBody {
  data?: { level?: string; limits?: ZaiLimit[] }
}
export function parseZaiQuota(body: ZaiQuotaBody): UsageWindow[] {
  const limits = body?.data?.limits
  if (!Array.isArray(limits)) return []
  const out: UsageWindow[] = []
  for (const l of limits) {
    const id = l.unit === 3 ? 'session' : l.unit === 6 ? 'weekly' : null
    if (!id || typeof l.percentage !== 'number') continue
    out.push({
      id,
      label: id === 'session' ? '5h' : 'Weekly',
      remainingPct: clampPct(100 - l.percentage),
      resetAt: typeof l.nextResetTime === 'number' ? l.nextResetTime : null,
      severity: null
    })
  }
  return orderWindows(out)
}

// ── OpenCode · MiniMax — GET api.minimax.io/.../coding_plan/remains ───────────────────────────
interface MinimaxModelRemain {
  model_name?: string
  current_interval_remaining_percent?: number // ALREADY remaining
  current_weekly_remaining_percent?: number
}
export interface MinimaxRemainsBody {
  base_resp?: { status_code?: number; status_msg?: string }
  model_remains?: MinimaxModelRemain[]
}
export function parseMinimaxRemains(body: MinimaxRemainsBody): UsageWindow[] {
  if (body?.base_resp && typeof body.base_resp.status_code === 'number' && body.base_resp.status_code !== 0)
    throw new Error(`MiniMax ${body.base_resp.status_code}: ${body.base_resp.status_msg ?? ''}`.trim())
  const gen = body?.model_remains?.find((m) => m.model_name === 'general') ?? body?.model_remains?.[0]
  if (!gen) return []
  const out: UsageWindow[] = []
  // remains_time units are unverified, so we show the percent (verified) but NOT a reset time we
  // can't trust.
  if (typeof gen.current_interval_remaining_percent === 'number')
    out.push({
      id: 'session',
      label: '5h',
      remainingPct: clampPct(gen.current_interval_remaining_percent),
      resetAt: null,
      severity: null
    })
  if (typeof gen.current_weekly_remaining_percent === 'number')
    out.push({
      id: 'weekly',
      label: 'Weekly',
      remainingPct: clampPct(gen.current_weekly_remaining_percent),
      resetAt: null,
      severity: null
    })
  return orderWindows(out)
}

// ── Grok — GET cli-chat-proxy.grok.com/v1/billing (?format=credits + plain) ──────────────────
interface GrokBillingBody {
  config?: {
    creditUsagePercent?: number // weekly cap, USED %
    currentPeriod?: { end?: string }
    monthlyLimit?: { val?: number }
    used?: { val?: number }
    billingPeriodEnd?: string
  }
}
export function parseGrokBilling(credits: GrokBillingBody, monthly?: GrokBillingBody): UsageWindow[] {
  const out: UsageWindow[] = []
  const c = credits?.config
  if (c && typeof c.creditUsagePercent === 'number') {
    out.push({
      id: 'weekly',
      label: 'Weekly',
      remainingPct: clampPct(100 - c.creditUsagePercent),
      resetAt: parseIso(c.currentPeriod?.end),
      severity: null
    })
  }
  const m = monthly?.config
  if (m && typeof m.monthlyLimit?.val === 'number' && m.monthlyLimit.val > 0 && typeof m.used?.val === 'number') {
    out.push({
      id: 'monthly',
      label: 'Monthly',
      remainingPct: clampPct(100 - (m.used.val / m.monthlyLimit.val) * 100),
      resetAt: parseIso(m.billingPeriodEnd),
      severity: null
    })
  }
  return orderWindows(out)
}

// ── Antigravity — POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota ───────────────
interface QuotaBucket {
  modelId?: string
  remainingFraction?: number // 0..1 REMAINING
  resetTime?: string
  tokenType?: string
}
export interface AntigravityQuotaBody {
  buckets?: QuotaBucket[]
}
/** Short model label: gemini-3-pro-preview → "3 pro", gemini-2.5-flash-lite → "2.5 flash lite". */
export function shortModel(id: string): string {
  return id
    .replace(/^gemini-/, '')
    .replace(/-preview$/, '')
    .replace(/-/g, ' ')
}
// retrieveUserQuota returns a bucket per model (8+, mostly untouched at 100%) — noise on the card.
// We keep at most TWO rows: the top PRO and the top FLASH model. Top = most used (lowest
// remainingFraction); ties (e.g. everything at 100%) break to the newest version number in the
// name (3.1 > 3 > 2.5), then to the non-"lite" variant at the same version.
type UsableBucket = QuotaBucket & { modelId: string; remainingFraction: number }
function modelVersion(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}
const isLite = (id: string): boolean => /(^|-)lite(-|$)/i.test(id)
function pickTopBucket(buckets: UsableBucket[]): UsableBucket | null {
  let best: UsableBucket | null = null
  for (const b of buckets) {
    if (!best) {
      best = b
      continue
    }
    const fracDiff = b.remainingFraction - best.remainingFraction
    if (fracDiff < 0) {
      best = b
      continue
    }
    if (fracDiff > 0) continue
    const verDiff = modelVersion(b.modelId) - modelVersion(best.modelId)
    if (verDiff > 0) {
      best = b
      continue
    }
    if (verDiff < 0) continue
    if (isLite(best.modelId) && !isLite(b.modelId)) best = b
  }
  return best
}
export function parseAntigravityQuota(body: AntigravityQuotaBody): UsageWindow[] {
  const buckets = body?.buckets
  if (!Array.isArray(buckets)) return []
  const usable = buckets.filter((b): b is UsableBucket => typeof b.remainingFraction === 'number' && !!b.modelId)
  const top = [
    pickTopBucket(usable.filter((b) => /pro/i.test(b.modelId))),
    pickTopBucket(usable.filter((b) => /flash/i.test(b.modelId)))
  ]
  return top
    .filter((b): b is UsableBucket => !!b)
    .map(
      (b): UsageWindow => ({
        id: `model-${b.modelId}`,
        label: shortModel(b.modelId),
        remainingPct: clampPct(b.remainingFraction * 100),
        resetAt: parseIso(b.resetTime),
        severity: null
      })
    )
}
