import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type DB } from '../db/database'
import { KnowledgeStore } from './KnowledgeStore'

let db: DB
let t: number
let store: KnowledgeStore
beforeEach(() => {
  db = openDatabase(':memory:')
  t = 1000
  store = new KnowledgeStore(db, () => t)
})

describe('KnowledgeStore', () => {
  it('defaults status by type: bug→open (unresolved), feature→shipped (resolved-stamped)', () => {
    const bug = store.log({ type: 'bug', title: 'crash on save' })
    expect(bug.status).toBe('open')
    expect(bug.resolvedAt).toBeNull()
    const feat = store.log({ type: 'feature', title: 'dark mode' })
    expect(feat.status).toBe('shipped')
    expect(feat.resolvedAt).toBe(1000)
  })

  it('stamps resolved_at on first resolve, preserves it on later updates, clears when reopened', () => {
    const bug = store.log({ type: 'bug', title: 'x' })
    t = 2000
    const fixed = store.update(bug.id, { status: 'fixed' })!
    expect(fixed.resolvedAt).toBe(2000)
    t = 3000
    const titled = store.update(bug.id, { title: 'x (rebrand)' })!
    expect(titled.resolvedAt).toBe(2000) // not re-stamped
    const reopened = store.update(bug.id, { status: 'open' })!
    expect(reopened.resolvedAt).toBeNull() // reopening clears the stamp
  })

  it('search matches title OR detail; projectId undefined=all, value=scoped, null=global-only', () => {
    store.log({ projectId: 'p1', type: 'feature', title: 'dependency map', detail: 'file relationship graph' })
    store.log({ projectId: 'p2', type: 'bug', title: 'merge fails' })
    store.log({ projectId: null, type: 'feature', title: 'global graph note' })
    expect(store.search('graph').length).toBe(2)
    expect(store.search('relationship graph', 'p1').length).toBe(1)
    expect(store.search('graph', null).length).toBe(1)
    expect(store.search('nope').length).toBe(0)
  })

  it('list filters by project/type/status/since, newest-updated first', () => {
    const a = store.log({ projectId: 'p1', type: 'bug', title: 'a' })
    t = 2000
    store.log({ projectId: 'p1', type: 'feature', title: 'b' })
    t = 3000
    store.update(a.id, { status: 'fixed' })
    expect(store.list({ projectId: 'p1' }).map((e) => e.title)).toEqual(['a', 'b'])
    expect(store.list({ type: 'bug' }).length).toBe(1)
    expect(store.list({ status: 'fixed' }).length).toBe(1)
    expect(store.list({ since: 2500 }).map((e) => e.title)).toEqual(['a'])
    expect(store.update('missing', { status: 'fixed' })).toBeNull()
    expect(store.get('missing')).toBeNull()
  })
})
