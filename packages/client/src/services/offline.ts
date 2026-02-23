// ============================================================================
// SignalForge Offline Store — IndexedDB-backed data caching + sync queue
// ============================================================================

const DB_NAME = 'signalforge-offline';
const DB_VERSION = 1;

interface QueuedAction {
  id: string;
  endpoint: string;
  method: string;
  body: any;
  timestamp: number;
}

class OfflineStore {
  private db: IDBDatabase | null = null;
  private _isOnline = navigator.onLine;
  private listeners: Array<(online: boolean) => void> = [];

  constructor() {
    window.addEventListener('online', () => { this._isOnline = true; this.notify(); this.syncQueue(); });
    window.addEventListener('offline', () => { this._isOnline = false; this.notify(); });
  }

  get isOnline() { return this._isOnline; }

  onStatusChange(fn: (online: boolean) => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify() { this.listeners.forEach(fn => fn(this._isOnline)); }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async set(key: string, value: any): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('cache', 'readwrite');
      tx.objectStore('cache').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(key: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('cache', 'readwrite');
      tx.objectStore('cache').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Queue an action for later sync
  async enqueue(endpoint: string, method: string, body: any): Promise<void> {
    if (!this.db) await this.init();
    const action: QueuedAction = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      endpoint, method, body,
      timestamp: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(action);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getQueuedActions(): Promise<QueuedAction[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clearQueueItem(id: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('queue', 'readwrite');
      tx.objectStore('queue').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Sync queued actions when back online
  async syncQueue(): Promise<{ synced: number; failed: number }> {
    const actions = await this.getQueuedActions();
    let synced = 0, failed = 0;
    for (const action of actions) {
      try {
        await fetch(action.endpoint, {
          method: action.method,
          headers: { 'Content-Type': 'application/json' },
          body: action.body ? JSON.stringify(action.body) : undefined,
        });
        await this.clearQueueItem(action.id);
        synced++;
      } catch {
        failed++;
      }
    }
    return { synced, failed };
  }

  // Cache all critical data for offline use
  async cacheAllData(): Promise<void> {
    const endpoints: Record<string, string> = {
      'signals': '/api/signals',
      'satellites-tle': '/api/satellite/tracked',
      'equipment': '/api/equipment/database',
      'academy-modules': '/api/academy/modules',
      'academy-lessons': '/api/academy/lessons',
      'logbook': '/api/logbook/entries',
    };

    const results: Record<string, any> = {};
    await Promise.allSettled(
      Object.entries(endpoints).map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            await this.set(key, data);
            results[key] = 'cached';
          }
        } catch {
          results[key] = 'failed';
        }
      })
    );

    await this.set('cache-timestamp', Date.now());
    console.log('[OfflineStore] Cache results:', results);
  }

  // Fetch with offline fallback
  async fetchWithFallback<T>(url: string, cacheKey: string): Promise<T | undefined> {
    if (this._isOnline) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          await this.set(cacheKey, data);
          return data;
        }
      } catch { /* fall through to cache */ }
    }
    return this.get<T>(cacheKey);
  }
}

// Singleton
export const offlineStore = new OfflineStore();

// Initialize on load
offlineStore.init().then(() => {
  // Cache data on first load if online
  if (navigator.onLine) {
    offlineStore.cacheAllData().catch(() => {});
  }
}).catch(console.error);
