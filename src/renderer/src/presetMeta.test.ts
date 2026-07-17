import { describe, expect, it } from 'vitest'
import { panePresetMeta } from './presetMeta'

describe('panePresetMeta', () => {
  it('presents the personal-agent row with its configured pill identity', () => {
    expect(panePresetMeta('personal-agent', 'Example Agent')).toEqual({ color: 'cyan', label: '★ Example Agent' })
  })
})
