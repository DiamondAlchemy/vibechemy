import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_MOTION_KEY,
  BACKGROUND_MOTIONS,
  DEFAULT_BACKGROUND_MOTION,
  parseBackgroundMotion
} from './backgroundMotion'

describe('background motion setting', () => {
  it('uses the stable SettingsStore key and lively default', () => {
    expect(BACKGROUND_MOTION_KEY).toBe('appearance.bgMotion')
    expect(DEFAULT_BACKGROUND_MOTION).toBe('lively')
    expect(parseBackgroundMotion(null)).toBe('lively')
    expect(parseBackgroundMotion('unknown')).toBe('lively')
  })

  it('accepts every supported persisted value', () => {
    expect(BACKGROUND_MOTIONS.map(parseBackgroundMotion)).toEqual(['off', 'calm', 'lively'])
  })
})
