import { describe, it, expect } from 'vitest'
import { bracketBulkInput } from './bracketPaste'

const START = '\x1b[200~'
const END = '\x1b[201~'

describe('bracketBulkInput', () => {
  it('leaves a single typed character untouched', () => {
    expect(bracketBulkInput('a', true)).toBe('a')
  })

  it('wraps a multi-character plain-text burst when bracketed paste is on', () => {
    expect(bracketBulkInput('hello world', true)).toBe(`${START}hello world${END}`)
  })

  it('wraps a multi-line burst so the CLI inserts it as one block without premature submit', () => {
    expect(bracketBulkInput('line one\nline two', true)).toBe(`${START}line one\nline two${END}`)
  })

  it('does NOT wrap when the program has not enabled bracketed paste (markers would be literal junk)', () => {
    expect(bracketBulkInput('hello world', false)).toBe('hello world')
  })

  it('does NOT double-wrap input that already carries the paste markers (a real Cmd+V)', () => {
    const pasted = `${START}already pasted${END}`
    expect(bracketBulkInput(pasted, true)).toBe(pasted)
  })

  it('does NOT wrap control/escape sequences (terminal responses, arrow keys)', () => {
    expect(bracketBulkInput('\x1b[?1;2c', true)).toBe('\x1b[?1;2c')
    expect(bracketBulkInput('\x1b[A', true)).toBe('\x1b[A')
  })

  it('leaves the empty string untouched', () => {
    expect(bracketBulkInput('', true)).toBe('')
  })
})
