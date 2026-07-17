import { describe, it, expect } from 'vitest'
import { AGENT_CATALOG, familyForPreset } from './catalog'

describe('AGENT_CATALOG', () => {
  it('has unique family ids', () => {
    const ids = AGENT_CATALOG.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('gives every family a binary and at least one backed preset', () => {
    for (const f of AGENT_CATALOG) {
      expect(f.bin.length).toBeGreaterThan(0)
      expect(f.presets.length).toBeGreaterThan(0)
    }
  })
  it('keeps auth detection artifact-only: an existing-file path or an output-matching command', () => {
    for (const f of AGENT_CATALOG) {
      if (f.authFile) expect(f.authFile.startsWith('~') || f.authFile.startsWith('/')).toBe(true)
      if (f.authCmd) {
        expect(f.authCmd.cmd.length).toBeGreaterThan(0)
        expect(() => new RegExp(f.authCmd!.ok, 'i')).not.toThrow()
      }
    }
  })
})

describe('familyForPreset', () => {
  it('maps a preset chip to its family', () => {
    expect(familyForPreset('claude-opus')?.id).toBe('claude')
    expect(familyForPreset('opencode-glm')?.id).toBe('opencode')
  })
  it('returns undefined for an unknown preset', () => {
    expect(familyForPreset('no-such-preset')).toBeUndefined()
  })
})
