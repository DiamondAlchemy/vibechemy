import { describe, it, expect } from 'vitest'
import type { SessionRecord } from '../types'
import { groupWorkersElsewhere, type WorkersElsewhereInput } from './workersElsewhere'

function row(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: over.id ?? 'id-' + Math.random().toString(36).slice(2),
    projectId: null,
    presetId: 'codex',
    tmuxName: 'mc_x',
    cwd: '/repo/a',
    title: 'x',
    status: 'running',
    createdAt: 1000,
    lastSeenAt: 2000,
    ...over
  }
}

const base: WorkersElsewhereInput = {
  currentProjectId: 'proj-A',
  orchPresetIds: new Set(['claude', 'codex-orch', 'profile-abc-orch']),
  leadIds: [],
  projectNames: new Map([
    ['proj-A', 'KPI App'],
    ['proj-B', 'Menu TSW']
  ])
}

describe('groupWorkersElsewhere', () => {
  it('groups alive workers in OTHER workspaces, one entry per workspace with a count', () => {
    const groups = groupWorkersElsewhere(
      [
        row({ projectId: null }), // Scratch worker
        row({ projectId: null }), // Scratch worker
        row({ projectId: 'proj-B' }), // Menu TSW worker
        row({ projectId: 'proj-A' }) // current workspace — excluded
      ],
      base
    )
    expect(groups).toEqual([
      { projectId: null, label: 'Scratch', count: 2 },
      { projectId: 'proj-B', label: 'Menu TSW', count: 1 }
    ])
  })

  it('excludes sessions in the current workspace', () => {
    const groups = groupWorkersElsewhere([row({ projectId: 'proj-A' }), row({ projectId: 'proj-A' })], base)
    expect(groups).toEqual([])
  })

  it('treats the current Scratch workspace as "here" (null === null)', () => {
    const groups = groupWorkersElsewhere([row({ projectId: null }), row({ projectId: 'proj-B' })], {
      ...base,
      currentProjectId: null
    })
    expect(groups).toEqual([{ projectId: 'proj-B', label: 'Menu TSW', count: 1 }])
  })

  it('excludes orchestrators by preset id and leads by session id', () => {
    const groups = groupWorkersElsewhere(
      [
        row({ projectId: 'proj-B', presetId: 'claude' }), // orchestrator preset → excluded
        row({ projectId: 'proj-B', presetId: 'profile-abc-orch' }), // profile lead preset → excluded
        row({ id: 'promoted', projectId: 'proj-B', presetId: 'codex' }), // worker preset but promoted → excluded
        row({ projectId: 'proj-B', presetId: 'codex' }) // genuine worker → counted
      ],
      { ...base, leadIds: ['promoted'] }
    )
    expect(groups).toEqual([{ projectId: 'proj-B', label: 'Menu TSW', count: 1 }])
  })

  it('ignores exited/failed/starting sessions (only running + detached are alive)', () => {
    const groups = groupWorkersElsewhere(
      [
        row({ projectId: 'proj-B', status: 'exited' }),
        row({ projectId: 'proj-B', status: 'failed' }),
        row({ projectId: 'proj-B', status: 'starting' }),
        row({ projectId: 'proj-B', status: 'running' }),
        row({ projectId: 'proj-B', status: 'detached' })
      ],
      base
    )
    expect(groups).toEqual([{ projectId: 'proj-B', label: 'Menu TSW', count: 2 }])
  })

  it('falls back to "Workspace" when a projectId has no known name', () => {
    const groups = groupWorkersElsewhere([row({ projectId: 'proj-unknown' })], base)
    expect(groups).toEqual([{ projectId: 'proj-unknown', label: 'Workspace', count: 1 }])
  })

  it('sorts by count desc, then label asc', () => {
    const groups = groupWorkersElsewhere(
      [
        row({ projectId: null }), // Scratch: 1
        row({ projectId: 'proj-B' }), // Menu TSW: 2
        row({ projectId: 'proj-B' })
      ],
      base
    )
    expect(groups.map((g) => g.label)).toEqual(['Menu TSW', 'Scratch'])
  })

  it('returns [] when there are no workers elsewhere', () => {
    expect(groupWorkersElsewhere([], base)).toEqual([])
  })
})
