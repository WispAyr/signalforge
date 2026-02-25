// ============================================================================
// SignalForge — Pager SQLite Database
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'pager.db');

// UK capcode ranges for seed data
const UK_CAPCODE_RANGES = [
  { min: 0, max: 199999, category: 'Test/Admin' },
  { min: 200000, max: 499999, category: 'Emergency Services' },
  { min: 500000, max: 999999, category: 'NHS/Health' },
  { min: 1000000, max: 1999999, category: 'Utilities/Commercial' },
  { min: 2000000, max: 99999999, category: 'General' },
];

const SEED_ALERTS = [
  { keyword: 'FIRE', category: 'emergency', priority: 'high' },
  { keyword: 'CARDIAC', category: 'medical', priority: 'high' },
  { keyword: 'RTC', category: 'emergency', priority: 'high' },
  { keyword: 'AMBULANCE', category: 'medical', priority: 'high' },
  { keyword: 'COLLAPSE', category: 'emergency', priority: 'medium' },
  { keyword: 'FLOOD', category: 'emergency', priority: 'medium' },
  { keyword: 'EXPLOSION', category: 'emergency', priority: 'high' },
  { keyword: 'HAZMAT', category: 'emergency', priority: 'high' },
];

// Control character stripping
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function cleanContent(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}

export function classifyCapcode(capcode: number): string {
  for (const r of UK_CAPCODE_RANGES) {
    if (capcode >= r.min && capcode <= r.max) return r.category;
  }
  return 'General';
}

export interface DbMessage {
  id: string;
  timestamp: number;
  frequency: number | null;
  protocol: string;
  baud_rate: number;
  capcode: number;
  function: number;
  content_raw: string;
  content_clean: string;
  type: string;
  duplicate_group_id: string | null;
  is_empty: number;
}

export interface DbCapcode {
  capcode: number;
  label: string;
  category: string;
  notes: string;
  first_seen: number;
  last_seen: number;
  message_count: number;
}

export interface DbAlert {
  id: number;
  keyword: string;
  category: string;
  priority: string;
  enabled: number;
}

export class PagerDatabase {
  private db: Database.Database;

  constructor() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        frequency REAL,
        protocol TEXT NOT NULL,
        baud_rate INTEGER DEFAULT 1200,
        capcode INTEGER NOT NULL,
        function INTEGER DEFAULT 0,
        content_raw TEXT DEFAULT '',
        content_clean TEXT DEFAULT '',
        type TEXT DEFAULT 'alpha',
        duplicate_group_id TEXT,
        is_empty INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_capcode ON messages(capcode);
      CREATE INDEX IF NOT EXISTS idx_messages_freq ON messages(frequency);
      CREATE INDEX IF NOT EXISTS idx_messages_dup ON messages(duplicate_group_id);

      CREATE TABLE IF NOT EXISTS capcodes (
        capcode INTEGER PRIMARY KEY,
        label TEXT DEFAULT '',
        category TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        message_count INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS hourly_stats (
        hour_bucket TEXT NOT NULL,
        frequency REAL,
        protocol TEXT NOT NULL,
        message_count INTEGER DEFAULT 1,
        PRIMARY KEY (hour_bucket, frequency, protocol)
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT '',
        priority TEXT DEFAULT 'medium',
        enabled INTEGER DEFAULT 1
      );
    `);

    // Seed alerts if empty
    const count = this.db.prepare('SELECT COUNT(*) as c FROM alerts').get() as any;
    if (count.c === 0) {
      const ins = this.db.prepare('INSERT OR IGNORE INTO alerts (keyword, category, priority) VALUES (?, ?, ?)');
      for (const a of SEED_ALERTS) ins.run(a.keyword, a.category, a.priority);
    }
  }

  // --- Messages ---
  private stmtInsertMsg = () => this.db.prepare(`
    INSERT INTO messages (id, timestamp, frequency, protocol, baud_rate, capcode, function, content_raw, content_clean, type, duplicate_group_id, is_empty)
    VALUES (@id, @timestamp, @frequency, @protocol, @baud_rate, @capcode, @function, @content_raw, @content_clean, @type, @duplicate_group_id, @is_empty)
  `);

  insertMessage(msg: DbMessage) {
    this.stmtInsertMsg().run(msg);
  }

  getMessages(opts: { limit?: number; offset?: number; freq?: number; capcode?: number; search?: string; since?: number }) {
    let where = 'WHERE 1=1';
    const params: any = {};
    if (opts.freq) { where += ' AND frequency = @freq'; params.freq = opts.freq; }
    if (opts.capcode) { where += ' AND capcode = @capcode'; params.capcode = opts.capcode; }
    if (opts.search) { where += ' AND content_clean LIKE @search'; params.search = `%${opts.search}%`; }
    if (opts.since) { where += ' AND timestamp >= @since'; params.since = opts.since; }
    params.limit = opts.limit || 100;
    params.offset = opts.offset || 0;
    return this.db.prepare(`SELECT * FROM messages ${where} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`).all(params);
  }

  // --- Deduplication ---
  findDuplicate(contentClean: string, windowMs: number = 2000): string | null {
    const since = Date.now() - windowMs;
    const row = this.db.prepare(
      `SELECT COALESCE(duplicate_group_id, id) as group_id FROM messages WHERE content_clean = ? AND timestamp >= ? AND is_empty = 0 ORDER BY timestamp ASC LIMIT 1`
    ).get(contentClean, since) as any;
    return row ? row.group_id : null;
  }

  // --- Capcodes ---
  upsertCapcode(capcode: number, category?: string) {
    const now = Date.now();
    const existing = this.db.prepare('SELECT * FROM capcodes WHERE capcode = ?').get(capcode) as any;
    if (existing) {
      this.db.prepare('UPDATE capcodes SET last_seen = ?, message_count = message_count + 1 WHERE capcode = ?').run(now, capcode);
    } else {
      const cat = category || classifyCapcode(capcode);
      this.db.prepare('INSERT INTO capcodes (capcode, label, category, first_seen, last_seen, message_count) VALUES (?, ?, ?, ?, ?, 1)')
        .run(capcode, '', cat, now, now);
    }
  }

  getCapcodes(): DbCapcode[] {
    return this.db.prepare('SELECT * FROM capcodes ORDER BY message_count DESC').all() as DbCapcode[];
  }

  updateCapcode(capcode: number, updates: { label?: string; category?: string; notes?: string }) {
    const sets: string[] = [];
    const params: any = { capcode };
    if (updates.label !== undefined) { sets.push('label = @label'); params.label = updates.label; }
    if (updates.category !== undefined) { sets.push('category = @category'); params.category = updates.category; }
    if (updates.notes !== undefined) { sets.push('notes = @notes'); params.notes = updates.notes; }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE capcodes SET ${sets.join(', ')} WHERE capcode = @capcode`).run(params);
  }

  getCapcodeLabel(capcode: number): { label: string; category: string } | null {
    const row = this.db.prepare('SELECT label, category FROM capcodes WHERE capcode = ?').get(capcode) as any;
    return row || null;
  }

  // --- Hourly Stats ---
  incrementHourlyStat(frequency: number | null, protocol: string) {
    const bucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    this.db.prepare(`
      INSERT INTO hourly_stats (hour_bucket, frequency, protocol, message_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(hour_bucket, frequency, protocol) DO UPDATE SET message_count = message_count + 1
    `).run(bucket, frequency || 0, protocol);
  }

  getStats() {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM messages').get() as any).c;
    const byFreq = this.db.prepare('SELECT frequency, COUNT(*) as count FROM messages WHERE frequency IS NOT NULL GROUP BY frequency ORDER BY count DESC').all();
    const byCapcode = this.db.prepare('SELECT capcode, COUNT(*) as count FROM messages GROUP BY capcode ORDER BY count DESC LIMIT 20').all();
    const byHour = this.db.prepare('SELECT hour_bucket, SUM(message_count) as count FROM hourly_stats GROUP BY hour_bucket ORDER BY hour_bucket DESC LIMIT 24').all();
    const busiest = this.db.prepare('SELECT hour_bucket, SUM(message_count) as count FROM hourly_stats GROUP BY hour_bucket ORDER BY count DESC LIMIT 1').get() as any;
    return { total, by_frequency: byFreq, by_capcode: byCapcode, by_hour: byHour, busiest_hour: busiest?.hour_bucket || null };
  }

  getHourlyStats() {
    const since = new Date(Date.now() - 24 * 3600000).toISOString().slice(0, 13);
    return this.db.prepare('SELECT hour_bucket, frequency, protocol, message_count FROM hourly_stats WHERE hour_bucket >= ? ORDER BY hour_bucket').all(since);
  }

  // --- Alerts ---
  getAlerts(): DbAlert[] {
    return this.db.prepare('SELECT * FROM alerts ORDER BY id').all() as DbAlert[];
  }

  addAlert(keyword: string, category: string, priority: string): DbAlert {
    const info = this.db.prepare('INSERT INTO alerts (keyword, category, priority) VALUES (?, ?, ?)').run(keyword, category, priority);
    return { id: info.lastInsertRowid as number, keyword, category, priority, enabled: 1 };
  }

  deleteAlert(id: number) {
    this.db.prepare('DELETE FROM alerts WHERE id = ?').run(id);
  }

  checkAlerts(contentClean: string): DbAlert[] {
    const alerts = this.getAlerts().filter(a => a.enabled);
    const upper = contentClean.toUpperCase();
    return alerts.filter(a => upper.includes(a.keyword.toUpperCase()));
  }

  close() { this.db.close(); }
}
