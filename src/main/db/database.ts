import Database from 'better-sqlite3'

export type DB = Database.Database

// Additive, idempotent column migration for an existing DB (sqlite has no
// "ADD COLUMN IF NOT EXISTS"). Safe to run on every open.
function ensureColumn(db: DB, table: string, col: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
  }
}

export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, command TEXT NOT NULL,
      args_json TEXT NOT NULL, env_json TEXT NOT NULL, default_cwd TEXT,
      icon TEXT, color TEXT, is_seed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, project_id TEXT, preset_id TEXT NOT NULL,
      tmux_name TEXT NOT NULL UNIQUE, cwd TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, project_id TEXT,
      kind TEXT NOT NULL, preset_id TEXT, branch TEXT,
      summary TEXT NOT NULL, meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL,
      title TEXT NOT NULL, detail TEXT, status TEXT NOT NULL, branch TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project_id);
    CREATE TABLE IF NOT EXISTS standards (
      id TEXT PRIMARY KEY, project_id TEXT, category TEXT NOT NULL,
      rule TEXT NOT NULL, detail TEXT, status TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_standards_project ON standards(project_id);
    CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
  `)
  ensureColumn(db, 'sessions', 'branch', 'TEXT')
  ensureColumn(db, 'sessions', 'origin_root', 'TEXT')
  ensureColumn(db, 'sessions', 'task', 'TEXT')
  ensureColumn(db, 'sessions', 'owner', 'TEXT')
  ensureColumn(db, 'sessions', 'task_state', 'TEXT')
  ensureColumn(db, 'sessions', 'callsign', 'TEXT')
  return db
}
