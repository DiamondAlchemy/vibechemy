import { describe, it, expect } from 'vitest'
import { isClaudeCli } from './cliKind'

describe('isClaudeCli', () => {
  it('matches plain and flagged claude commands', () => {
    expect(isClaudeCli('claude')).toBe(true)
    expect(isClaudeCli('claude --mcp-config /x/mc.json --model opus')).toBe(true)
  })
  it('matches absolute paths to the claude binary', () => {
    expect(isClaudeCli('/opt/homebrew/bin/claude --model opus')).toBe(true)
  })
  it('rejects other CLIs, including ones mentioning claude in args', () => {
    expect(isClaudeCli('codex --full-auto')).toBe(false)
    expect(isClaudeCli('opencode run')).toBe(false)
    expect(isClaudeCli('gemini')).toBe(false)
    expect(isClaudeCli('echo claude')).toBe(false)
    expect(isClaudeCli('')).toBe(false)
  })
})
