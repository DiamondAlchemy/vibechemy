import { describe, expect, it } from 'vitest'
import { isMicrophonePermission } from './permissions'

describe('isMicrophonePermission', () => {
  it('allows an audio-only media request', () => {
    expect(isMicrophonePermission('media', ['audio'])).toBe(true)
  })

  it('denies camera, combined media, and unrelated permissions', () => {
    expect(isMicrophonePermission('media', ['video'])).toBe(false)
    expect(isMicrophonePermission('media', ['audio', 'video'])).toBe(false)
    expect(isMicrophonePermission('notifications')).toBe(false)
    expect(isMicrophonePermission('media')).toBe(false)
  })
})
