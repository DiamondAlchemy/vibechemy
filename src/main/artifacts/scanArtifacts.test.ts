import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanArtifacts } from './scanArtifacts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'artifacts-scan-'))
  writeFileSync(join(dir, 'report.pdf'), '%PDF-1.4')
  writeFileSync(join(dir, 'chart.png'), 'x')
  writeFileSync(join(dir, 'page.html'), '<h1>hi</h1>')
  writeFileSync(join(dir, 'notes.txt'), 'plain')
  writeFileSync(join(dir, '.hidden'), 'no')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'nested.jpg'), 'x')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('scanArtifacts', () => {
  it('classifies files (incl. nested), skips dotfiles, returns file:// urls', () => {
    const files = scanArtifacts(dir)
    const byName = Object.fromEntries(files.map((f) => [f.name, f]))
    expect(byName['report.pdf'].type).toBe('pdf')
    expect(byName['chart.png'].type).toBe('image')
    expect(byName['page.html'].type).toBe('html')
    expect(byName['notes.txt'].type).toBe('other')
    expect(byName['nested.jpg'].type).toBe('image') // nested
    expect(byName['.hidden']).toBeUndefined() // dotfile skipped
    expect(byName['report.pdf'].url.startsWith('file://')).toBe(true)
    expect(typeof byName['report.pdf'].size).toBe('number')
  })
  it('returns [] for a missing directory', () => {
    expect(scanArtifacts(join(dir, 'does-not-exist'))).toEqual([])
  })
})
