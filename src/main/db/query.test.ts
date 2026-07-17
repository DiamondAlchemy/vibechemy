import { describe, it, expect } from 'vitest'
import { buildSelect } from './query'

describe('buildSelect', () => {
  it('emits no WHERE when there are no parts', () => {
    const { sql, args } = buildSelect('knowledge', [], 'updated_at DESC')
    expect(sql).toBe('SELECT * FROM knowledge ORDER BY updated_at DESC')
    expect(sql).not.toContain('WHERE')
    expect(args).toEqual([])
  })

  it('joins parts with AND and collects args in order', () => {
    const { sql, args } = buildSelect(
      'knowledge',
      [
        { clause: 'project_id IS ?', arg: 'p1' },
        { clause: 'status = ?', arg: 'open' }
      ],
      'updated_at DESC'
    )
    expect(sql).toBe('SELECT * FROM knowledge WHERE project_id IS ? AND status = ? ORDER BY updated_at DESC')
    expect(args).toEqual(['p1', 'open'])
  })

  it('skips null and false parts, keeps a null arg (the project_id IS ? scoping case)', () => {
    const { sql, args } = buildSelect(
      'knowledge',
      [null, { clause: 'project_id IS ?', arg: null }, false],
      'updated_at DESC'
    )
    expect(sql).toBe('SELECT * FROM knowledge WHERE project_id IS ? ORDER BY updated_at DESC')
    expect(args).toEqual([null])
  })

  it('flattens an array arg for multi-placeholder clauses', () => {
    const { sql, args } = buildSelect(
      'knowledge',
      [
        { clause: 'project_id IS ?', arg: 'p1' },
        { clause: '(title LIKE ? OR detail LIKE ?)', arg: ['%x%', '%x%'] }
      ],
      'updated_at DESC'
    )
    expect(sql).toBe(
      'SELECT * FROM knowledge WHERE project_id IS ? AND (title LIKE ? OR detail LIKE ?) ORDER BY updated_at DESC'
    )
    expect(args).toEqual(['p1', '%x%', '%x%'])
  })
})
