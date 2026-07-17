import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type DB } from '../db/database'
import { SettingsStore } from './SettingsStore'

let db: DB
let store: SettingsStore

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new SettingsStore(db)
})

describe('SettingsStore', () => {
  it('returns null when the key is absent', () => {
    expect(store.get('ui.theme')).toBeNull()
  })

  it('sets then gets a value', () => {
    store.set('ui.theme', 'blueprint')
    expect(store.get('ui.theme')).toBe('blueprint')
  })

  it('overwrites an existing value (upsert, not duplicate)', () => {
    store.set('ui.theme', 'blueprint')
    store.set('ui.theme', 'dark')
    expect(store.get('ui.theme')).toBe('dark')
    const count = db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key='ui.theme'").get() as {
      n: number
    }
    expect(count.n).toBe(1)
  })

  it('keeps independent keys independent', () => {
    store.set('ui.theme', 'blueprint')
    store.set('agent.defaultPreset', 'shell')
    expect(store.get('ui.theme')).toBe('blueprint')
    expect(store.get('agent.defaultPreset')).toBe('shell')
  })
})
