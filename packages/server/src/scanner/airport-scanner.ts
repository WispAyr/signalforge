// ============================================================================
// SignalForge Airport Scanner Service
// Multi-channel NFM scanner with VOX recording and auto-discovery
// ============================================================================
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '../../config/airport-scanner.json');

// ============================================================================
// Types
// ============================================================================
export interface AirportChannel {
  freq: number;
  label: string;
  mode: string;
  squelch: number;
  color: string;
  category?: string;
  enabled: boolean;
  // Runtime state
  signalLevel: number;
  squelchOpen: boolean;
  lastActivity: number;
  recording: boolean;
}

export interface AirportRecording {
  id: string;
  freq: number;
  label: string;
  timestamp: number;
  duration: number;
  filename: string;
  size: number;
}

export interface DiscoveredSignal {
  freq: number;
  power: number;
  burstCount: number;
  firstSeen: number;
  lastSeen: number;
}

export interface AirportScannerConfig {
  name: string;
  icao: string;
  centerFreq: number;
  sampleRate: number;
  channels: Array<{
    freq: number;
    label: string;
    mode: string;
    squelch: number;
    color: string;
    category?: string;
  }>;
  recording: {
    enabled: boolean;
    directory: string;
    maxDurationSec: number;
    preBufferSec: number;
    tailSec: number;
  };
  discovery: {
    enabled: boolean;
    thresholdDb: number;
    minBurstMs: number;
  };
}

interface ChannelRecordingState {
  active: boolean;
  buffer: Int16Array[];
  preBuffer: Int16Array[];
  startTime: number;
  lastSquelchOpen: number;
  filename: string;
  sampleCount: number;
}

// ============================================================================
// WAV Helper — raw Buffer writes, no npm packages
// ============================================================================
function writeWavFile(filepath: string, samples: Int16Array[], sampleRate: number): number {
  const totalSamples = samples.reduce((acc, s) => acc + s.length, 0);
  const dataSize = totalSamples * 2; // 16-bit = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);       // chunk size
  buffer.writeUInt16LE(1, 20);        // PCM
  buffer.writeUInt16LE(1, 22);        // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32);        // block align
  buffer.writeUInt16LE(16, 34);       // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const chunk of samples) {
    for (let i = 0; i < chunk.length; i++) {
      buffer.writeInt16LE(chunk[i], offset);
      offset += 2;
    }
  }

  writeFileSync(filepath, buffer);
  return dataSize + 44;
}

// ============================================================================
// Airport Scanner Service
// ============================================================================
export class AirportScannerService extends EventEmitter {
  private config: AirportScannerConfig;
  private channels: Map<number, AirportChannel> = new Map();
  private recordings: AirportRecording[] = [];
  private discovered: Map<number, DiscoveredSignal> = new Map();
  private recordingState: Map<number, ChannelRecordingState> = new Map();
  private running = false;
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private meterInterval: ReturnType<typeof setInterval> | null = null;
  private recordingsDir: string;
  private readonly SAMPLE_RATE = 22050;
  private readonly PRE_BUFFER_SAMPLES: number;
  private readonly MAX_PRE_BUFFER_CHUNKS = 10;

  constructor() {
    super();
    this.config = this.loadConfig();
    this.recordingsDir = join(__dirname, '../../', this.config.recording.directory);
    this.PRE_BUFFER_SAMPLES = Math.floor(this.config.recording.preBufferSec * this.SAMPLE_RATE);
    this.initChannels();
    this.ensureRecordingsDir();
    this.loadRecordingsList();
  }

  private loadConfig(): AirportScannerConfig {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {
        name: 'Prestwick Airport', icao: 'EGPK',
        centerFreq: 455662500, sampleRate: 2048000,
        channels: [], recording: { enabled: true, directory: 'data/recordings', maxDurationSec: 120, preBufferSec: 0.5, tailSec: 2.0 },
        discovery: { enabled: true, thresholdDb: 10, minBurstMs: 100 },
      };
    }
  }

  private saveConfig(): void {
    const toSave = {
      ...this.config,
      channels: Array.from(this.channels.values()).map(ch => ({
        freq: ch.freq, label: ch.label, mode: ch.mode,
        squelch: ch.squelch, color: ch.color, category: ch.category,
      })),
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2));
  }

  private initChannels(): void {
    for (const ch of this.config.channels) {
      this.channels.set(ch.freq, {
        ...ch, enabled: true,
        signalLevel: -120, squelchOpen: false,
        lastActivity: 0, recording: false,
      });
      this.recordingState.set(ch.freq, {
        active: false, buffer: [], preBuffer: [],
        startTime: 0, lastSquelchOpen: 0, filename: '', sampleCount: 0,
      });
    }
  }

  private ensureRecordingsDir(): void {
    if (!existsSync(this.recordingsDir)) {
      mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  private loadRecordingsList(): void {
    try {
      if (!existsSync(this.recordingsDir)) return;
      const files = readdirSync(this.recordingsDir).filter(f => f.endsWith('.wav'));
      this.recordings = files.map(f => {
        const parts = f.replace('.wav', '').split('_');
        const freq = parseInt(parts[0]) || 0;
        const ts = parseInt(parts[1]) || 0;
        const stat = statSync(join(this.recordingsDir, f));
        const durationSec = Math.max(0, (stat.size - 44) / (this.SAMPLE_RATE * 2));
        return {
          id: f.replace('.wav', ''),
          freq, label: this.channels.get(freq)?.label || 'Unknown',
          timestamp: ts, duration: Math.round(durationSec * 10) / 10,
          filename: f, size: stat.size,
        };
      }).sort((a, b) => b.timestamp - a.timestamp);
    } catch { /* ignore */ }
  }

  // ========================================================================
  // Public API
  // ========================================================================

  getStatus() {
    return {
      running: this.running,
      name: this.config.name,
      icao: this.config.icao,
      centerFreq: this.config.centerFreq,
      sampleRate: this.config.sampleRate,
      channelCount: this.channels.size,
      activeChannels: Array.from(this.channels.values()).filter(c => c.squelchOpen).length,
      recordingCount: this.recordings.length,
      discoveredCount: this.discovered.size,
    };
  }

  getChannels(): AirportChannel[] {
    return Array.from(this.channels.values());
  }

  getChannel(freq: number): AirportChannel | undefined {
    return this.channels.get(freq);
  }

  updateChannel(freq: number, updates: Partial<{ label: string; squelch: number; enabled: boolean; color: string }>): AirportChannel | null {
    const ch = this.channels.get(freq);
    if (!ch) return null;
    if (updates.label !== undefined) ch.label = updates.label;
    if (updates.squelch !== undefined) ch.squelch = updates.squelch;
    if (updates.enabled !== undefined) ch.enabled = updates.enabled;
    if (updates.color !== undefined) ch.color = updates.color;
    this.saveConfig();
    return ch;
  }

  addChannel(data: { freq: number; label: string; mode?: string; squelch?: number; color?: string; category?: string }): AirportChannel {
    const ch: AirportChannel = {
      freq: data.freq, label: data.label, mode: data.mode || 'NFM',
      squelch: data.squelch || 0.01, color: data.color || '#cccccc',
      category: data.category || 'ops', enabled: true,
      signalLevel: -120, squelchOpen: false, lastActivity: 0, recording: false,
    };
    this.channels.set(ch.freq, ch);
    this.recordingState.set(ch.freq, {
      active: false, buffer: [], preBuffer: [],
      startTime: 0, lastSquelchOpen: 0, filename: '', sampleCount: 0,
    });
    this.saveConfig();
    return ch;
  }

  removeChannel(freq: number): boolean {
    const existed = this.channels.delete(freq);
    this.recordingState.delete(freq);
    if (existed) this.saveConfig();
    return existed;
  }

  getRecordings(): AirportRecording[] {
    return this.recordings;
  }

  getRecordingPath(id: string): string | null {
    const rec = this.recordings.find(r => r.id === id);
    if (!rec) return null;
    const path = join(this.recordingsDir, rec.filename);
    return existsSync(path) ? path : null;
  }

  deleteRecording(id: string): boolean {
    const idx = this.recordings.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const rec = this.recordings[idx];
    try { unlinkSync(join(this.recordingsDir, rec.filename)); } catch { /* ignore */ }
    this.recordings.splice(idx, 1);
    return true;
  }

  getDiscovered(): DiscoveredSignal[] {
    return Array.from(this.discovered.values())
      .sort((a, b) => b.burstCount - a.burstCount);
  }

  // ========================================================================
  // Start / Stop
  // ========================================================================

  start(): { success: boolean; warning?: string } {
    if (this.running) return { success: true };

    // In real operation, this would retune the SDR dongle via multiplexer.
    // For now, we start in simulation mode to validate the UI/API.
    this.running = true;

    // Simulate signal activity for UI development/testing
    this.simulationInterval = setInterval(() => this.simulateActivity(), 500);

    // Emit metering updates every 100ms
    this.meterInterval = setInterval(() => {
      const channelUpdates = Array.from(this.channels.values()).map(ch => ({
        freq: ch.freq, signalLevel: ch.signalLevel,
        squelchOpen: ch.squelchOpen, recording: ch.recording,
        lastActivity: ch.lastActivity,
      }));
      this.emit('scanner_channel_update', channelUpdates);
    }, 100);

    this.emit('scanner_status', this.getStatus());
    return { success: true, warning: 'Running in simulation mode — real SDR retune not yet implemented' };
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.simulationInterval) { clearInterval(this.simulationInterval); this.simulationInterval = null; }
    if (this.meterInterval) { clearInterval(this.meterInterval); this.meterInterval = null; }

    // Close any active recordings
    for (const [freq, state] of this.recordingState) {
      if (state.active) this.finalizeRecording(freq);
    }

    // Reset channel states
    for (const ch of this.channels.values()) {
      ch.signalLevel = -120;
      ch.squelchOpen = false;
      ch.recording = false;
    }

    this.emit('scanner_status', this.getStatus());
  }

  // ========================================================================
  // Simulation (used when no real SDR data available)
  // ========================================================================

  private simulateActivity(): void {
    const now = Date.now();
    const channels = Array.from(this.channels.values());

    for (const ch of channels) {
      if (!ch.enabled) continue;

      // Simulate noise floor with occasional signals
      const noiseFloor = -110 + Math.random() * 8;
      const hasSignal = Math.random() < 0.03; // 3% chance per tick per channel
      const signalStrength = hasSignal ? -60 + Math.random() * 35 : noiseFloor;
      
      ch.signalLevel = signalStrength;
      const rmsLinear = Math.pow(10, signalStrength / 20);
      const squelchOpen = rmsLinear > ch.squelch;

      if (squelchOpen && !ch.squelchOpen) {
        // Squelch just opened
        ch.squelchOpen = true;
        ch.lastActivity = now;
        this.onSquelchOpen(ch.freq);
      } else if (!squelchOpen && ch.squelchOpen) {
        // Check tail time
        const state = this.recordingState.get(ch.freq);
        if (state && now - ch.lastActivity > this.config.recording.tailSec * 1000) {
          ch.squelchOpen = false;
          this.onSquelchClose(ch.freq);
        }
      } else if (squelchOpen) {
        ch.lastActivity = now;
        // Feed simulated audio to recording
        this.feedSimulatedAudio(ch.freq);
      }
    }

    // Auto-discovery simulation
    if (this.config.discovery.enabled && Math.random() < 0.005) {
      const discoveredFreq = Math.round((454700000 + Math.random() * 2000000) / 6250) * 6250;
      if (!this.channels.has(discoveredFreq)) {
        const existing = this.discovered.get(discoveredFreq);
        if (existing) {
          existing.burstCount++;
          existing.lastSeen = now;
          existing.power = -70 + Math.random() * 20;
        } else {
          this.discovered.set(discoveredFreq, {
            freq: discoveredFreq, power: -70 + Math.random() * 20,
            burstCount: 1, firstSeen: now, lastSeen: now,
          });
          this.emit('scanner_discovery', { freq: discoveredFreq, power: -70 });
        }
      }
    }
  }

  private feedSimulatedAudio(freq: number): void {
    const state = this.recordingState.get(freq);
    if (!state) return;

    // Generate 0.5s of simulated audio (tone + noise)
    const samples = new Int16Array(this.SAMPLE_RATE / 2);
    const toneFreq = 1000 + (freq % 1000);
    for (let i = 0; i < samples.length; i++) {
      const tone = Math.sin(2 * Math.PI * toneFreq * i / this.SAMPLE_RATE) * 8000;
      const noise = (Math.random() - 0.5) * 2000;
      samples[i] = Math.round(tone + noise);
    }

    if (state.active) {
      state.buffer.push(samples);
      state.sampleCount += samples.length;
      // Max duration check
      if (state.sampleCount / this.SAMPLE_RATE >= this.config.recording.maxDurationSec) {
        this.finalizeRecording(freq);
      }
    } else {
      // Pre-buffer (circular)
      state.preBuffer.push(samples);
      if (state.preBuffer.length > this.MAX_PRE_BUFFER_CHUNKS) {
        state.preBuffer.shift();
      }
    }
  }

  private onSquelchOpen(freq: number): void {
    if (!this.config.recording.enabled) return;
    const state = this.recordingState.get(freq);
    const ch = this.channels.get(freq);
    if (!state || !ch) return;

    const now = Date.now();
    state.active = true;
    state.startTime = now;
    state.lastSquelchOpen = now;
    state.filename = `${freq}_${now}.wav`;
    state.sampleCount = 0;

    // Move pre-buffer to main buffer
    state.buffer = [...state.preBuffer];
    state.sampleCount = state.buffer.reduce((acc, s) => acc + s.length, 0);
    state.preBuffer = [];

    ch.recording = true;
  }

  private onSquelchClose(freq: number): void {
    this.finalizeRecording(freq);
  }

  private finalizeRecording(freq: number): void {
    const state = this.recordingState.get(freq);
    const ch = this.channels.get(freq);
    if (!state || !state.active) return;

    state.active = false;
    ch && (ch.recording = false);

    if (state.buffer.length === 0 || state.sampleCount < this.SAMPLE_RATE * 0.1) {
      // Too short, discard
      state.buffer = [];
      state.sampleCount = 0;
      return;
    }

    const filepath = join(this.recordingsDir, state.filename);
    try {
      const fileSize = writeWavFile(filepath, state.buffer, this.SAMPLE_RATE);
      const duration = Math.round((state.sampleCount / this.SAMPLE_RATE) * 10) / 10;
      const recording: AirportRecording = {
        id: state.filename.replace('.wav', ''),
        freq, label: ch?.label || 'Unknown',
        timestamp: state.startTime, duration,
        filename: state.filename, size: fileSize,
      };
      this.recordings.unshift(recording);
      // Keep max 500 recordings in memory
      if (this.recordings.length > 500) this.recordings.pop();
      this.emit('scanner_recording', recording);
    } catch (err) {
      console.error(`[AirportScanner] Failed to write recording: ${err}`);
    }

    state.buffer = [];
    state.sampleCount = 0;
  }
}
