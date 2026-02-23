import { EventEmitter } from 'events';
import * as fs from 'fs';
import { db } from '../services/database.js';

interface PlaybackState {
  recordingId: string;
  status: 'loaded' | 'playing' | 'paused' | 'stopped';
  position: number; // 0-1
  startedAt?: number;
  pausedAt?: number;
  filePath: string;
  fileSize: number;
  sampleRate: number;
  frequency: number;
  mode: string;
  durationMs: number;
}

export class TimeMachineService extends EventEmitter {
  private state: PlaybackState | null = null;
  private playInterval: ReturnType<typeof setInterval> | null = null;
  private fd: number | null = null;

  loadRecording(recordingId: string): PlaybackState | null {
    this.stop();
    const rec = db.prepare('SELECT * FROM recordings WHERE id = ? AND status = ?').get(recordingId, 'complete') as any;
    if (!rec || !rec.file_path) return null;
    let fileSize = 0;
    try { fileSize = fs.statSync(rec.file_path).size; } catch { return null; }

    this.state = {
      recordingId,
      status: 'loaded',
      position: 0,
      filePath: rec.file_path,
      fileSize,
      sampleRate: rec.sample_rate || 2048000,
      frequency: rec.frequency,
      mode: rec.mode || 'FM',
      durationMs: rec.duration_ms || 0,
    };
    this.emit('state', this.state);
    return this.state;
  }

  play(): PlaybackState | null {
    if (!this.state) return null;
    if (this.state.status === 'playing') return this.state;

    this.state.status = 'playing';
    this.state.startedAt = Date.now();

    try {
      this.fd = fs.openSync(this.state.filePath, 'r');
    } catch { return null; }

    // Stream chunks at ~10 chunks/sec
    const chunkSize = 8192;
    const bytesPerSec = this.state.sampleRate * 4; // 16-bit I + 16-bit Q
    let byteOffset = Math.floor(this.state.position * this.state.fileSize);

    this.playInterval = setInterval(() => {
      if (!this.state || this.state.status !== 'playing' || this.fd === null) return;

      const buf = Buffer.alloc(chunkSize);
      let bytesRead: number;
      try {
        bytesRead = fs.readSync(this.fd, buf, 0, chunkSize, byteOffset);
      } catch {
        this.stop();
        return;
      }

      if (bytesRead === 0) {
        this.stop();
        return;
      }

      byteOffset += bytesRead;
      this.state.position = byteOffset / this.state.fileSize;

      // Emit IQ data for DSP pipeline / waterfall
      this.emit('iq_data', {
        samples: buf.slice(0, bytesRead),
        sampleRate: this.state.sampleRate,
        centerFrequency: this.state.frequency,
        timestamp: Date.now(),
        position: this.state.position,
      });

      this.emit('state', this.state);
    }, 100);

    this.emit('state', this.state);
    return this.state;
  }

  pause(): PlaybackState | null {
    if (!this.state) return null;
    this.state.status = 'paused';
    this.state.pausedAt = Date.now();
    if (this.playInterval) { clearInterval(this.playInterval); this.playInterval = null; }
    this.emit('state', this.state);
    return this.state;
  }

  seek(position: number): PlaybackState | null {
    if (!this.state) return null;
    this.state.position = Math.max(0, Math.min(1, position));
    this.emit('state', this.state);
    // If playing, restart from new position
    if (this.state.status === 'playing') {
      if (this.playInterval) clearInterval(this.playInterval);
      if (this.fd !== null) { try { fs.closeSync(this.fd); } catch {} this.fd = null; }
      this.state.status = 'paused';
      return this.play();
    }
    return this.state;
  }

  stop(): PlaybackState | null {
    if (this.playInterval) { clearInterval(this.playInterval); this.playInterval = null; }
    if (this.fd !== null) { try { fs.closeSync(this.fd); } catch {} this.fd = null; }
    if (this.state) {
      this.state.status = 'stopped';
      this.emit('state', this.state);
    }
    const s = this.state;
    this.state = null;
    return s;
  }

  getState(): PlaybackState | null {
    return this.state;
  }
}
