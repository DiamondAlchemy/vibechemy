import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatBootLine, createBootLogger } from './bootLog'

const T = new Date('2026-07-01T23:45:11.123Z')

describe('formatBootLine', () => {
  it('renders timestamp + key=value pairs', () => {
    expect(formatBootLine(T, { event: 'boot', packaged: true, port: 4880 })).toBe(
      '2026-07-01T23:45:11.123Z event=boot packaged=true port=4880'
    )
  })

  it('quotes values containing spaces', () => {
    expect(formatBootLine(T, { exe: '/Applications/My Tools/Vibechemy.app/Contents/MacOS/Vibechemy' })).toBe(
      '2026-07-01T23:45:11.123Z exe="/Applications/My Tools/Vibechemy.app/Contents/MacOS/Vibechemy"'
    )
  })
})

describe('createBootLogger', () => {
  it('appends one line per call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-bootlog-'))
    const file = join(dir, 'boot.log')
    const log = createBootLogger(file, { now: () => T })
    log({ event: 'boot', port: 4880 })
    log({ event: 'mcp', status: 'up' })
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('event=boot')
    expect(lines[1]).toContain('status=up')
  })

  it('rotates when the file exceeds maxBytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-bootlog-'))
    const file = join(dir, 'boot.log')
    writeFileSync(file, 'x'.repeat(2048))
    const log = createBootLogger(file, { now: () => T, maxBytes: 1024 })
    log({ event: 'boot' })
    expect(existsSync(`${file}.1`)).toBe(true)
    const fresh = readFileSync(file, 'utf8')
    expect(fresh).toContain('event=boot')
    expect(fresh.length).toBeLessThan(200)
  })

  it('never throws when the directory is unwritable', () => {
    const log = createBootLogger('/nonexistent-dir-xyz/boot.log', { now: () => T })
    expect(() => log({ event: 'boot' })).not.toThrow()
  })
})
