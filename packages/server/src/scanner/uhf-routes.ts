/**
 * UHF Scanner REST API Routes — Full Featured
 */
import { Router } from 'express';
import { readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import type { UHFScannerService } from './uhf-scanner.js';

export function createUHFScannerRouter(scanner: UHFScannerService): Router {
  const router = Router();
  
  router.post('/scanner/uhf/start', async (req, res) => {
    const result = await scanner.start(req.body);
    if (result.success) res.json({ ok: true, status: scanner.getStatus() });
    else res.status(400).json({ error: result.error });
  });
  
  router.post('/scanner/uhf/stop', (_req, res) => {
    scanner.stop();
    res.json({ ok: true, status: scanner.getStatus() });
  });
  
  router.get('/scanner/uhf/status', (_req, res) => {
    res.json(scanner.getStatus());
  });
  
  router.get('/scanner/uhf/channels', (_req, res) => {
    res.json(scanner.getChannels());
  });
  
  router.post('/scanner/uhf/channels', (req, res) => {
    const ch = scanner.addChannel(req.body);
    res.json(ch);
  });
  
  router.patch('/scanner/uhf/channels/:id', (req, res) => {
    const ch = scanner.updateChannel(parseInt(req.params.id), req.body);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    res.json(ch);
  });
  
  router.delete('/scanner/uhf/channels/:id', (req, res) => {
    scanner.deleteChannel(parseInt(req.params.id));
    res.json({ ok: true });
  });
  
  router.get('/scanner/uhf/hits', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(scanner.getHits(limit));
  });
  
  router.post('/scanner/uhf/lock', (req, res) => {
    const { frequency } = req.body;
    if (!frequency) return res.status(400).json({ error: 'frequency required' });
    scanner.lock(frequency);
    res.json({ ok: true, status: scanner.getStatus() });
  });
  
  router.post('/scanner/uhf/unlock', (_req, res) => {
    scanner.unlock();
    res.json({ ok: true, status: scanner.getStatus() });
  });

  // --- Recordings ---
  router.get('/scanner/uhf/recordings', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const recs = scanner.getRecordings(limit);
    // Enrich with file info
    const enriched = recs.map((r: any) => {
      let filename = '';
      let url = '';
      let size = 0;
      if (r.audio_clip_path) {
        filename = basename(r.audio_clip_path);
        url = `/recordings/${filename}`;
        try { size = statSync(r.audio_clip_path).size; } catch {}
      }
      return { ...r, filename, url, size };
    });
    res.json(enriched);
  });

  router.delete('/scanner/uhf/recordings/:filename', (req, res) => {
    const filename = req.params.filename;
    const dir = scanner.getRecordingsDir();
    const filepath = join(dir, filename);
    try {
      unlinkSync(filepath);
      // Also remove from DB
      scanner.deleteRecordingByPath(filepath);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(404).json({ error: 'Recording not found' });
    }
  });

  // --- Lockout endpoints ---
  router.get('/scanner/uhf/lockouts', (_req, res) => {
    res.json(scanner.getLockouts());
  });

  router.post('/scanner/uhf/lockouts', (req, res) => {
    const { frequency, label } = req.body;
    if (!frequency) return res.status(400).json({ error: 'frequency required' });
    res.json(scanner.addLockout(frequency, label || ''));
  });

  router.delete('/scanner/uhf/lockouts/:id', (req, res) => {
    scanner.removeLockout(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/scanner/uhf/lockout-current', (_req, res) => {
    const result = scanner.lockoutCurrent();
    if (result) res.json({ ok: true, lockout: result });
    else res.status(400).json({ error: 'Not parked on any frequency' });
  });

  router.delete('/scanner/uhf/lockouts', (_req, res) => {
    scanner.clearAllLockouts();
    res.json({ ok: true });
  });

  // --- Config update ---
  router.patch('/scanner/uhf/config', (req, res) => {
    scanner.updateConfig(req.body);
    res.json({ ok: true, config: scanner.getStatus().config });
  });

  // --- Stats ---
  router.get('/scanner/uhf/stats', (_req, res) => {
    res.json(scanner.getStats());
  });

  return router;
}
