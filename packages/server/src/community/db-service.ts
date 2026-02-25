// ============================================================================
// SignalForge Community Hub — SQLite-backed service
// ============================================================================
import { EventEmitter } from 'events';
import { db } from '../services/database.js';

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS community_flowgraphs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    tags TEXT NOT NULL DEFAULT '[]',
    author TEXT NOT NULL DEFAULT 'Anonymous',
    flow_data TEXT NOT NULL DEFAULT '{}',
    rating REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_community_fg_category ON community_flowgraphs(category);

  CREATE TABLE IF NOT EXISTS community_observations (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL DEFAULT '',
    frequency REAL,
    mode TEXT,
    location TEXT,
    screenshot TEXT,
    author TEXT NOT NULL DEFAULT 'Anonymous',
    likes INTEGER DEFAULT 0,
    bookmarks INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_community_obs_time ON community_observations(created_at);

  CREATE TABLE IF NOT EXISTS community_obs_likes (
    observation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'like',
    PRIMARY KEY (observation_id, user_id, type)
  );
`);

// Prepared statements
const stmts = {
  insertFlowgraph: db.prepare(`
    INSERT INTO community_flowgraphs (id, name, description, category, tags, author, flow_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getFlowgraphs: db.prepare(`SELECT * FROM community_flowgraphs ORDER BY downloads DESC, created_at DESC`),
  getFlowgraphsByCategory: db.prepare(`SELECT * FROM community_flowgraphs WHERE category = ? ORDER BY downloads DESC`),
  getFlowgraph: db.prepare(`SELECT * FROM community_flowgraphs WHERE id = ?`),
  searchFlowgraphs: db.prepare(`SELECT * FROM community_flowgraphs WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY downloads DESC`),
  incrementDownloads: db.prepare(`UPDATE community_flowgraphs SET downloads = downloads + 1 WHERE id = ?`),
  rateFlowgraph: db.prepare(`UPDATE community_flowgraphs SET rating = ?, rating_count = rating_count + 1, updated_at = ? WHERE id = ?`),

  insertObservation: db.prepare(`
    INSERT INTO community_observations (id, text, frequency, mode, location, screenshot, author, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getObservations: db.prepare(`SELECT * FROM community_observations ORDER BY created_at DESC LIMIT ?`),
  getObservation: db.prepare(`SELECT * FROM community_observations WHERE id = ?`),
  likeObservation: db.prepare(`INSERT OR IGNORE INTO community_obs_likes (observation_id, user_id, type) VALUES (?, ?, 'like')`),
  unlikeObservation: db.prepare(`DELETE FROM community_obs_likes WHERE observation_id = ? AND user_id = ? AND type = 'like'`),
  bookmarkObservation: db.prepare(`INSERT OR IGNORE INTO community_obs_likes (observation_id, user_id, type) VALUES (?, ?, 'bookmark')`),
  unbookmarkObservation: db.prepare(`DELETE FROM community_obs_likes WHERE observation_id = ? AND user_id = ? AND type = 'bookmark'`),
  updateLikeCount: db.prepare(`UPDATE community_observations SET likes = (SELECT COUNT(*) FROM community_obs_likes WHERE observation_id = ? AND type = 'like') WHERE id = ?`),
  updateBookmarkCount: db.prepare(`UPDATE community_observations SET bookmarks = (SELECT COUNT(*) FROM community_obs_likes WHERE observation_id = ? AND type = 'bookmark') WHERE id = ?`),
};

export class CommunityDBService extends EventEmitter {
  // ── Flowgraphs ──

  shareFlowgraph(data: { name: string; description: string; category: string; tags: string[]; flowData: any; author: string }): any {
    const id = `fg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    stmts.insertFlowgraph.run(id, data.name, data.description, data.category, JSON.stringify(data.tags), data.author, JSON.stringify(data.flowData), now, now);
    return { id, ...data, rating: 0, ratingCount: 0, downloads: 0, createdAt: now };
  }

  getFlowgraphs(category?: string, search?: string): any[] {
    let rows: any[];
    if (search) {
      const q = `%${search}%`;
      rows = stmts.searchFlowgraphs.all(q, q, q);
    } else if (category) {
      rows = stmts.getFlowgraphsByCategory.all(category);
    } else {
      rows = stmts.getFlowgraphs.all();
    }
    return rows.map(this.mapFlowgraph);
  }

  getFlowgraph(id: string): any | null {
    const row = stmts.getFlowgraph.get(id);
    return row ? this.mapFlowgraph(row) : null;
  }

  importFlowgraph(id: string): any | null {
    const row = stmts.getFlowgraph.get(id) as any;
    if (!row) return null;
    stmts.incrementDownloads.run(id);
    return { flowData: JSON.parse(row.flow_data || '{}'), name: row.name };
  }

  rateFlowgraph(id: string, rating: number): boolean {
    const row = stmts.getFlowgraph.get(id) as any;
    if (!row || rating < 1 || rating > 5) return false;
    const newRating = (row.rating * row.rating_count + rating) / (row.rating_count + 1);
    stmts.rateFlowgraph.run(newRating, Date.now(), id);
    return true;
  }

  private mapFlowgraph(row: any) {
    return {
      id: row.id, name: row.name, description: row.description,
      category: row.category, tags: JSON.parse(row.tags || '[]'),
      author: row.author, flowData: JSON.parse(row.flow_data || '{}'),
      rating: row.rating, ratingCount: row.rating_count,
      downloads: row.downloads, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  // ── Observations ──

  postObservation(data: { text: string; frequency?: number; mode?: string; location?: string; screenshot?: string; author: string }): any {
    const id = `obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    stmts.insertObservation.run(id, data.text, data.frequency || null, data.mode || null, data.location || null, data.screenshot || null, data.author, now);
    return { id, ...data, likes: 0, bookmarks: 0, createdAt: now };
  }

  getObservations(limit = 50): any[] {
    return (stmts.getObservations.all(limit) as any[]).map(row => ({
      id: row.id, text: row.text, frequency: row.frequency, mode: row.mode,
      location: row.location, screenshot: row.screenshot, author: row.author,
      likes: row.likes, bookmarks: row.bookmarks, createdAt: row.created_at,
    }));
  }

  likeObservation(id: string, userId: string): boolean {
    stmts.likeObservation.run(id, userId);
    stmts.updateLikeCount.run(id, id);
    return true;
  }

  bookmarkObservation(id: string, userId: string): boolean {
    stmts.bookmarkObservation.run(id, userId);
    stmts.updateBookmarkCount.run(id, id);
    return true;
  }
}
