import { describe, it, expect } from 'vitest'
import { tombstonesReducer, type Tombstone } from './tombstones'
import type { SessionRecord } from '@shared/types'

const rec = (id: string): SessionRecord =>
  ({
    id,
    projectId: 'p',
    presetId: 'claude-fable',
    tmuxName: `mc_${id}`,
    cwd: '/tmp',
    title: 't',
    status: 'exited',
    createdAt: 1,
    lastSeenAt: 2,
    branch: null,
    originRoot: null,
    task: null,
    owner: null,
    taskState: null
  }) as SessionRecord

describe('tombstonesReducer', () => {
  it('adds an exited session once (dedupes by id)', () => {
    let s: Tombstone[] = []
    s = tombstonesReducer(s, { type: 'exited', session: rec('a'), at: 10 })
    s = tombstonesReducer(s, { type: 'exited', session: rec('a'), at: 11 })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ exitedAt: 10, reviving: false, error: null })
  })
  it('dismiss removes; unknown ids are no-ops', () => {
    const s = tombstonesReducer([], { type: 'exited', session: rec('a'), at: 1 })
    expect(tombstonesReducer(s, { type: 'dismiss', id: 'a' })).toHaveLength(0)
    expect(tombstonesReducer(s, { type: 'dismiss', id: 'zzz' })).toBe(s)
  })
  it('revive lifecycle: start sets reviving, ok removes, failure records error and re-enables', () => {
    let s = tombstonesReducer([], { type: 'exited', session: rec('a'), at: 1 })
    s = tombstonesReducer(s, { type: 'reviveStart', id: 'a' })
    expect(s[0].reviving).toBe(true)
    const failed = tombstonesReducer(s, { type: 'reviveFailed', id: 'a', message: 'nope' })
    expect(failed[0]).toMatchObject({ reviving: false, error: 'nope' })
    expect(tombstonesReducer(s, { type: 'reviveOk', id: 'a' })).toHaveLength(0)
  })
})

describe('missing-CLI tombstones', () => {
  it('carries missingCli through the exited action', () => {
    const s = { id: 'x', presetId: 'cursor' } as never
    const out = tombstonesReducer([], { type: 'exited', session: s, at: 1, missingCli: true })
    expect(out[0].missingCli).toBe(true)
  })
})
