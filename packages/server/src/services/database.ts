import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'signalforge.db');

import type BetterSqlite3 from 'better-sqlite3';
const db: BetterSqlite3.Database = new Database(DB_PATH);

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS logbook (
    id TEXT PRIMARY KEY,
    callsign TEXT NOT NULL,
    frequency REAL NOT NULL,
    band TEXT NOT NULL,
    mode TEXT NOT NULL,
    rst_sent TEXT DEFAULT '59',
    rst_received TEXT DEFAULT '59',
    date_time_on INTEGER NOT NULL,
    date_time_off INTEGER,
    name TEXT,
    qth TEXT,
    grid_square TEXT,
    power REAL,
    notes TEXT,
    qsl_sent TEXT DEFAULT 'N',
    qsl_received TEXT DEFAULT 'N',
    qsl_via TEXT,
    eqsl INTEGER DEFAULT 0,
    lotw INTEGER DEFAULT 0,
    operator TEXT,
    my_callsign TEXT,
    my_grid TEXT,
    contest_id TEXT,
    serial_sent INTEGER,
    serial_received INTEGER,
    recording_id TEXT,
    waterfall_id TEXT,
    tags TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logbook_callsign ON logbook(callsign);
  CREATE INDEX IF NOT EXISTS idx_logbook_band ON logbook(band);
  CREATE INDEX IF NOT EXISTS idx_logbook_mode ON logbook(mode);
  CREATE INDEX IF NOT EXISTS idx_logbook_date ON logbook(date_time_on);

  CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    frequency REAL NOT NULL,
    mode TEXT,
    sample_rate INTEGER,
    duration_ms INTEGER DEFAULT 0,
    file_path TEXT,
    format TEXT DEFAULT 'iq',
    size_bytes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'recording',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    frequency REAL NOT NULL,
    name TEXT NOT NULL,
    mode TEXT,
    category TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS geofence_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'circle',
    data TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    alert_on_enter INTEGER DEFAULT 1,
    alert_on_exit INTEGER DEFAULT 1,
    tracked_types TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    satellite TEXT,
    start_time INTEGER,
    end_time INTEGER,
    max_elevation REAL,
    frequency REAL,
    recording_id TEXT,
    notes TEXT
  );
`);

export { db, DATA_DIR, RECORDINGS_DIR };
export default db;
