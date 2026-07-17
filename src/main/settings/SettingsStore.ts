import type { DB } from '../db/database'

interface SettingRow {
  value: string
}

/**
 * Thin key-value store over the `settings` table for single-value preferences. Mirrors
 * StandardsStore's better-sqlite3 prepared-statement
 * style. `get` returns null when the key is absent; `set` upserts so a key is never duplicated.
 */
export class SettingsStore {
  constructor(private db: DB) {}

  get(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as SettingRow | undefined
    return r ? r.value : null
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value)
  }
}
