import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { db, RECORDINGS_DIR } from '../services/database.js';
import type { WaterfallRecording, WaterfallAnnotation, SpectrogramGalleryItem } from '@signalforge/shared';

export class WaterfallRecorder extends EventEmitter {
  private activeRecordings = new Map<string, { rec: WaterfallRecording; stream: fs.WriteStream; interval: ReturnType<typeof setInterval> }>();

  startRecording(opts: { name: string; frequency: number; bandwidth?: number; mode: string; sampleRate?: number; format?: 'png' | 'webm' | 'iq'; timelapse?: boolean; timelapseInterval?: number }): WaterfallRecording {
    const id = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const filePath = path.join(RECORDINGS_DIR, `${id}.iq`);
    const sampleRate = opts.sampleRate || 2048000;

    const rec: WaterfallRecording = {
      id,
      name: opts.name,
      startTime: now,
      frequency: opts.frequency,
      bandwidth: opts.bandwidth || sampleRate,
      mode: opts.mode,
      format: (opts.format || 'iq') as any,
      annotations: [],
      timelapse: opts.timelapse || false,
      timelapseInterval: opts.timelapseInterval,
      status: 'recording',
    };

    // Insert into DB
    db.prepare(`INSERT INTO recordings (id, name, frequency, mode, sample_rate, file_path, format, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'recording', ?)`)
      .run(id, opts.name, opts.frequency, opts.mode, sampleRate, filePath, opts.format || 'iq', now);

    // Start writing demo IQ data (sine waves)
    const stream = fs.createWriteStream(filePath);
    let sampleOffset = 0;
    const interval = setInterval(() => {
      const buf = Buffer.alloc(8192);
      for (let i = 0; i < buf.length / 4; i++) {
        const t = (sampleOffset + i) / sampleRate;
        const sig = Math.sin(2 * Math.PI * 1000 * t) + 0.5 * Math.sin(2 * Math.PI * 3000 * t);
        const I = sig * 0.5 + (Math.random() - 0.5) * 0.1;
        const Q = Math.cos(2 * Math.PI * 1000 * t) * 0.5 + (Math.random() - 0.5) * 0.1;
        buf.writeInt16LE(Math.round(I * 32767), i * 4);
        buf.writeInt16LE(Math.round(Q * 32767), i * 4 + 2);
      }
      sampleOffset += buf.length / 4;
      stream.write(buf);
    }, 100);

    this.activeRecordings.set(id, { rec, stream, interval });
    this.emit('recording_started', rec);
    return rec;
  }

  stopRecording(id: string): WaterfallRecording | null {
    const active = this.activeRecordings.get(id);
    if (!active) return null;

    clearInterval(active.interval);
    active.stream.end();

    const { rec } = active;
    rec.endTime = Date.now();
    rec.status = 'complete';
    const durationMs = rec.endTime - rec.startTime;

    // Get file size
    const filePath = db.prepare('SELECT file_path FROM recordings WHERE id = ?').get(id) as any;
    let sizeBytes = 0;
    try { sizeBytes = fs.statSync(filePath?.file_path).size; } catch { /* ignore */ }

    rec.sizeBytes = sizeBytes;

    // Update DB
    db.prepare('UPDATE recordings SET duration_ms = ?, size_bytes = ?, status = ? WHERE id = ?')
      .run(durationMs, sizeBytes, 'complete', id);

    this.activeRecordings.delete(id);
    this.emit('recording_stopped', rec);
    return rec;
  }

  addAnnotation(recordingId: string, annotation: Omit<WaterfallAnnotation, 'id'>): WaterfallAnnotation | null {
    const active = this.activeRecordings.get(recordingId);
    if (!active) return null;
    const ann: WaterfallAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
      ...annotation,
    };
    active.rec.annotations.push(ann);
    this.emit('annotation_added', { recordingId, annotation: ann });
    return ann;
  }

  removeAnnotation(recordingId: string, annotationId: string): boolean {
    const active = this.activeRecordings.get(recordingId);
    if (!active) return false;
    const idx = active.rec.annotations.findIndex(a => a.id === annotationId);
    if (idx === -1) return false;
    active.rec.annotations.splice(idx, 1);
    return true;
  }

  getRecording(id: string): any {
    return db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  }

  getActiveRecordings(): WaterfallRecording[] {
    return [...this.activeRecordings.values()].map(a => a.rec);
  }

  getGallery(limit = 50): any[] {
    return db.prepare('SELECT * FROM recordings WHERE status = ? ORDER BY created_at DESC LIMIT ?').all('complete', limit);
  }

  getAllRecordings(limit = 50): any[] {
    return db.prepare('SELECT * FROM recordings ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  deleteRecording(id: string): boolean {
    const rec = db.prepare('SELECT file_path FROM recordings WHERE id = ?').get(id) as any;
    if (rec?.file_path) {
      try { fs.unlinkSync(rec.file_path); } catch { /* ignore */ }
    }
    // Stop if active
    const active = this.activeRecordings.get(id);
    if (active) {
      clearInterval(active.interval);
      active.stream.end();
      this.activeRecordings.delete(id);
    }
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    return true;
  }

  getRecordingFilePath(id: string): string | null {
    const rec = db.prepare('SELECT file_path FROM recordings WHERE id = ?').get(id) as any;
    return rec?.file_path || null;
  }
}
