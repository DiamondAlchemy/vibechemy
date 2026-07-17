export type DictationPhase = 'idle' | 'recording' | 'transcribing'

export interface DictationState {
  phase: DictationPhase
  targetId: string | null
  error: string | null
}

export type DictationEvent =
  | { type: 'start'; targetId: string }
  | { type: 'release' }
  | { type: 'done' }
  | { type: 'fail'; message: string }
  | { type: 'cancel' }

export const DICTATION_IDLE: DictationState = { phase: 'idle', targetId: null, error: null }

export function dictationReducer(state: DictationState, event: DictationEvent): DictationState {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' ? { phase: 'recording', targetId: event.targetId, error: null } : state
    case 'release':
      return state.phase === 'recording' ? { ...state, phase: 'transcribing' } : state
    case 'done':
      return state.phase === 'idle' ? state : DICTATION_IDLE
    case 'fail':
      return state.phase === 'idle' ? state : { phase: 'idle', targetId: null, error: event.message }
    case 'cancel':
      return state.phase === 'idle' ? state : DICTATION_IDLE
  }
}

export interface DictationStore {
  get: () => DictationState
  dispatch: (event: DictationEvent) => void
  subscribe: (callback: () => void) => () => void
}

export function createDictationStore(): DictationStore {
  let state = DICTATION_IDLE
  const subscribers = new Set<() => void>()
  return {
    get: () => state,
    dispatch(event) {
      const next = dictationReducer(state, event)
      if (next === state) return
      state = next
      subscribers.forEach((callback) => callback())
    },
    subscribe(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    }
  }
}

export const dictationStore = createDictationStore()
export const dictationAmplitude = { current: 0 }
