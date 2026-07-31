import { describe, it, expect } from 'vitest'
import { classifyArtifact } from './classify'

describe('classifyArtifact', () => {
  it('maps known extensions, case-insensitively', () => {
    expect(classifyArtifact('report.PDF')).toBe('pdf')
    expect(classifyArtifact('chart.png')).toBe('image')
    expect(classifyArtifact('a.JPEG')).toBe('image')
    expect(classifyArtifact('diagram.svg')).toBe('image')
    expect(classifyArtifact('page.html')).toBe('html')
    expect(classifyArtifact('page.htm')).toBe('html')
  })
  it('falls back to other for unknown / no extension', () => {
    expect(classifyArtifact('notes.txt')).toBe('other')
    expect(classifyArtifact('Makefile')).toBe('other')
    expect(classifyArtifact('archive.tar.gz')).toBe('other')
  })
})
