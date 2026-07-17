import { describe, it, expect } from 'vitest'
import { parseAgentProfiles, profilePresetIds, removedProfileIds } from './profiles'

describe('removedProfileIds', () => {
  const roster = (ids: string[]): string =>
    JSON.stringify(ids.map((id) => ({ id, agentId: 'claude', label: id, role: 'orchestrator' })))
  it('returns claude ids present before and gone after', () => {
    expect(removedProfileIds(roster(['a1', 'b2', 'c3']), roster(['b2']))).toEqual(['a1', 'c3'])
  })
  it('empty/no-change cases', () => {
    expect(removedProfileIds(null, roster(['a1']))).toEqual([])
    expect(removedProfileIds(roster(['a1']), roster(['a1']))).toEqual([])
    expect(removedProfileIds(roster(['a1']), null)).toEqual(['a1'])
  })
})


describe('parseAgentProfiles', () => {
  it('empty/malformed → [] (no chips until a profile is added)', () => {
    expect(parseAgentProfiles(null)).toEqual([])
    expect(parseAgentProfiles('')).toEqual([])
    expect(parseAgentProfiles('not json')).toEqual([])
    expect(parseAgentProfiles('{}')).toEqual([])
  })
  it('keeps valid rows; defaults agentId=claude, role=orchestrator', () => {
    const p = parseAgentProfiles(
      JSON.stringify([
        { id: 'pabc12', label: 'Work Claude' },
        { id: 'pdef34', agentId: 'claude', label: 'Claude Work 2', role: 'both' }
      ])
    )
    expect(p).toEqual([
      { id: 'pabc12', agentId: 'claude', label: 'Work Claude', role: 'orchestrator' },
      { id: 'pdef34', agentId: 'claude', label: 'Claude Work 2', role: 'both' }
    ])
  })
  it('drops rows with no id, no label, or a bad id; dedupes by id', () => {
    const p = parseAgentProfiles(
      JSON.stringify([
        { label: 'no id' },
        { id: 'ok1', label: '' },
        { id: 'BAD ID', label: 'bad id' },
        { id: 'good', label: 'Good' },
        { id: 'good', label: 'dupe' }
      ])
    )
    expect(p.map((x) => x.id)).toEqual(['good'])
    expect(p[0].label).toBe('Good')
  })
  it('renaming the label does NOT change the id/creds dir', () => {
    const a = parseAgentProfiles(JSON.stringify([{ id: 'p1', label: 'Old Name' }]))
    const b = parseAgentProfiles(JSON.stringify([{ id: 'p1', label: 'New Name' }]))
    expect(a[0].id).toBe(b[0].id) // stable id survives a rename
  })
})

describe('profilePresetIds', () => {
  it('derives the orch + worker preset ids from the stable id', () => {
    expect(profilePresetIds({ id: 'p1' })).toEqual({ orch: 'profile-p1-orch', worker: 'profile-p1' })
  })
})
