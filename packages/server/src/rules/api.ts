// ============================================================================
// Rules API Routes
// ============================================================================

import { Router } from 'express';
import type { RulesEngine } from './engine.js';

export function createRulesRouter(engine: RulesEngine): Router {
  const router = Router();

  // List all rules
  router.get('/rules', (_req, res) => {
    res.json(engine.getRules());
  });

  // Get stats
  router.get('/rules/stats', (_req, res) => {
    res.json(engine.getStats());
  });

  // Get events (with pagination)
  router.get('/rules/events', (req, res) => {
    const limit = parseInt(String(req.query.limit)) || 50;
    const offset = parseInt(String(req.query.offset)) || 0;
    res.json(engine.getEvents({ limit, offset }));
  });

  // Get events for specific rule
  router.get('/rules/events/:ruleId', (req, res) => {
    const limit = parseInt(String(req.query.limit)) || 50;
    const offset = parseInt(String(req.query.offset)) || 0;
    res.json(engine.getEvents({ ruleId: req.params.ruleId, limit, offset }));
  });

  // Get single rule
  router.get('/rules/:id', (req, res) => {
    const rule = engine.getRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  // Create rule
  router.post('/rules', (req, res) => {
    try {
      const rule = engine.createRule(req.body);
      res.status(201).json(rule);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // Update rule
  router.put('/rules/:id', (req, res) => {
    const rule = engine.updateRule(req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  // Delete rule
  router.delete('/rules/:id', (req, res) => {
    const ok = engine.deleteRule(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Rule not found' });
    res.json({ ok: true });
  });

  // Enable/disable
  router.post('/rules/:id/enable', (req, res) => {
    const rule = engine.enableRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  router.post('/rules/:id/disable', (req, res) => {
    const rule = engine.disableRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  // Test rule with sample data
  router.post('/rules/:id/test', async (req, res) => {
    const result = await engine.testRule(req.params.id, req.body.data);
    res.json(result);
  });

  return router;
}
