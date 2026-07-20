import type { SessionRecord } from '@shared/types'

/** A pane whose CLI exited UNEXPECTEDLY this app run — kept visible until revived or dismissed. */
export interface Tombstone {
  session: SessionRecord
  exitedAt: number
  reviving: boolean
  error: string | null
  lastOutput: string | null
  exitCode: number | null
  /** The preset's CLI isn't installed on this machine — revive is pointless; point at Settings → Agents. */
  missingCli?: boolean
}

export type TombstoneAction =
  | {
      type: 'exited'
      session: SessionRecord
      at: number
      lastOutput?: string | null
      exitCode?: number | null
      missingCli?: boolean
    }
  | { type: 'dismiss'; id: string }
  | { type: 'reviveStart'; id: string }
  | { type: 'reviveOk'; id: string }
  | { type: 'reviveFailed'; id: string; message: string }

export function tombstonesReducer(state: Tombstone[], action: TombstoneAction): Tombstone[] {
  switch (action.type) {
    case 'exited':
      if (state.some((t) => t.session.id === action.session.id)) {
        return state.map((t) =>
          t.session.id === action.session.id
            ? {
                ...t,
                lastOutput: action.lastOutput ?? t.lastOutput,
                exitCode: action.exitCode ?? t.exitCode
              }
            : t
        )
      }
      return [
        ...state,
        {
          session: action.session,
          exitedAt: action.at,
          reviving: false,
          error: null,
          lastOutput: action.lastOutput ?? null,
          exitCode: action.exitCode ?? null,
          missingCli: action.missingCli
        }
      ]
    case 'dismiss':
    case 'reviveOk': {
      const next = state.filter((t) => t.session.id !== action.id)
      return next.length === state.length ? state : next
    }
    case 'reviveStart':
      return state.map((t) => (t.session.id === action.id ? { ...t, reviving: true, error: null } : t))
    case 'reviveFailed':
      return state.map((t) => (t.session.id === action.id ? { ...t, reviving: false, error: action.message } : t))
  }
}
