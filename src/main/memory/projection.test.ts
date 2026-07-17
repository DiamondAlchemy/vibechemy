import { describe, it, expect } from 'vitest'
import { BLOCK_BEGIN, BLOCK_END, nativeFileName, mergeManagedBlock, stripManagedBlock, buildBrief } from './projection'

describe('nativeFileName', () => {
  it('maps CLI commands to their native context file', () => {
    expect(nativeFileName('claude')).toBe('CLAUDE.md')
    expect(nativeFileName('claude --model opus')).toBe('CLAUDE.md')
    expect(nativeFileName('gemini')).toBe('GEMINI.md')
    expect(nativeFileName('codex')).toBe('AGENTS.md')
    expect(nativeFileName('opencode')).toBe('AGENTS.md')
    expect(nativeFileName('agy')).toBe('AGENTS.md')
    expect(nativeFileName('zsh')).toBeNull()
    expect(nativeFileName('sleep')).toBeNull()
    expect(nativeFileName('sh')).toBeNull()
  })
})

describe('mergeManagedBlock', () => {
  it('creates a block in an empty file', () => {
    const out = mergeManagedBlock('', 'hello')
    expect(out).toContain(BLOCK_BEGIN)
    expect(out).toContain('hello')
    expect(out).toContain(BLOCK_END)
  })

  it('appends a block to existing content, preserving it', () => {
    const out = mergeManagedBlock('# My Notes\nkeep me', 'brief')
    expect(out).toContain('# My Notes')
    expect(out).toContain('keep me')
    expect(out).toContain('brief')
    // user content comes before the managed block
    expect(out.indexOf('keep me')).toBeLessThan(out.indexOf(BLOCK_BEGIN))
  })

  it('replaces an existing block, preserving content before AND after it', () => {
    const first = mergeManagedBlock('before\n\n', 'v1') + '\nafter-text'
    expect(first).toContain('v1')
    const second = mergeManagedBlock(first, 'v2')
    expect(second).toContain('v2')
    expect(second).not.toContain('v1')
    expect(second).toContain('before')
    expect(second).toContain('after-text')
    // exactly one block
    expect(second.split(BLOCK_BEGIN).length - 1).toBe(1)
  })

  it('is idempotent for the same body', () => {
    const a = mergeManagedBlock('x', 'same')
    const b = mergeManagedBlock(a, 'same')
    expect(b).toBe(a)
  })
})

describe('stripManagedBlock', () => {
  it('removes the managed block and returns the rest', () => {
    const withBlock = mergeManagedBlock('user stuff', 'briefy')
    const stripped = stripManagedBlock(withBlock)
    expect(stripped).toContain('user stuff')
    expect(stripped).not.toContain('briefy')
    expect(stripped).not.toContain(BLOCK_BEGIN)
  })
  it('returns content unchanged when no block present', () => {
    expect(stripManagedBlock('plain')).toBe('plain')
  })
})

describe('buildBrief', () => {
  it('includes project name, global and project sections when present', () => {
    const b = buildBrief({ projectName: 'Example Project', global: 'I am Test User', project: 'Next.js dashboard' })
    expect(b).toContain('Example Project')
    expect(b).toContain('I am Test User')
    expect(b).toContain('Next.js dashboard')
  })
  it('omits empty sections gracefully', () => {
    const b = buildBrief({ projectName: 'X', global: '', project: '' })
    expect(b).toContain('X')
    expect(typeof b).toBe('string')
  })
  it('omits the project section when includeProject is false', () => {
    const b = buildBrief({ projectName: 'X', global: 'me', project: 'PROJECT_BODY', includeProject: false })
    expect(b).toContain('me')
    expect(b).not.toContain('PROJECT_BODY')
  })
  it('always includes learnings, even when includeProject is false', () => {
    const b = buildBrief({
      projectName: 'X',
      global: 'g',
      project: 'PROJBODY',
      learnings: 'LEARNED_THING',
      includeProject: false
    })
    expect(b).not.toContain('PROJBODY')
    expect(b).toContain('Shared learnings')
    expect(b).toContain('LEARNED_THING')
  })
  it('injects the coding-standards section when standards are present', () => {
    const b = buildBrief({ projectName: 'X', global: '', project: '', standards: '- Use named exports.' })
    expect(b).toContain('Coding standards (follow these)')
    expect(b).toContain('- Use named exports.')
  })
  it('omits the standards section when there are no standards', () => {
    expect(buildBrief({ projectName: 'X', global: 'g', project: 'p' })).not.toContain('Coding standards')
    expect(buildBrief({ projectName: 'X', global: 'g', project: 'p', standards: '   ' })).not.toContain(
      'Coding standards'
    )
  })
  it('places normative standards ABOVE the advisory learnings', () => {
    const b = buildBrief({ projectName: 'X', global: '', project: '', standards: '- RULE_X', learnings: 'LEARN_Y' })
    expect(b.indexOf('RULE_X')).toBeLessThan(b.indexOf('LEARN_Y'))
  })
})
