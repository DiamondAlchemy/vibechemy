import { describe, it, expect } from 'vitest'
import { shortHome } from './homePath'

describe('shortHome', () => {
  it('collapses a macOS home directory', () => {
    expect(shortHome('/Users/dustin/code/vibechemy')).toBe('~/code/vibechemy')
  })

  it('collapses a Linux home directory', () => {
    expect(shortHome('/home/dustin/code/vibechemy')).toBe('~/code/vibechemy')
  })

  it('leaves a path outside any home directory alone', () => {
    expect(shortHome('/opt/work/repo')).toBe('/opt/work/repo')
    expect(shortHome('/var/tmp')).toBe('/var/tmp')
  })

  it('only collapses at the start, never mid-path', () => {
    expect(shortHome('/srv/Users/dustin/repo')).toBe('/srv/Users/dustin/repo')
  })

  it('does not eat a directory that merely starts with the home prefix', () => {
    // /home/dustinsson is a different user than /home/dustin — the [^/]+ must consume the whole
    // segment, not a prefix of it.
    expect(shortHome('/home/dustinsson/repo')).toBe('~/repo')
    expect(shortHome('/home/dustin')).toBe('~')
  })
})
