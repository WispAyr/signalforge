import { db } from './database.js';

export class SettingsService {
  getAll(): Record<string, any> {
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
    const result: Record<string, any> = {};
    for (const r of rows) {
      try { result[r.key] = JSON.parse(r.value); } catch { result[r.key] = r.value; }
    }
    return result;
  }

  get(key: string, defaultValue?: any): any {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  set(key: string, value: any): void {
    const json = JSON.stringify(value);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, json);
  }

  setAll(settings: Record<string, any>): void {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction((entries: [string, any][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, JSON.stringify(value));
      }
    });
    transaction(Object.entries(settings));
  }

  delete(key: string): void {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
