/**
 * In-memory, append-only ring buffer of control-plane events with a long-poll `waitFor()`.
 * Agent-facing (via the `await_event` MCP tool) so orchestrators react instead of poll.
 * No DOM, no Electron — pure main-process logic, unit-tested with an injected clock.
 */

export type ControlEventKind = 'worker_state' | 'worker_added' | 'worker_removed'

/** The notable worker states the channel surfaces (a subset, distinct from the full TaskState).
 *  Only states the control plane actually records — kept honest: see-it, emit-it. */
export type WorkerState = 'needs_review' | 'done'

/** What callers record: kind + payload, without the hub-assigned seq/at. */
export type ControlEventInput =
  | { kind: 'worker_state'; workerId: string; state: WorkerState; branch: string | null; owner: string | null }
  | { kind: 'worker_added'; workerId: string; preset: string }
  | { kind: 'worker_removed'; workerId: string; preset: string }

/** A recorded event: the input plus the hub's monotonic seq and capture time. */
export type ControlEvent = ControlEventInput & { seq: number; at: number }

export interface AwaitOptions {
  /** Return events with seq strictly greater than this cursor (default 0 = from the start). */
  sinceSeq?: number
  /** Restrict to these kinds. `undefined` = all kinds; `[]` = none (matches nothing). */
  kinds?: ControlEventKind[]
  /** How long to block server-side before resolving empty (ms). <= 0 resolves synchronously. */
  timeoutMs: number
}

export interface AwaitResult {
  events: ControlEvent[]
  /** The hub's latest seq — the caller's next cursor, even on an empty/timeout result. */
  seq: number
  /** True when `sinceSeq` predates the retained buffer (events were evicted) — re-sync. */
  gap: boolean
}

/** All known kinds, for input validation at the tool boundary. */
export const CONTROL_EVENT_KINDS: readonly ControlEventKind[] = ['worker_state', 'worker_added', 'worker_removed']

export function isControlEventKind(v: unknown): v is ControlEventKind {
  return typeof v === 'string' && (CONTROL_EVENT_KINDS as readonly string[]).includes(v)
}

/** The await_event tool's timeout, clamped to a safe long-poll window (default 60s, [1s, 240s]). */
export function clampAwaitTimeoutMs(ms?: number): number {
  return Math.min(240_000, Math.max(1_000, ms ?? 60_000))
}

const DEFAULT_CAP = 500

interface Waiter {
  sinceSeq: number
  kinds?: ControlEventKind[]
  resolve: (r: AwaitResult) => void
  timer: ReturnType<typeof setTimeout> | null
}

function matchesKinds(kind: ControlEventKind, kinds?: ControlEventKind[]): boolean {
  // undefined = all kinds; an explicit list matches only its members, so [] matches nothing
  // (an all-unknown subscription gets silence, never the firehose).
  return kinds === undefined || kinds.includes(kind)
}

export class ControlEventHub {
  private buffer: ControlEvent[] = []
  private lastSeq = 0 // last assigned seq (monotonic; first record => 1)
  private oldestSeq = 0 // smallest seq still retained (0 until the first record)
  private waiters = new Set<Waiter>()
  private readonly cap: number
  private readonly clock: () => number

  constructor(opts: { cap?: number; clock?: () => number } = {}) {
    this.cap = Math.max(1, opts.cap ?? DEFAULT_CAP)
    this.clock = opts.clock ?? Date.now
  }

  /** Append an event (assigning seq + at), evict past the cap, and wake matching waiters. */
  record(input: ControlEventInput): void {
    this.lastSeq += 1
    const event: ControlEvent = { ...input, seq: this.lastSeq, at: this.clock() }
    this.buffer.push(event)
    while (this.buffer.length > this.cap) this.buffer.shift()
    this.oldestSeq = this.buffer[0].seq
    for (const w of [...this.waiters]) {
      if (matchesKinds(event.kind, w.kinds)) {
        if (w.timer) clearTimeout(w.timer)
        this.waiters.delete(w)
        w.resolve({ events: this.query(w.sinceSeq, w.kinds), seq: this.lastSeq, gap: this.isGap(w.sinceSeq) })
      }
    }
  }

  /** Long-poll: resolve immediately if matching events exist after `sinceSeq`, else block up to timeoutMs. */
  waitFor(opts: AwaitOptions): Promise<AwaitResult> {
    const sinceSeq = opts.sinceSeq ?? 0
    const existing = this.query(sinceSeq, opts.kinds)
    if (existing.length > 0 || opts.timeoutMs <= 0) {
      return Promise.resolve({ events: existing, seq: this.lastSeq, gap: this.isGap(sinceSeq) })
    }
    return new Promise<AwaitResult>((resolve) => {
      const waiter: Waiter = { sinceSeq, kinds: opts.kinds, resolve, timer: null }
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter)
        resolve({ events: [], seq: this.lastSeq, gap: this.isGap(sinceSeq) })
      }, opts.timeoutMs)
      this.waiters.add(waiter)
    })
  }

  /** Current waiter count — for leak checks in tests. */
  get waiterCount(): number {
    return this.waiters.size
  }

  private query(sinceSeq: number, kinds?: ControlEventKind[]): ControlEvent[] {
    return this.buffer.filter((e) => e.seq > sinceSeq && matchesKinds(e.kind, kinds))
  }

  private isGap(sinceSeq: number): boolean {
    // seq regression: sinceSeq is ahead of our lastSeq (e.g. server restarted and
    // reset to 0). Treat as a gap so the caller re-syncs from fresh snapshots.
    if (sinceSeq > this.lastSeq) return true
    return this.oldestSeq > sinceSeq + 1
  }
}
