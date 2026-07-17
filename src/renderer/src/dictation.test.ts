import { describe, expect, it } from 'vitest'
import { createDictationStore, DICTATION_IDLE, dictationReducer, type DictationState } from './dictation'

describe('dictationReducer', () => {
  const idle: DictationState = { ...DICTATION_IDLE }

  it('records the snapshotted target and moves through transcription to idle', () => {
    let state = dictationReducer(idle, { type: 'start', targetId: 'pane-1' })
    expect(state).toEqual({ phase: 'recording', targetId: 'pane-1', error: null })
    state = dictationReducer(state, { type: 'release' })
    expect(state).toEqual({ phase: 'transcribing', targetId: 'pane-1', error: null })
    expect(dictationReducer(state, { type: 'done' })).toEqual(DICTATION_IDLE)
  })

  it('cancels taps silently and records a real failure', () => {
    const recording = dictationReducer(idle, { type: 'start', targetId: 'pane-1' })
    expect(dictationReducer(recording, { type: 'cancel' })).toEqual(DICTATION_IDLE)
    expect(dictationReducer(recording, { type: 'fail', message: 'microphone unavailable' })).toEqual({
      phase: 'idle',
      targetId: null,
      error: 'microphone unavailable'
    })
  })

  it('ignores illegal late transitions', () => {
    expect(dictationReducer(idle, { type: 'release' })).toBe(idle)
    expect(dictationReducer(idle, { type: 'done' })).toBe(idle)
  })
})

describe('dictationStore', () => {
  it('notifies once per real state change and supports unsubscribe', () => {
    const store = createDictationStore()
    const phases: string[] = []
    const unsubscribe = store.subscribe(() => phases.push(store.get().phase))
    store.dispatch({ type: 'start', targetId: 'pane-1' })
    store.dispatch({ type: 'release' })
    store.dispatch({ type: 'done' })
    store.dispatch({ type: 'done' })
    unsubscribe()
    store.dispatch({ type: 'start', targetId: 'pane-2' })
    expect(phases).toEqual(['recording', 'transcribing', 'idle'])
  })
})
