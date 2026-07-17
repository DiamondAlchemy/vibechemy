import { describe, it, expect } from 'vitest'
import { keyTokenToBytes, KEY_BAR_LAYOUT } from './keybar'

describe('keyTokenToBytes', () => {
  it('maps control tokens to the correct escape sequences', () => {
    expect(keyTokenToBytes('esc')).toBe('\x1b')
    expect(keyTokenToBytes('ctrl-c')).toBe('\x03')
    expect(keyTokenToBytes('tab')).toBe('\t')
    expect(keyTokenToBytes('enter')).toBe('\r')
    expect(keyTokenToBytes('up')).toBe('\x1b[A')
    expect(keyTokenToBytes('down')).toBe('\x1b[B')
    expect(keyTokenToBytes('right')).toBe('\x1b[C')
    expect(keyTokenToBytes('left')).toBe('\x1b[D')
    expect(keyTokenToBytes('pipe')).toBe('|')
    expect(keyTokenToBytes('tilde')).toBe('~')
  })

  it('exposes a stable bar layout of known tokens', () => {
    for (const t of KEY_BAR_LAYOUT) expect(typeof keyTokenToBytes(t)).toBe('string')
  })
})
