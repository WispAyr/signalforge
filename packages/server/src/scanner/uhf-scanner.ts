/**
 * UHF Close-Call Scanner Service
 * Sweeps UHF frequency ranges, detects signals via FFT energy, parks and demods.
 * Separate from the pager multiplexer — takes direct control of rtl_tcp.
 */
import { EventEmitter } from 'events';
import { RtlTcpClient } from '../sdr/rtltcp.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

// ============================================================================
// DSP Utilities (copied from multiplexer for independence)
// ============================================================================

function fft(re: Float64Array, im: Float64Array): void {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const tmp = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = tmp;
      }
    }
  }
}

function blackmanHarrisWindow(N: number): Float64Array {
  const w = new Float64Array(N);
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  for (let n = 0; n < N; n++) {
    const x = (2 * Math.PI * n) / (N - 1);
    w[n] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return w;
}

function designLowPassFIR(numTaps: number, cutoffNorm: number): Float64Array {
  const taps = new Float64Array(numTaps);
  const M = (numTaps - 1) / 2;
  const win = blackmanHarrisWindow(numTaps);
  for (let n = 0; n < numTaps; n++) {
    const x = n - M;
    if (Math.abs(x) < 1e-10) taps[n] = 2 * cutoffNorm * win[n];
    else taps[n] = (Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x)) * win[n];
  }
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += taps[i];
  for (let i = 0; i < numTaps; i++) taps[i] /= sum;
  return taps;
}

// ============================================================================
// Types
// ============================================================================

export type ScannerState = 'IDLE' | 'SCANNING' | 'SIGNAL_DETECTED' | 'PARKED';

export interface ScannerChannel {
  id: number;
  frequency: number;
  label: string;
  category: string;
  mode: 'NFM' | 'AM';
  priority: number;
  enabled: boolean;
}

export interface ScannerHit {
  id: number;
  timestamp: number;
  frequency: number;
  signal_strength_db: number;
  duration_ms: number;
  channel_id: number | null;
  audio_clip_path: string | null;
}

export interface ScanRange {
  start: number; // Hz
  end: number;   // Hz
}

export interface ScannerConfig {
  ranges: ScanRange[];
  dwellMs: number;
  thresholdDb: number;
  squelchTimeoutMs: number;
  maxParkMs: number;
  sampleRate: number;
  gain: number;
}

export interface ScannerStatus {
  state: ScannerState;
  currentFrequency: number;
  signalStrengthDb: number;
  noiseFloorDb: number;
  parkedChannel: ScannerChannel | null;
  config: ScannerConfig;
  sweepPosition: number; // 0-1 progress through sweep
  hits: number;
  uptime: number;
}

// ============================================================================
// UHF Scanner Service
// ============================================================================

const DEFAULT_CONFIG: ScannerConfig = {
  ranges: [
    { start: 446.0e6, end: 446.1e6 },     // PMR446 (446.000-446.100)
    { start: 449.0e6, end: 449.1e6 },     // Business Radio
    { start: 453.0e6, end: 453.3e6 },     // Fire & Rescue Fireground (453.025-453.200)
    { start: 454.8e6, end: 455.0e6 },     // Network Rail (454.825-454.900)
    { start: 455.5e6, end: 455.8e6 },     // Airport UHF (Ground 455.625, Fire 455.700)
    { start: 461.0e6, end: 461.1e6 },     // Coastguard UHF
    { start: 462.0e6, end: 462.1e6 },     // Mountain Rescue
    { start: 464.0e6, end: 464.1e6 },     // Taxi/Private Hire
  ],
  dwellMs: 100,
  thresholdDb: 10,
  squelchTimeoutMs: 3000,
  maxParkMs: 15000,  // Auto-resume after 15s on same freq (catches constant carriers)
  sampleRate: 2.048e6,
  gain: 40,
};

export class UHFScannerService extends EventEmitter {
  private db: Database.Database;
  private client: RtlTcpClient | null = null;
  private state: ScannerState = 'IDLE';
  private config: ScannerConfig = { ...DEFAULT_CONFIG };
  private currentFreq = 0;
  private signalStrengthDb = -120;
  private noiseFloorDb = -100;
  private noiseFloorMap = new Map<number, number>(); // freq -> noise floor running avg
  private parkedChannel: ScannerChannel | null = null;
  private parkedAt = 0;
  private lastSignalTime = 0;
  private sweepIndex = 0;
  private sweepSteps: number[] = [];
  private priorityChannels: ScannerChannel[] = [];
  private stepsSincePriority = 0;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private hitCount = 0;
  private connected = false;
  private multiplexer: any = null;
  private muxWasConnected = false;
  
  // FFT
  private fftSize = 2048;
  private fftWindow = blackmanHarrisWindow(2048);
  private iqBuffer: Float32Array | null = null;
  
  // Audio demod
  private demodFirTaps: Float64Array = new Float64Array(0);
  private firStateRe: Float64Array = new Float64Array(0);
  private firStateIm: Float64Array = new Float64Array(0);
  private firPos = 0;
  private prevI = 0;
  private prevQ = 0;
  private decimationFactor = 1;
  private ncoPhase = 0;
  private ncoFreq = 0; // Hz offset from center
  private detectedSignalFreq = 0; // precise Hz
  private recording = false;
  private recordBuffer: Float32Array[] = [];
  private recordStartTime = 0;
  private recordFreq = 0;
  private recordingsDir: string;
  private audioSampleRate = 8000;
  
  setMultiplexer(mux: any) { this.multiplexer = mux; }

  // WebSocket clients for audio
  private audioClients = new Set<any>();
  private lockedOut = new Set<number>(); // frequencies to skip (Hz, rounded to nearest kHz)
  
  constructor() {
    super();
    this.on('error', () => {});
    
    // Init SQLite
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = join(__dir, '..', '..', 'data', 'scanner.db');
    try { mkdirSync(join(__dir, '..', '..', 'data'), { recursive: true }); } catch {}
    this.db = new Database(dbPath);
    this.initDb();
    this.recordingsDir = join(__dir, '..', '..', 'data', 'recordings');
    try { mkdirSync(this.recordingsDir, { recursive: true }); } catch {}
  }
  
  private initDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scanner_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        frequency REAL NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'unknown',
        mode TEXT NOT NULL DEFAULT 'NFM',
        priority INTEGER NOT NULL DEFAULT 5,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS scanner_lockouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        frequency REAL NOT NULL,
        label TEXT DEFAULT '',
        added TEXT DEFAULT (datetime('now')),
        UNIQUE(frequency)
      );
      CREATE TABLE IF NOT EXISTS scanner_hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        frequency REAL NOT NULL,
        signal_strength_db REAL NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        channel_id INTEGER,
        audio_clip_path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_hits_timestamp ON scanner_hits(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_channels_freq ON scanner_channels(frequency);
    `);
    
    // Seed default channels if empty
    const count = this.db.prepare('SELECT COUNT(*) as c FROM scanner_channels').get() as any;
    if (count.c === 0) this.seedChannels();
    
    // Load priority channels
    this.loadPriorityChannels();
    this.loadLockouts();
  }
  
  private seedChannels() {
    const insert = this.db.prepare('INSERT INTO scanner_channels (frequency, label, category, mode, priority, enabled) VALUES (?, ?, ?, ?, ?, 1)');
    const seed = this.db.transaction(() => {
      // Airport UHF
      insert.run(455.025e6, 'Prestwick Ground Ops', 'airport', 'NFM', 1);
      insert.run(455.050e6, 'Airport UHF 455.050', 'airport', 'NFM', 3);
      insert.run(455.075e6, 'Airport UHF 455.075', 'airport', 'NFM', 3);
      insert.run(455.100e6, 'Airport UHF 455.100', 'airport', 'NFM', 3);
      insert.run(455.125e6, 'Airport UHF 455.125', 'airport', 'NFM', 3);
      insert.run(455.150e6, 'Airport UHF 455.150', 'airport', 'NFM', 3);
      // Fire & Rescue
      insert.run(456.025e6, 'Scottish Fire & Rescue 1', 'fire', 'NFM', 2);
      insert.run(456.050e6, 'Scottish Fire & Rescue 2', 'fire', 'NFM', 2);
      insert.run(456.075e6, 'Scottish Fire & Rescue 3', 'fire', 'NFM', 2);
      insert.run(456.100e6, 'Scottish Fire & Rescue 4', 'fire', 'NFM', 2);
      // Utilities
      insert.run(457.000e6, 'Utilities/Council 457.000', 'utility', 'NFM', 5);
      insert.run(457.100e6, 'Utilities/Council 457.100', 'utility', 'NFM', 5);
      insert.run(457.200e6, 'Utilities/Council 457.200', 'utility', 'NFM', 5);
      insert.run(457.300e6, 'Utilities/Council 457.300', 'utility', 'NFM', 5);
      insert.run(457.400e6, 'Utilities/Council 457.400', 'utility', 'NFM', 5);
      insert.run(457.500e6, 'Utilities/Council 457.500', 'utility', 'NFM', 5);
      // PMR446
      for (let ch = 1; ch <= 8; ch++) {
        const freq = 446.00625e6 + (ch - 1) * 12500;
        insert.run(freq, `PMR446 Ch${ch}`, 'pmr', 'NFM', 4);
      }
    });
    seed();
  }
  
  private loadPriorityChannels() {
    this.priorityChannels = this.db.prepare(
      'SELECT * FROM scanner_channels WHERE enabled = 1 ORDER BY priority ASC, frequency ASC'
    ).all() as ScannerChannel[];
  }
  
  // Build sweep step list from ranges
  private buildSweepSteps() {
    this.sweepSteps = [];
    const stepSize = this.config.sampleRate; // 2 MHz steps
    for (const range of this.config.ranges) {
      for (let f = range.start; f < range.end; f += stepSize) {
        const center = f + stepSize / 2;
        if (center <= range.end) this.sweepSteps.push(center);
        else this.sweepSteps.push((f + range.end) / 2);
      }
    }
    if (this.sweepSteps.length === 0) {
      // Fallback: at least scan the first range
      const r = this.config.ranges[0];
      if (r) this.sweepSteps.push((r.start + r.end) / 2);
    }
  }
  
  // ── Public API ──
  
  async start(opts?: Partial<ScannerConfig>): Promise<{ success: boolean; error?: string }> {
    if (this.state !== 'IDLE') return { success: false, error: 'Scanner already running' };
    
    if (opts) {
      if (opts.ranges) this.config.ranges = opts.ranges;
      if (opts.dwellMs) this.config.dwellMs = opts.dwellMs;
      if (opts.thresholdDb) this.config.thresholdDb = opts.thresholdDb;
      if (opts.squelchTimeoutMs) this.config.squelchTimeoutMs = opts.squelchTimeoutMs;
    }
    
    this.buildSweepSteps();
    this.loadPriorityChannels();
    this.loadLockouts();
    
    try {
      // Pause multiplexer to free rtl_tcp
      if (this.multiplexer && this.multiplexer.connected) {
        console.log('📡 UHF Scanner: pausing multiplexer to take SDR control');
        this.muxWasConnected = true;
        this.multiplexer.client?.disconnect();
        this.multiplexer.connected = false;
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Connect to rtl_tcp
      this.client = new RtlTcpClient('127.0.0.1', 1235);
      this.client.on('error', () => {});
      
      this.client.on('iq_data', (data: { samples: Float32Array; sampleRate: number; centerFrequency: number }) => {
        this.processIQ(data.samples, data.sampleRate, data.centerFrequency);
      });
      
      await this.client.connect();
      this.client.setSampleRate(this.config.sampleRate);
      this.client.setGain(this.config.gain);
      this.connected = true;
      
      this.state = 'SCANNING';
      this.startTime = Date.now();
      this.sweepIndex = 0;
      this.hitCount = 0;
      this.stepsSincePriority = 0;
      
      // Setup demod filter for NFM (12.5kHz channel)
      const cutoffNorm = 6250 / this.config.sampleRate;
      this.demodFirTaps = designLowPassFIR(127, cutoffNorm);
      this.firStateRe = new Float64Array(127);
      this.firStateIm = new Float64Array(127);
      this.firPos = 0;
      this.prevI = 0;
      this.prevQ = 0;
      this.decimationFactor = Math.max(1, Math.floor(this.config.sampleRate / this.audioSampleRate));
      
      // Start sweep
      this.nextSweepStep();
      
      this.emit('state_change', this.getStatus());
      console.log('📡 UHF Scanner started');
      return { success: true };
    } catch (err: any) {
      this.state = 'IDLE';
      return { success: false, error: err.message };
    }
  }
  
  stop() {
    if (this.state === 'IDLE') return;
    
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    
    // Log final hit duration if parked
    if (this.state === 'PARKED' && this.parkedAt > 0) {
      this.logHit(this.currentFreq, this.signalStrengthDb, Date.now() - this.parkedAt);
    }
    
    if (this.client) {
      this.client.removeAllListeners();
      try { this.client.disconnect(); } catch {}
      this.client = null;
    }
    this.connected = false;
    
    this.state = 'IDLE';
    this.parkedChannel = null;
    this.emit('state_change', this.getStatus());
    console.log('📡 UHF Scanner stopped');
  }
  
  lock(frequency: number) {
    if (this.state === 'IDLE') return;
    if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }
    
    this.currentFreq = frequency;
    this.client?.setFrequency(frequency);
    this.state = 'PARKED';
    this.parkedAt = Date.now();
    this.lastSignalTime = Date.now();
    
    // Find matching channel
    this.parkedChannel = this.priorityChannels.find(
      ch => Math.abs(ch.frequency - frequency) < 15000
    ) || null;
    
    // Setup NCO for demod
    this.ncoFreq = 0; // Already tuned to exact frequency
    this.ncoPhase = 0;
    
    // Start recording
    this.recording = true;
    this.recordBuffer = [];
    this.recordStartTime = Date.now();
    this.recordFreq = frequency;
    
    this.emit('state_change', this.getStatus());
  }
  
  unlock() {
    if (this.state !== 'PARKED') return;
    if (this.parkedAt > 0) {
      this.logHit(this.currentFreq, this.signalStrengthDb, Date.now() - this.parkedAt);
    }
    this.saveRecording();
    this.state = 'SCANNING';
    this.parkedChannel = null;
    this.parkedAt = 0;
    this.nextSweepStep();
    this.emit('state_change', this.getStatus());
  }
  
  getStatus(): ScannerStatus {
    return {
      state: this.state,
      currentFrequency: this.currentFreq,
      signalStrengthDb: this.signalStrengthDb,
      noiseFloorDb: this.noiseFloorDb,
      parkedChannel: this.parkedChannel,
      config: this.config,
      sweepPosition: this.sweepSteps.length > 0 ? this.sweepIndex / this.sweepSteps.length : 0,
      hits: this.hitCount,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }
  
  getChannels(): ScannerChannel[] {
    return this.db.prepare('SELECT * FROM scanner_channels ORDER BY priority ASC, frequency ASC').all() as ScannerChannel[];
  }
  
  addChannel(ch: Partial<ScannerChannel>): ScannerChannel {
    const result = this.db.prepare(
      'INSERT INTO scanner_channels (frequency, label, category, mode, priority, enabled) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(ch.frequency || 0, ch.label || '', ch.category || 'unknown', ch.mode || 'NFM', ch.priority || 5, ch.enabled !== false ? 1 : 0);
    this.loadPriorityChannels();
    this.loadLockouts();
    return this.db.prepare('SELECT * FROM scanner_channels WHERE id = ?').get(result.lastInsertRowid) as ScannerChannel;
  }
  
  updateChannel(id: number, updates: Partial<ScannerChannel>): ScannerChannel | null {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.frequency !== undefined) { fields.push('frequency = ?'); values.push(updates.frequency); }
    if (updates.label !== undefined) { fields.push('label = ?'); values.push(updates.label); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
    if (updates.mode !== undefined) { fields.push('mode = ?'); values.push(updates.mode); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
    if (fields.length === 0) return null;
    values.push(id);
    this.db.prepare(`UPDATE scanner_channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    this.loadPriorityChannels();
    this.loadLockouts();
    return this.db.prepare('SELECT * FROM scanner_channels WHERE id = ?').get(id) as ScannerChannel | null;
  }
  
  deleteChannel(id: number) {
    this.db.prepare('DELETE FROM scanner_channels WHERE id = ?').run(id);
    this.loadPriorityChannels();
    this.loadLockouts();
  }
  
  getHits(limit = 100): ScannerHit[] {
    return this.db.prepare('SELECT * FROM scanner_hits ORDER BY timestamp DESC LIMIT ?').all(limit) as ScannerHit[];
  }
  
  // --- Lockout management ---
  private loadLockouts() {
    const rows = this.db.prepare('SELECT frequency FROM scanner_lockouts').all() as any[];
    this.lockedOut.clear();
    for (const r of rows) this.lockedOut.add(Math.round(r.frequency / 1000) * 1000);
  }

  isLockedOut(freqHz: number): boolean {
    // Check if frequency (or anything within 5kHz) is locked out
    const rounded = Math.round(freqHz / 1000) * 1000;
    for (const lo of this.lockedOut) {
      if (Math.abs(lo - rounded) <= 5000) return true;
    }
    return false;
  }

  addLockout(freqHz: number, label = ''): any {
    const rounded = Math.round(freqHz / 1000) * 1000;
    this.db.prepare('INSERT OR IGNORE INTO scanner_lockouts (frequency, label) VALUES (?, ?)').run(rounded, label);
    this.lockedOut.add(rounded);
    return { frequency: rounded, label };
  }

  removeLockout(id: number) {
    const row = this.db.prepare('SELECT frequency FROM scanner_lockouts WHERE id = ?').get(id) as any;
    if (row) this.lockedOut.delete(Math.round(row.frequency / 1000) * 1000);
    this.db.prepare('DELETE FROM scanner_lockouts WHERE id = ?').run(id);
  }

  getLockouts(): any[] {
    return this.db.prepare('SELECT * FROM scanner_lockouts ORDER BY frequency').all();
  }

  lockoutCurrent(): any | null {
    if (this.state === 'PARKED' && this.currentFreq > 0) {
      const lo = this.addLockout(this.currentFreq, 'Locked out from scanner');
      // Resume scanning
      this.saveRecording();
      this.state = 'SCANNING';
      this.parkedChannel = null;
      this.parkedAt = 0;
      this.nextSweepStep();
      this.emit('state_change', this.getStatus());
      return lo;
    }
    return null;
  }

  addAudioClient(ws: any) { this.audioClients.add(ws); }
  removeAudioClient(ws: any) { this.audioClients.delete(ws); }
  
  isRunning(): boolean { return this.state !== 'IDLE'; }
  
  // ── Internal sweep logic ──
  
  private nextSweepStep() {
    if (this.state !== 'SCANNING') return;
    
    // Check if we should visit a priority channel
    this.stepsSincePriority++;
    const priorityInterval = 3; // Check priority every 3 steps
    if (this.stepsSincePriority >= priorityInterval && this.priorityChannels.length > 0) {
      this.stepsSincePriority = 0;
      // Round-robin through priority channels (high priority first)
      const prioIdx = this.sweepIndex % this.priorityChannels.length;
      const pCh = this.priorityChannels[prioIdx];
      if (pCh) {
        this.currentFreq = pCh.frequency;
        this.client?.setFrequency(pCh.frequency);
        this.scanTimer = setTimeout(() => this.nextSweepStep(), this.config.dwellMs);
        this.emit('sweep_update', { frequency: this.currentFreq, sweepPosition: this.sweepIndex / Math.max(1, this.sweepSteps.length) });
        return;
      }
    }
    
    // Normal sweep
    if (this.sweepSteps.length === 0) return;
    this.sweepIndex = (this.sweepIndex + 1) % this.sweepSteps.length;
    this.currentFreq = this.sweepSteps[this.sweepIndex];
    this.client?.setFrequency(this.currentFreq);
    
    this.scanTimer = setTimeout(() => this.nextSweepStep(), this.config.dwellMs);
    this.emit('sweep_update', { frequency: this.currentFreq, sweepPosition: this.sweepIndex / this.sweepSteps.length });
  }
  
  private processIQ(samples: Float32Array, sampleRate: number, centerFreq: number) {
    // FFT for signal detection
    const N = this.fftSize;
    if (samples.length < N * 2) return;
    
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      re[i] = samples[i * 2] * this.fftWindow[i];
      im[i] = samples[i * 2 + 1] * this.fftWindow[i];
    }
    fft(re, im);
    
    // Compute power spectrum
    const power = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const idx = (i + N / 2) % N;
      const mag = Math.sqrt(re[idx] * re[idx] + im[idx] * im[idx]) / N;
      power[i] = 20 * Math.log10(Math.max(mag, 1e-10));
    }
    
    // Calculate noise floor (median of power bins)
    const sorted = Float64Array.from(power).sort();
    const median = sorted[Math.floor(N * 0.5)];
    
    // Update running noise floor for this freq
    const prevNf = this.noiseFloorMap.get(this.currentFreq) ?? median;
    const alpha = 0.3;
    const nf = prevNf * (1 - alpha) + median * alpha;
    this.noiseFloorMap.set(this.currentFreq, nf);
    this.noiseFloorDb = nf;
    
    // Find peak
    let peakDb = -200;
    let peakBin = 0;
    for (let i = 0; i < N; i++) {
      if (power[i] > peakDb) { peakDb = power[i]; peakBin = i; }
    }
    this.signalStrengthDb = peakDb;
    
    const signalDetected = peakDb > nf + this.config.thresholdDb;
    
    // Emit spectrum data for visualization
    const magnitudes = new Float32Array(N);
    for (let i = 0; i < N; i++) magnitudes[i] = power[i];
    this.emit('fft_data', {
      magnitudes,
      centerFrequency: centerFreq,
      sampleRate,
      fftSize: N,
      peakBin,
      peakDb,
      noiseFloor: nf,
      signalDetected,
    });
    
    // Broadcast FFT data to audio WS clients for spectrum display
    this.broadcastFFT({
      type: 'scanner_fft',
      magnitudes: Array.from(magnitudes.subarray(0, Math.min(512, N))), // Downsample for WS
      centerFrequency: centerFreq,
      sampleRate,
      fftSize: N,
      peakBin,
      peakDb,
      noiseFloor: nf,
      signalDetected,
    });
    
    if (this.state === 'SCANNING') {
      if (signalDetected) {
        // Estimate precise frequency from peak bin
        const binHz = sampleRate / N;
        const preciseFreq = centerFreq - sampleRate / 2 + peakBin * binHz;
        
        // Skip locked-out frequencies
        if (this.isLockedOut(preciseFreq)) {
          return; // Let the sweep timer handle next step
        }
        
        this.state = 'SIGNAL_DETECTED';
        this.currentFreq = centerFreq; // Stay on this center freq
        
        // Find matching channel
        this.parkedChannel = this.priorityChannels.find(
          ch => Math.abs(ch.frequency - preciseFreq) < 15000
        ) || null;
        
        // Park — set NCO to detected signal for DDC
        this.detectedSignalFreq = preciseFreq;
        this.ncoFreq = preciseFreq - centerFreq; // offset from center
        this.ncoPhase = 0;
        // Start VOX recording
        this.recording = true;
        this.recordBuffer = [];
        this.recordStartTime = Date.now();
        this.recordFreq = preciseFreq;
        if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }
        this.state = 'PARKED';
        this.parkedAt = Date.now();
        this.lastSignalTime = Date.now();
        this.hitCount++;
        
        this.emit('signal_detected', {
          frequency: preciseFreq,
          centerFrequency: centerFreq,
          signalStrengthDb: peakDb,
          noiseFloorDb: nf,
          channel: this.parkedChannel,
        });
        this.emit('state_change', this.getStatus());
      }
    } else if (this.state === 'PARKED') {
      // Demodulate audio
      this.demodAndStream(samples, sampleRate, centerFreq);
      
      // Max park time — constant carriers get auto-resumed
      if (Date.now() - this.parkedAt > this.config.maxParkMs) {
        const duration = Date.now() - this.parkedAt;
        this.logHit(this.currentFreq, peakDb, duration);
        this.saveRecording();
        this.state = 'SCANNING';
        this.parkedChannel = null;
        this.parkedAt = 0;
        this.nextSweepStep();
        this.emit('state_change', this.getStatus());
        return;
      }
      
      if (signalDetected) {
        this.lastSignalTime = Date.now();
      } else if (Date.now() - this.lastSignalTime > this.config.squelchTimeoutMs) {
        // Signal dropped — log hit and resume
        const duration = Date.now() - this.parkedAt;
        this.logHit(this.currentFreq, peakDb, duration);
        this.saveRecording();
        
        this.state = 'SCANNING';
        this.parkedChannel = null;
        this.parkedAt = 0;
        this.nextSweepStep();
        this.emit('state_change', this.getStatus());
      }
      
      // Send metadata to audio clients
      this.broadcastMeta({
        type: 'scanner_meta',
        state: this.state,
        frequency: this.currentFreq,
        signalStrengthDb: peakDb,
        noiseFloorDb: nf,
        channel: this.parkedChannel,
      });
    }
  }
  
  private demodAndStream(samples: Float32Array, sampleRate: number, centerFreq: number) {
    const numSamples = samples.length / 2;
    const numTaps = this.demodFirTaps.length;
    // Two-stage decimation: first to ~32kHz channel, then to 8kHz audio
    const channelDecim = Math.max(1, Math.floor(sampleRate / 32000)); // ~64x for 2.048M
    const audioDecim = Math.max(1, Math.floor(32000 / this.audioSampleRate)); // 4x
    const outMax = Math.ceil(numSamples / (channelDecim * audioDecim));
    const audioOut = new Float32Array(outMax);
    let audioIdx = 0;
    let decimCounter = 0;
    let audioDecimCounter = 0;
    
    const mode = this.parkedChannel?.mode || 'NFM';
    const ncoStep = (2 * Math.PI * this.ncoFreq) / sampleRate;
    
    for (let n = 0; n < numSamples; n++) {
      const iIn = samples[n * 2];
      const qIn = samples[n * 2 + 1];
      
      // DDC — mix down to baseband using NCO
      const cosN = Math.cos(this.ncoPhase);
      const sinN = Math.sin(this.ncoPhase);
      const iMixed = iIn * cosN + qIn * sinN;
      const qMixed = -iIn * sinN + qIn * cosN;
      this.ncoPhase += ncoStep;
      if (this.ncoPhase > Math.PI) this.ncoPhase -= 2 * Math.PI;
      
      // FIR lowpass (channel filter)
      this.firStateRe[this.firPos] = iMixed;
      this.firStateIm[this.firPos] = qMixed;
      
      decimCounter++;
      if (decimCounter >= channelDecim) {
        decimCounter = 0;
        let filtI = 0, filtQ = 0;
        for (let t = 0; t < numTaps; t++) {
          const idx = (this.firPos - t + numTaps * 2) % numTaps;
          filtI += this.demodFirTaps[t] * this.firStateRe[idx];
          filtQ += this.demodFirTaps[t] * this.firStateIm[idx];
        }
        
        // Demodulate
        let sample = 0;
        if (mode === 'NFM') {
          const cross = filtQ * this.prevI - filtI * this.prevQ;
          const dot = filtI * this.prevI + filtQ * this.prevQ;
          sample = Math.atan2(cross, dot) / Math.PI;
        } else {
          sample = Math.sqrt(filtI * filtI + filtQ * filtQ);
        }
        this.prevI = filtI;
        this.prevQ = filtQ;
        
        // Second decimation to audio rate
        audioDecimCounter++;
        if (audioDecimCounter >= audioDecim) {
          audioDecimCounter = 0;
          if (audioIdx < outMax) audioOut[audioIdx++] = sample * 5.0; // gain boost
        }
      }
      
      this.firPos = (this.firPos + 1) % numTaps;
    }
    
    // Collect for VOX recording
    const audio = audioOut.subarray(0, audioIdx);
    if (this.recording && audio.length > 0) {
      this.recordBuffer.push(Float32Array.from(audio));
    }
    
    // Stream audio to connected clients
    if (this.audioClients.size > 0 && audio.length > 0) {
      const buf = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
      for (const ws of this.audioClients) {
        try {
          if (ws.readyState === 1) ws.send(buf, { binary: true });
        } catch {}
      }
    }
  }
  
  private saveRecording() {
    if (!this.recording || this.recordBuffer.length === 0) {
      this.recording = false;
      this.recordBuffer = [];
      return;
    }
    this.recording = false;
    
    // Merge buffers
    const totalLen = this.recordBuffer.reduce((s, b) => s + b.length, 0);
    if (totalLen < 400) { this.recordBuffer = []; return; } // Skip tiny recordings (<50ms)
    
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const buf of this.recordBuffer) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    this.recordBuffer = [];
    
    // Write WAV file
    const ts = new Date(this.recordStartTime).toISOString().replace(/[:.]/g, '-');
    const freqMHz = (this.recordFreq / 1e6).toFixed(4);
    const ch = this.parkedChannel?.label?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
    const filename = `${ts}_${freqMHz}MHz_${ch}.wav`;
    const filepath = join(this.recordingsDir, filename);
    
    try {
      const wavBuf = this.encodeWav(merged, this.audioSampleRate);
      writeFileSync(filepath, wavBuf);
      
      // Log to DB
      this.db.prepare(
        'UPDATE scanner_hits SET audio_clip_path = ? WHERE id = (SELECT MAX(id) FROM scanner_hits)'
      ).run(filepath);
      
      this.emit('recording_saved', { filename, filepath, duration: totalLen / this.audioSampleRate, frequency: this.recordFreq });
    } catch (e) {
      console.error('Failed to save recording:', e);
    }
  }
  
  private encodeWav(samples: Float32Array, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = samples.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
    buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // Convert float32 to int16
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    
    return buffer;
  }
  
  getRecordings(limit = 20): any[] {
    return this.db.prepare(
      'SELECT * FROM scanner_hits WHERE audio_clip_path IS NOT NULL ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }

  private broadcastMeta(data: any) {
    const msg = JSON.stringify(data);
    for (const ws of this.audioClients) {
      try {
        if (ws.readyState === 1) ws.send(msg);
      } catch {}
    }
  }

  private broadcastFFT(data: any) {
    const msg = JSON.stringify(data);
    for (const ws of this.audioClients) {
      try {
        if (ws.readyState === 1) ws.send(msg);
      } catch {}
    }
  }
  
  private logHit(frequency: number, strengthDb: number, durationMs: number) {
    const channelId = this.parkedChannel?.id || null;
    this.db.prepare(
      'INSERT INTO scanner_hits (timestamp, frequency, signal_strength_db, duration_ms, channel_id) VALUES (?, ?, ?, ?, ?)'
    ).run(Date.now(), frequency, strengthDb, durationMs, channelId);
    
    // Prune old hits
    this.db.prepare('DELETE FROM scanner_hits WHERE id NOT IN (SELECT id FROM scanner_hits ORDER BY timestamp DESC LIMIT 1000)').run();
    
    this.emit('hit', { frequency, strengthDb, durationMs, channelId, channel: this.parkedChannel });
  }

  // ── Added methods for full-featured UI ──

  getRecordingsDir(): string { return this.recordingsDir; }

  deleteRecordingByPath(filepath: string) {
    this.db.prepare('UPDATE scanner_hits SET audio_clip_path = NULL WHERE audio_clip_path = ?').run(filepath);
  }

  clearAllLockouts() {
    this.db.prepare('DELETE FROM scanner_lockouts').run();
    this.lockedOut.clear();
  }

  updateConfig(updates: any) {
    if (updates.thresholdDb !== undefined) this.config.thresholdDb = updates.thresholdDb;
    if (updates.dwellMs !== undefined) this.config.dwellMs = updates.dwellMs;
    if (updates.squelchTimeoutMs !== undefined) this.config.squelchTimeoutMs = updates.squelchTimeoutMs;
    if (updates.maxParkMs !== undefined) this.config.maxParkMs = updates.maxParkMs;
    if (updates.gain !== undefined) {
      this.config.gain = updates.gain;
      if (this.client) this.client.setGain(updates.gain);
    }
    if (updates.ranges) {
      this.config.ranges = updates.ranges;
      this.buildSweepSteps();
    }
  }

  getStats(): any {
    const totalHits = (this.db.prepare('SELECT COUNT(*) as c FROM scanner_hits').get() as any).c;
    const uniqueFreqs = (this.db.prepare('SELECT COUNT(DISTINCT ROUND(frequency/1000)*1000) as c FROM scanner_hits').get() as any).c;
    const busiestFreq = this.db.prepare('SELECT frequency, COUNT(*) as c FROM scanner_hits GROUP BY ROUND(frequency/1000)*1000 ORDER BY c DESC LIMIT 1').get() as any;
    const recordingCount = (this.db.prepare('SELECT COUNT(*) as c FROM scanner_hits WHERE audio_clip_path IS NOT NULL').get() as any).c;
    const hourlyHits = this.db.prepare("SELECT CAST(strftime('%H', timestamp/1000, 'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM scanner_hits GROUP BY hour ORDER BY hour").all();
    const categoryBreakdown = this.db.prepare("SELECT COALESCE(sc.category, 'unknown') as category, COUNT(*) as count FROM scanner_hits sh LEFT JOIN scanner_channels sc ON sh.channel_id = sc.id GROUP BY category").all();
    return {
      totalHits,
      uniqueFreqs,
      busiestFrequency: busiestFreq?.frequency || null,
      busiestFrequencyHits: busiestFreq?.c || 0,
      recordingCount,
      totalScanTime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      hourlyHits,
      categoryBreakdown,
    };
  }
}
