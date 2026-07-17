import { describe, it, expect } from 'vitest'
import type { SessionRecord } from '../types'
import {
  selectClosedOrchestrators,
  closedOrchestratorKey,
  REOPEN_WINDOW_MS,
  type ReopenDismissMap
} from './closedOrchestrators'

const NOW = 10_000_000_000

function row(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: over.id ?? 'id-' + Math.round((over.lastSeenAt ?? NOW) % 1e6),
    projectId: null,
    presetId: 'claude',
    tmuxName: 'mc_x',
    cwd: '/repo/a',
    title: 'x',
    status: 'exited',
    createdAt: NOW - 1_000_000,
    lastSeenAt: NOW - 1000,
    ...over
  }
}

// every cwd in these fixtures "exists" unless a test says otherwise
const base = {
  isOrchestrator: (): boolean => true,
  cwdExists: (): boolean => true,
  dismissed: {} as ReopenDismissMap,
  now: NOW
}

describe('selectClosedOrchestrators', () => {
  it('keeps only the newest closed session per preset+cwd slot', () => {
    const rows = [
      row({ id: 'old', presetId: 'claude', cwd: '/repo/a', lastSeenAt: NOW - 5000 }),
      row({ id: 'new', presetId: 'claude', cwd: '/repo/a', lastSeenAt: NOW - 1000 })
    ]
    const out = selectClosedOrchestrators(rows, base)
    expect(out.map((r) => r.id)).toEqual(['new'])
  })

  it('treats same agent in different folders as distinct slots', () => {
    const rows = [
      row({ id: 'a', presetId: 'claude', cwd: '/repo/a' }),
      row({ id: 'b', presetId: 'claude', cwd: '/repo/b' })
    ]
    const out = selectClosedOrchestrators(rows, base)
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('drops orchestras closed before the recency window', () => {
    const rows = [
      row({ id: 'recent', cwd: '/repo/a', lastSeenAt: NOW - 1000 }),
      row({ id: 'stale', cwd: '/repo/b', lastSeenAt: NOW - REOPEN_WINDOW_MS - 1 })
    ]
    const out = selectClosedOrchestrators(rows, base)
    expect(out.map((r) => r.id)).toEqual(['recent'])
  })

  it('excludes a slot that is live again (already reopened)', () => {
    const rows = [
      row({ id: 'dead', presetId: 'claude', cwd: '/repo/a', status: 'exited', lastSeenAt: NOW - 2000 }),
      row({ id: 'live', presetId: 'claude', cwd: '/repo/a', status: 'running', lastSeenAt: NOW - 500 })
    ]
    const out = selectClosedOrchestrators(rows, base)
    expect(out).toEqual([])
  })

  it('treats a live personal agent as the same slot as its closed row', () => {
    const rows = [
      row({ id: 'dead', presetId: 'personal-agent', cwd: '/repo/a', status: 'exited', lastSeenAt: NOW - 2000 }),
      row({ id: 'live', presetId: 'personal-agent', cwd: '/repo/a', status: 'running', lastSeenAt: NOW - 500 })
    ]

    expect(selectClosedOrchestrators(rows, base)).toEqual([])
    expect(closedOrchestratorKey(rows[0])).toBe(closedOrchestratorKey(rows[1]))
  })

  it('requires the working folder to still exist', () => {
    const rows = [row({ id: 'gone', cwd: '/repo/gone' })]
    const out = selectClosedOrchestrators(rows, { ...base, cwdExists: (c) => c !== '/repo/gone' })
    expect(out).toEqual([])
  })

  it('only lists orchestrator presets', () => {
    const rows = [
      row({ id: 'orch', presetId: 'claude', cwd: '/repo/a' }),
      row({ id: 'worker', presetId: 'worker', cwd: '/repo/b' })
    ]
    const out = selectClosedOrchestrators(rows, { ...base, isOrchestrator: (p) => p === 'claude' })
    expect(out.map((r) => r.id)).toEqual(['orch'])
  })

  it('dismiss hides a slot until a NEWER close reappears', () => {
    const key = closedOrchestratorKey({ presetId: 'claude', cwd: '/repo/a' })
    const dismissed: ReopenDismissMap = { [key]: NOW - 1000 }
    // the closed one at/ before the dismiss time stays hidden
    const before = selectClosedOrchestrators([row({ id: 'old', cwd: '/repo/a', lastSeenAt: NOW - 1000 })], {
      ...base,
      dismissed
    })
    expect(before).toEqual([])
    // a genuinely new close (after the dismiss) surfaces again
    const after = selectClosedOrchestrators([row({ id: 'fresh', cwd: '/repo/a', lastSeenAt: NOW - 500 })], {
      ...base,
      dismissed
    })
    expect(after.map((r) => r.id)).toEqual(['fresh'])
  })

  it('dismissing the newest does not reveal an older ghost in the same slot', () => {
    const key = closedOrchestratorKey({ presetId: 'claude', cwd: '/repo/a' })
    const dismissed: ReopenDismissMap = { [key]: NOW - 1000 }
    const rows = [
      row({ id: 'newest', cwd: '/repo/a', lastSeenAt: NOW - 1000 }),
      row({ id: 'older', cwd: '/repo/a', lastSeenAt: NOW - 4000 })
    ]
    const out = selectClosedOrchestrators(rows, { ...base, dismissed })
    expect(out).toEqual([])
  })

  it('sorts newest-first and caps at max', () => {
    const rows = [
      row({ id: 'a', cwd: '/r/a', lastSeenAt: NOW - 3000 }),
      row({ id: 'b', cwd: '/r/b', lastSeenAt: NOW - 1000 }),
      row({ id: 'c', cwd: '/r/c', lastSeenAt: NOW - 2000 })
    ]
    const out = selectClosedOrchestrators(rows, { ...base, max: 2 })
    expect(out.map((r) => r.id)).toEqual(['b', 'c'])
  })
})
