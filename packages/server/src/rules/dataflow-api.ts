// ============================================================================
// Data Flow Graph persistence API routes
// ============================================================================

import { Router } from 'express';
import { db } from '../services/database.js';

function uid(): string {
  return `df-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDataFlowRouter(): Router {
  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      nodes TEXT NOT NULL DEFAULT '[]',
      connections TEXT NOT NULL DEFAULT '[]',
      cooldown_ms INTEGER DEFAULT 60000,
      last_triggered INTEGER,
      trigger_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const router = Router();

  // List all
  router.get('/dataflows', (_req, res) => {
    const rows = db.prepare('SELECT id, name, enabled, trigger_count, updated_at FROM data_flows ORDER BY updated_at DESC').all() as any[];
    res.json(rows.map(r => ({ id: r.id, name: r.name, enabled: !!r.enabled, triggerCount: r.trigger_count, updatedAt: r.updated_at })));
  });

  // Get one
  router.get('/dataflows/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM data_flows WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: !!row.enabled,
      nodes: JSON.parse(row.nodes),
      connections: JSON.parse(row.connections),
      cooldownMs: row.cooldown_ms,
      lastTriggered: row.last_triggered,
      triggerCount: row.trigger_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  // Create
  router.post('/dataflows', (req, res) => {
    const id = uid();
    const now = Date.now();
    const { name, description, nodes, connections, cooldownMs, enabled } = req.body;
    db.prepare(`INSERT INTO data_flows (id, name, description, enabled, nodes, connections, cooldown_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name || 'Untitled', description || null, enabled !== false ? 1 : 0,
        JSON.stringify(nodes || []), JSON.stringify(connections || []), cooldownMs || 60000, now, now);
    res.status(201).json({ id, name: name || 'Untitled' });
  });

  // Update
  router.put('/dataflows/:id', (req, res) => {
    const now = Date.now();
    const { name, description, nodes, connections, cooldownMs, enabled } = req.body;
    const result = db.prepare(`UPDATE data_flows SET name=?, description=?, enabled=?, nodes=?, connections=?, cooldown_ms=?, updated_at=? WHERE id=?`)
      .run(name, description || null, enabled !== false ? 1 : 0,
        JSON.stringify(nodes || []), JSON.stringify(connections || []), cooldownMs || 60000, now, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  // Delete
  router.delete('/dataflows/:id', (req, res) => {
    const result = db.prepare('DELETE FROM data_flows WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
}
