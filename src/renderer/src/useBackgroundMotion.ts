import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BACKGROUND_MOTION_KEY,
  DEFAULT_BACKGROUND_MOTION,
  parseBackgroundMotion,
  type BackgroundMotion
} from '@shared/appearance/backgroundMotion'
import { api } from './api'

export interface UseBackgroundMotion {
  backgroundMotion: BackgroundMotion
  setBackgroundMotion: (motion: BackgroundMotion) => void
}

/**
 * App-owned appearance state: load once from SettingsStore, then update optimistically so the
 * background responds in the same frame while the durable write crosses IPC.
 */
export function useBackgroundMotion(): UseBackgroundMotion {
  const [backgroundMotion, setBackgroundMotionState] = useState<BackgroundMotion>(DEFAULT_BACKGROUND_MOTION)
  const alive = useRef(true)
  const changedLocally = useRef(false)

  useEffect(() => {
    alive.current = true
    void api
      .getSetting(BACKGROUND_MOTION_KEY)
      .then((raw) => {
        if (alive.current && !changedLocally.current) setBackgroundMotionState(parseBackgroundMotion(raw))
      })
      .catch((error) => console.error('[appearance] background motion load failed', error))
    return () => {
      alive.current = false
    }
  }, [])

  const setBackgroundMotion = useCallback((motion: BackgroundMotion): void => {
    changedLocally.current = true
    setBackgroundMotionState(motion)
    void api
      .setSetting(BACKGROUND_MOTION_KEY, motion)
      .catch((error) => console.error('[appearance] background motion save failed', error))
  }, [])

  return { backgroundMotion, setBackgroundMotion }
}
