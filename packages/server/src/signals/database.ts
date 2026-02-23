import * as fs from 'fs';
import * as path from 'path';
import type { Bookmark, Recording, NotificationConfig, Notification } from '@signalforge/shared';
import { SIGNAL_DATABASE } from '@signalforge/shared';

const DATA_DIR = path.join(process.cwd(), 'data');
const BOOKMARKS_FILE = path.join(DATA_DIR, 'bookmarks.json');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class SignalDatabaseService {
  private bookmarks: Bookmark[] = [];
  private recordings: Recording[] = [];
  private notificationConfigs: NotificationConfig[] = [];
  private notifications: Notification[] = [];

  constructor() {
    ensureDir(DATA_DIR);
    ensureDir(RECORDINGS_DIR);
    this.loadBookmarks();
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

  // ── Bookmarks ────────────────────────────────────────────────────────

  private loadBookmarks() {
    try {
      if (fs.existsSync(BOOKMARKS_FILE)) {
        this.bookmarks = JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  private saveBookmarks() {
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(this.bookmarks, null, 2));
  }

  getBookmarks() { return [...this.bookmarks]; }

  addBookmark(bm: Omit<Bookmark, 'id' | 'created'>): Bookmark {
    const entry: Bookmark = {
      ...bm,
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      created: new Date().toISOString(),
    };
    this.bookmarks.push(entry);
    this.saveBookmarks();
    return entry;
  }

  removeBookmark(id: string) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    this.saveBookmarks();
  }

  // ── Recordings ───────────────────────────────────────────────────────

  getRecordings() { return [...this.recordings]; }

  addRecording(rec: Omit<Recording, 'id' | 'created'>): Recording {
    const entry: Recording = {
      ...rec,
      id: `rec-${Date.now()}`,
      created: new Date().toISOString(),
    };
    this.recordings.push(entry);
    return entry;
  }

  getRecordingsDir() { return RECORDINGS_DIR; }

  // ── Notifications ────────────────────────────────────────────────────

  private loadNotificationConfigs() {
    try {
      if (fs.existsSync(NOTIFICATIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf-8'));
        this.notificationConfigs = data.configs || [];
      }
    } catch { /* ignore */ }
  }

  private saveNotificationConfigs() {
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
