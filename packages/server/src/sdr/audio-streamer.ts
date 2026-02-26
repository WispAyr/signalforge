/**
 * Audio Streamer — Stream demodulated audio from virtual receivers as MP3 over HTTP
 * 
 * Uses ffmpeg to encode raw PCM (s16le) to MP3 and broadcasts to multiple HTTP clients.
 * Each receiver gets its own ffmpeg encoder instance (lazy-started on first listener).
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { Response } from 'express';

interface StreamInfo {
  receiverId: string;
  ffmpeg: ChildProcess | null;
  clients: Set<Response>;
  label: string;
  freq: number;
  mode: string;
  active: boolean;
}

class AudioStreamer extends EventEmitter {
  private streams = new Map<string, StreamInfo>();
  private ffmpegPath = 'ffmpeg'; // assume in PATH

  constructor() {
    super();
    // Try to find ffmpeg
    try {
      const { execSync } = require('child_process');
      const path = execSync('which ffmpeg 2>/dev/null').toString().trim();
      if (path) this.ffmpegPath = path;
    } catch {}
  }

  /** Check if ffmpeg is available */
  isAvailable(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(`${this.ffmpegPath} -version`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /** Start streaming a receiver. Call feedAudio() to push PCM data. */
  startStream(receiverId: string, label: string, freq: number, mode: string): StreamInfo {
    if (this.streams.has(receiverId)) {
      return this.streams.get(receiverId)!;
    }

    const info: StreamInfo = {
      receiverId,
      ffmpeg: null,
      clients: new Set(),
      label,
      freq,
      mode,
      active: true,
    };

    this.streams.set(receiverId, info);
    return info;
  }

  /** Start ffmpeg encoder for a stream (lazy — only when first client connects) */
  private startEncoder(info: StreamInfo): void {
    if (info.ffmpeg) return;

    info.ffmpeg = spawn(this.ffmpegPath, [
      '-f', 's16le',
      '-ar', '22050',
      '-ac', '1',
      '-i', 'pipe:0',
      '-codec:a', 'libmp3lame',
      '-b:a', '32k',
      '-ar', '22050',
      '-f', 'mp3',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    info.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      for (const client of info.clients) {
        try {
          client.write(chunk);
        } catch {
          info.clients.delete(client);
        }
      }
    });

    info.ffmpeg.stderr?.on('data', () => {}); // suppress ffmpeg noise

    info.ffmpeg.on('exit', () => {
      info.ffmpeg = null;
      // Restart if there are still listeners
      if (info.clients.size > 0 && info.active) {
        setTimeout(() => this.startEncoder(info), 1000);
      }
    });
  }

  /** Feed raw PCM audio data (s16le, 22050Hz, mono) into a stream */
  feedAudio(receiverId: string, pcmData: Buffer): void {
    const info = this.streams.get(receiverId);
    if (!info || info.clients.size === 0) return;

    // Lazy-start encoder
    if (!info.ffmpeg) {
      this.startEncoder(info);
    }

    try {
      info.ffmpeg?.stdin?.write(pcmData);
    } catch {}
  }

  /** Add an HTTP client to a stream */
  addClient(receiverId: string, res: Response): boolean {
    const info = this.streams.get(receiverId);
    if (!info) return false;

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'ICY-Name': `SignalForge - ${info.label}`,
      'Transfer-Encoding': 'chunked',
    });

    info.clients.add(res);

    // Start encoder if not running
    if (!info.ffmpeg) {
      this.startEncoder(info);
    }

    res.on('close', () => {
      info.clients.delete(res);
      // Stop encoder if no listeners
      if (info.clients.size === 0 && info.ffmpeg) {
        info.ffmpeg.kill('SIGTERM');
        info.ffmpeg = null;
      }
    });

    return true;
  }

  /** Stop a stream */
  stopStream(receiverId: string): void {
    const info = this.streams.get(receiverId);
    if (!info) return;

    info.active = false;
    if (info.ffmpeg) {
      info.ffmpeg.kill('SIGTERM');
      info.ffmpeg = null;
    }
    // Close all client connections
    for (const client of info.clients) {
      try { client.end(); } catch {}
    }
    info.clients.clear();
    this.streams.delete(receiverId);
  }

  /** Stop all streams */
  stopAll(): void {
    for (const [id] of this.streams) {
      this.stopStream(id);
    }
  }

  /** Get stream info */
  getStreamInfo(receiverId: string): { label: string; freq: number; mode: string; listeners: number; active: boolean } | null {
    const info = this.streams.get(receiverId);
    if (!info) return null;
    return {
      label: info.label,
      freq: info.freq,
      mode: info.mode,
      listeners: info.clients.size,
      active: info.active,
    };
  }

  /** Get all active streams */
  getAllStreams(): Array<{ receiverId: string; label: string; freq: number; mode: string; listeners: number }> {
    return Array.from(this.streams.entries()).map(([id, info]) => ({
      receiverId: id,
      label: info.label,
      freq: info.freq,
      mode: info.mode,
      listeners: info.clients.size,
    }));
  }

  /** Generate HTML player page */
  getPlayerHTML(receiverId: string, baseUrl: string): string {
    const info = this.streams.get(receiverId);
    const label = info?.label || receiverId;
    const freq = info ? (info.freq / 1e6).toFixed(4) : '?';
    const mode = info?.mode || '?';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SignalForge - ${label}</title>
<style>
body{background:#0f0f1a;color:#e0e0e0;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px;margin:0}
h1{color:#4a9eff;font-size:1.5em;margin-bottom:4px}
.freq{color:#888;font-size:0.9em;margin-bottom:20px}
.live{color:#ff4444;font-size:0.85em;animation:pulse 1.5s infinite}
@keyframes pulse{50%{opacity:.4}}
audio{margin:20px;width:min(400px,90vw)}
.info{background:#1a1a2e;padding:16px 24px;border-radius:8px;margin-top:16px;font-size:0.9em}
.info span{color:#4a9eff}
a{color:#4a9eff}
</style></head><body>
<h1>${label}</h1>
<p class="freq">${freq} MHz — ${mode}</p>
<p class="live">● LIVE</p>
<audio controls autoplay><source src="${baseUrl}/api/sdr/receiver/${receiverId}/audio" type="audio/mpeg"></audio>
<div class="info">
<p>Stream: <span>${baseUrl}/api/sdr/receiver/${receiverId}/audio</span></p>
<p>Mode: <span>${mode}</span> | Bandwidth: <span>${info?.freq ? '12.5 kHz' : '?'}</span></p>
</div>
<p style="margin-top:20px;font-size:0.8em;color:#555">Powered by <a href="/">SignalForge</a></p>
</body></html>`;
  }
}

// Singleton
export const audioStreamer = new AudioStreamer();
