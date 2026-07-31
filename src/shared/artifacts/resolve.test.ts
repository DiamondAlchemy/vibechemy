import { describe, it, expect } from 'vitest'
import { resolveArtifact } from './resolve'
import type { ArtifactFile } from '../types'

const f = (name: string, path: string): ArtifactFile => ({
  name,
  path,
  url: `file://${path}`,
  type: 'other',
  size: 1,
  mtime: 1
})

const files = [f('report.pdf', '/art/report.pdf'), f('shot.png', '/art/sub/shot.png')]

describe('resolveArtifact', () => {
  it('matches an exact full path', () => {
    expect(resolveArtifact(files, '/art/sub/shot.png')?.name).toBe('shot.png')
  })

  it('matches by basename when given just a name', () => {
    expect(resolveArtifact(files, 'report.pdf')?.path).toBe('/art/report.pdf')
  })

  it('matches a basename case-insensitively', () => {
    expect(resolveArtifact(files, 'SHOT.PNG')?.path).toBe('/art/sub/shot.png')
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveArtifact(files, 'missing.txt')).toBeUndefined()
  })

  it('prefers an exact path match over a basename collision', () => {
    const dupes = [f('x.md', '/art/a/x.md'), f('x.md', '/art/b/x.md')]
    expect(resolveArtifact(dupes, '/art/b/x.md')?.path).toBe('/art/b/x.md')
  })
})
