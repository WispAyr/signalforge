import * as fs from 'fs';
import * as path from 'path';
import { db, RECORDINGS_DIR } from '../services/database.js';
import type { Bookmark, Recording, NotificationConfig, Notification } from '@signalforge/shared';
import { SIGNAL_DATABASE } from '@signalforge/shared';

export class SignalDatabaseService {
  private notificationConfigs: NotificationConfig[] = [];
  private notifications: Notification[] = [];

  constructor() {
    this.loadNotificationConfigs();
  }

  // ── Signal Database ──────────────────────────────────────────────────

  getSignals(query?: string, category?: string) {
    let results = [...SIGNAL_DATABASE];
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.mode.toLowerCase().includes(q)
      );
    }
    if (category) {
      results = results.filter(s => s.category === category);
    }
    return results;
  }

  identifyFrequency(freq: number, toleranceHz = 500e3) {
    return SIGNAL_DATABASE.filter(s => {
      const bw = s.bandwidth || toleranceHz;
      return Math.abs(s.frequency - freq) <= bw / 2 + toleranceHz;
    });
  }

  // ── Bookmarks (SQLite) ──────────────────────────────────────────────

  getBookmarks(): Bookmark[] {
    return (db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all() as any[]).map(r => ({
      id: r.id,
      name: r.name,
      frequency: r.frequency,
      mode: r.mode || undefined,
      category: r.category || undefined,
      notes: r.notes || undefined,
      created: r.created_at,
    }));
  }

  addBookmark(bm: Omit<Bookmark, 'id' | 'created'>): Bookmark {
    const id = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const created = new Date().toISOString();
    db.prepare('INSERT INTO bookmarks (id, frequency, name, mode, category, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, bm.frequency, bm.name, bm.mode || null, bm.category || null, bm.notes || null, created);
    return { id, ...bm, created };
  }

  removeBookmark(id: string) {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  // ── Recordings ───────────────────────────────────────────────────────

  getRecordings(): any[] {
    return db.prepare('SELECT * FROM recordings ORDER BY created_at DESC').all();
  }

  getRecordingsDir() { return RECORDINGS_DIR; }

  // ── Notifications ────────────────────────────────────────────────────

  private loadNotificationConfigs() {
    const DATA_DIR = path.join(process.cwd(), 'data');
    const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
    try {
      if (fs.existsSync(NOTIFICATIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf-8'));
        this.notificationConfigs = data.configs || [];
      }
    } catch { /* ignore */ }
  }

  private saveNotificationConfigs() {
    const DATA_DIR = path.join(process.cwd(), 'data');
    const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify({ configs: this.notificationConfigs }, null, 2));
  }

  getNotificationConfigs() { return [...this.notificationConfigs]; }

  setNotificationConfig(config: NotificationConfig) {
    const idx = this.notificationConfigs.findIndex(c => c.id === config.id);
    if (idx >= 0) this.notificationConfigs[idx] = config;
    else this.notificationConfigs.push(config);
    this.saveNotificationConfigs();
  }

  removeNotificationConfig(id: string) {
    this.notificationConfigs = this.notificationConfigs.filter(c => c.id !== id);
    this.saveNotificationConfigs();
  }

  getNotifications(limit = 50) { return this.notifications.slice(0, limit); }

  addNotification(n: Omit<Notification, 'id' | 'timestamp' | 'read'>): Notification {
    const entry: Notification = {
      ...n,
      id: `notif-${Date.now()}`,
      timestamp: Date.now(),
      read: false,
    };
    this.notifications.unshift(entry);
    if (this.notifications.length > 200) this.notifications.pop();
    return entry;
  }

  markNotificationRead(id: string) {
    const n = this.notifications.find(x => x.id === id);
    if (n) n.read = true;
  }
}
