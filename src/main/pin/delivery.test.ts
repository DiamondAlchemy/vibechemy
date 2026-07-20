import { describe, expect, it } from 'vitest'
import type { SessionRecord, SessionStatus } from '@shared/types'
import { planPinDeliveries } from './delivery'

function session(
  id: string,
  projectId: string | null,
  status: SessionStatus = 'running',
  presetId = 'codex'
): SessionRecord {
  return {
    id,
    projectId,
    presetId,
    tmuxName: `tmux-${id}`,
    cwd: '/tmp/project',
    title: id,
    status,
    createdAt: 1,
    lastSeenAt: 1
  }
}

describe('planPinDeliveries', () => {
  it('targets every live agent in the changed workspace only', () => {
    const deliveries = planPinDeliveries(
      [
        session('running', 'project-a'),
        session('detached', 'project-a', 'detached', 'claude-opus'),
        session('other-project', 'project-b'),
        session('exited', 'project-a', 'exited'),
        session('shell', 'project-a', 'running', 'shell'),
        session('scratch', null)
      ],
      'project-a',
      'old decision',
      'API shape is /v2/search?q='
    )

    expect(deliveries).toEqual([
      {
        sessionId: 'running',
        tmuxName: 'tmux-running',
        text: '[PIN UPDATED] API shape is /v2/search?q='
      },
      {
        sessionId: 'detached',
        tmuxName: 'tmux-detached',
        text: '[PIN UPDATED] API shape is /v2/search?q='
      }
    ])
  })

  it('does not deliver a normalized no-op and clearly announces a cleared pin', () => {
    const rows = [session('worker', 'project-a')]
    expect(planPinDeliveries(rows, 'project-a', ' keep auth.ts ', 'keep  auth.ts')).toEqual([])
    expect(planPinDeliveries(rows, 'project-a', 'keep auth.ts', '')).toEqual([
      {
        sessionId: 'worker',
        tmuxName: 'tmux-worker',
        text: '[PIN UPDATED] (cleared)'
      }
    ])
  })
})
