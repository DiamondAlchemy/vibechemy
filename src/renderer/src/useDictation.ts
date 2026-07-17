import { useEffect } from 'react'
import { dictationAmplitude, dictationStore } from './dictation'
import { paneRegistry } from './paneRegistry'
import { createRecorder, type Recorder } from './voice/recorder'
import { dictationChime } from './voice/chime'

export const ARM_DELAY_MS = 140
export const MIN_HOLD_MS = 250
export const AUTO_SUBMIT_DELAY_MS = 300

/** Real text editors block the global shortcut; xterm's hidden textarea is the intended target. */
export function isDictationBlocked(
  element: { tagName?: string; isContentEditable?: boolean; className?: string } | null
): boolean {
  if (!element?.tagName) return false
  if (typeof element.className === 'string' && element.className.includes('xterm-helper-textarea')) return false
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable === true
}

/** Hold Right-Option, speak, then release to insert local transcription in the focused pane. */
export function useDictation(): void {
  useEffect(() => {
    let recorder: Recorder | null = null
    let holding = false
    let aborted = false
    let targetId: string | null = null
    let startedAt = 0
    let armTimer: number | null = null
    let generation = 0

    const clearArmTimer = (): void => {
      if (armTimer === null) return
      window.clearTimeout(armTimer)
      armTimer = null
    }

    const finish = async (abort = false): Promise<void> => {
      if (!holding && !recorder) return
      clearArmTimer()
      const finishingGeneration = generation
      generation++
      const currentRecorder = recorder
      const currentTarget = targetId
      const wasAborted = abort || aborted
      const heldMs = Date.now() - startedAt
      recorder = null
      holding = false
      aborted = false
      targetId = null

      // Releasing before the arm delay is a silent no-op: no chime, mic, or UI was activated.
      if (!currentRecorder) return
      const wav = await currentRecorder.stop().catch(() => null)
      if (finishingGeneration + 1 !== generation || dictationStore.get().phase !== 'recording') return
      if (wasAborted || heldMs < MIN_HOLD_MS || !wav) {
        dictationStore.dispatch({ type: 'cancel' })
        return
      }

      dictationChime('stop')
      dictationStore.dispatch({ type: 'release' })
      try {
        const text = (await window.api.voiceTranscribe(wav)).trim()
        if (!text) {
          dictationChime('soft')
          dictationStore.dispatch({ type: 'done' })
          return
        }
        const capability = currentTarget ? paneRegistry.capabilityFor(currentTarget) : null
        if (!capability?.typeText) {
          dictationChime('error')
          dictationStore.dispatch({ type: 'fail', message: 'target pane closed — transcript dropped' })
          return
        }

        // TerminalPane owns bracketed-paste framing, so dictated text is inserted without Enter.
        capability.typeText(text)
        if ((await window.api.getSetting('voice.autoSubmit')) === 'true' && currentTarget) {
          window.setTimeout(() => {
            // Re-resolve the capability so a closed or replaced pane cannot receive a delayed Enter.
            const live = paneRegistry.capabilityFor(currentTarget)
            if (live === capability) live.pressEnter?.()
          }, AUTO_SUBMIT_DELAY_MS)
        }
        dictationStore.dispatch({ type: 'done' })
      } catch (error) {
        dictationChime('error')
        dictationStore.dispatch({ type: 'fail', message: 'transcription failed' })
        console.error('[dictation] transcription failed:', error)
      }
    }

    const abortHold = (): void => {
      if (!holding) return
      aborted = true
      void finish(true)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (holding && event.code !== 'AltRight') {
        // A real Option shortcut wins. The shortcut proceeds untouched and capture is cancelled.
        abortHold()
        return
      }
      if (event.code !== 'AltRight' || event.repeat || holding) return
      if (dictationStore.get().phase !== 'idle') return
      if (isDictationBlocked(event.target as HTMLElement | null)) return
      const focusedPane = paneRegistry.lastFocusedPaneId()
      if (!focusedPane) return

      generation++
      const thisGeneration = generation
      holding = true
      aborted = false
      targetId = focusedPane
      startedAt = Date.now()
      armTimer = window.setTimeout(() => {
        armTimer = null
        if (!holding || aborted || generation !== thisGeneration) return
        const nextRecorder = createRecorder((amplitude) => {
          dictationAmplitude.current = amplitude
        })
        recorder = nextRecorder
        dictationStore.dispatch({ type: 'start', targetId: focusedPane })
        dictationChime('start')
        void nextRecorder.start().catch((error) => {
          nextRecorder.dispose()
          if (generation !== thisGeneration) return
          generation++
          recorder = null
          holding = false
          targetId = null
          dictationChime('error')
          dictationStore.dispatch({ type: 'fail', message: 'microphone unavailable' })
          console.error('[dictation] microphone unavailable:', error)
        })
      }, ARM_DELAY_MS)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'AltRight' && holding) void finish()
    }
    const onWindowBlur = (): void => {
      if (holding) void finish()
    }
    const onPointer = (): void => abortHold()

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('wheel', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('wheel', onPointer, true)
      clearArmTimer()
      generation++
      holding = false
      recorder?.dispose()
      recorder = null
      if (dictationStore.get().phase !== 'idle') dictationStore.dispatch({ type: 'cancel' })
    }
  }, [])
}
