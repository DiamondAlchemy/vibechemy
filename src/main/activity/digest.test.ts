import { describe, it, expect } from 'vitest'
import { buildDigest, startOfDay } from './digest'
import type { ActivityEvent, KnowledgeEntry } from '@shared/types'

const NOON = Date.parse('2026-06-04T12:00:00')
const SINCE = startOfDay(NOON)

const activity = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: 'e',
  ts: NOON,
  projectId: 'p1',
  kind: 'spawn',
  presetId: null,
  branch: null,
  summary: 'Spawned Codex',
  meta: null,
  ...over
})

const k = (over: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: 'k',
  projectId: 'p1',
  type: 'feature',
  title: '',
  detail: null,
  status: 'shipped',
  branch: null,
  createdAt: NOON,
  updatedAt: NOON,
  resolvedAt: NOON,
  ...over
})

const nameOf = (pid: string | null): string => (pid === 'p1' ? 'Example Project' : pid ? 'Other' : 'Scratch')

describe('buildDigest (outcome-oriented)', () => {
  it('summarizes features added / bugs fixed / in-progress / open bugs per project', () => {
    const events = [activity()]
    const knowledge: KnowledgeEntry[] = [
      k({ type: 'feature', title: 'Activity strip', status: 'shipped', resolvedAt: NOON }),
      k({ type: 'feature', title: 'Wiki map', status: 'building', resolvedAt: null }),
      k({ type: 'bug', title: 'Copy/paste broken', status: 'fixed', resolvedAt: NOON }),
      k({ type: 'bug', title: 'Terminal freeze', status: 'fixing', resolvedAt: null }),
      k({ type: 'bug', title: 'Layout popover clipped', status: 'open', resolvedAt: null })
    ]
    const md = buildDigest(events, knowledge, nameOf, SINCE)

    expect(md).toContain('## Example Project')
    expect(md).toContain('**Features added:** 1 — Activity strip')
    expect(md).toContain('**Bugs fixed:** 1 — Copy/paste broken')
    expect(md).toContain('**In progress:**')
    expect(md).toContain('Wiki map')
    expect(md).toContain('Terminal freeze')
    expect(md).toContain('**Open bugs:** 1 — Layout popover clipped')
  })

  it('a quiet day whose only KB entries are old/resolved reads as "No activity" (not a log nudge)', () => {
    const yesterday = SINCE - 1000
    const knowledge = [k({ type: 'feature', title: 'Old feature', status: 'shipped', resolvedAt: yesterday })]
    const md = buildDigest([], knowledge, nameOf, SINCE)
    expect(md).not.toContain('Features added:')
    expect(md).toContain('No activity recorded') // NOT the "nothing's in the knowledge base" nudge
    expect(md).not.toContain('log_outcome')
  })

  it('reports an empty window cleanly', () => {
    expect(buildDigest([], [], nameOf, SINCE)).toContain('No activity recorded')
  })

  it('nudges logging when work happened but nothing is in the KB', () => {
    // a spawn happened (mechanics) but there are no knowledge entries
    const events: ActivityEvent[] = [activity()]
    const md = buildDigest(events, [], nameOf, SINCE)
    expect(md).toContain('nothing')
    expect(md).toContain('log_outcome')
  })
})
