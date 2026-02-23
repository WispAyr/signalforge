/**
 * SDR Multiplexer — One physical SDR, multiple virtual receivers
 *
 * Takes raw IQ from RtlTcpClient and provides:
 * 1. Full-bandwidth FFT for spectrum/waterfall display
 * 2. Channelized virtual receivers that extract narrowband signals
 *    via digital downconversion (frequency shift + low-pass filter + decimation)
 * 3. Each virtual receiver can pipe audio to decoders (multimon-ng, etc.)
 */
import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync } from 'child_process';
import { RtlTcpClient } from './rtltcp.js';

// ============================================================================
// DSP Utilities — Pure TypeScript
// ============================================================================

/** Radix-2 DIT FFT (in-place, complex interleaved Float64) */
function fft(re: Float64Array, im: Float64Array): void {
  const N = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly
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

/** Blackman-Harris window coefficients */
function blackmanHarrisWindow(N: number): Float64Array {
  const w = new Float64Array(N);
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  for (let n = 0; n < N; n++) {
    const x = (2 * Math.PI * n) / (N - 1);
    w[n] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return w;
}

/** Design a low-pass FIR filter using windowed sinc (Blackman-Harris) */
function designLowPassFIR(numTaps: number, cutoffNorm: number): Float64Array {
  const taps = new Float64Array(numTaps);
  const M = (numTaps - 1) / 2;
  const win = blackmanHarrisWindow(numTaps);
  for (let n = 0; n < numTaps; n++) {
    const x = n - M;
    if (Math.abs(x) < 1e-10) {
      taps[n] = 2 * cutoffNorm * win[n];
    } else {
      taps[n] = (Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x)) * win[n];
    }
  }
  // Normalize
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += taps[i];
  for (let i = 0; i < numTaps; i++) taps[i] /= sum;
  return taps;
}

// ============================================================================
// Virtual Receiver
// ============================================================================

export type DemodMode = 'NFM' | 'AM' | 'USB' | 'LSB' | 'CW' | 'RAW';

export interface VirtualReceiverConfig {
  id?: string;
  centerFreq: number;      // Hz — desired center frequency
  bandwidth: number;        // Hz — channel bandwidth (e.g. 12500 for NFM)
  outputRate: number;       // Hz — output sample rate (e.g. 22050)
  mode: DemodMode;
  decoder?: 'multimon-ng' | 'none';
  label?: string;
}

export interface VirtualReceiverStatus {
  id: string;
  centerFreq: number;
  bandwidth: number;
  outputRate: number;
  mode: DemodMode;
  decoder: string;
  label: string;
  offsetHz: number;
  decimation: number;
  active: boolean;
}

export class VirtualReceiver extends EventEmitter {
  readonly id: string;
  private config: VirtualReceiverConfig;
  private parentCenterFreq = 0;
  private parentSampleRate = 0;
  private offsetHz = 0;
  private decimationFactor = 1;
  private firTaps: Float64Array = new Float64Array(0);
  private firStateRe: Float64Array = new Float64Array(0);
  private firStateIm: Float64Array = new Float64Array(0);
  private firPos = 0;
  private phaseAccum = 0;
  private prevI = 0;
  private prevQ = 0;
  private active = false;

  constructor(config: VirtualReceiverConfig) {
    super();
    this.id = config.id || `vrx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.config = { ...config };
  }

  /** Configure DSP chain based on parent SDR parameters */
  configure(parentCenterFreq: number, parentSampleRate: number) {
    this.parentCenterFreq = parentCenterFreq;
    this.parentSampleRate = parentSampleRate;
    this.offsetHz = this.config.centerFreq - parentCenterFreq;
    this.decimationFactor = Math.max(1, Math.floor(parentSampleRate / this.config.outputRate));
    
    // Design low-pass filter: cutoff at half the channel bandwidth
    const cutoffNorm = (this.config.bandwidth / 2) / parentSampleRate;
    const numTaps = 65; // odd number for symmetric filter
    this.firTaps = designLowPassFIR(numTaps, cutoffNorm);
    this.firStateRe = new Float64Array(numTaps);
    this.firStateIm = new Float64Array(numTaps);
    this.firPos = 0;
    this.phaseAccum = 0;
    this.prevI = 0;
    this.prevQ = 0;
    this.active = true;
  }

  /** Process a chunk of wideband IQ (Float32Array, interleaved I/Q) */
  processIQ(samples: Float32Array, sampleRate: number, centerFreq: number): Float32Array | null {
    if (!this.active) return null;
    
    // Reconfigure if parent params changed
    if (centerFreq !== this.parentCenterFreq || sampleRate !== this.parentSampleRate) {
      this.configure(centerFreq, sampleRate);
    }

    const numSamples = samples.length / 2;
    const phaseInc = (-2 * Math.PI * this.offsetHz) / sampleRate;
    const numTaps = this.firTaps.length;

    // Output buffer — after decimation
    const outMax = Math.ceil(numSamples / this.decimationFactor);
    const audioOut = new Float32Array(outMax);
    let audioIdx = 0;
    let decimCounter = 0;

    for (let n = 0; n < numSamples; n++) {
      // 1. Frequency shift (digital downconversion)
      const cosV = Math.cos(this.phaseAccum);
      const sinV = Math.sin(this.phaseAccum);
      const iIn = samples[n * 2];
      const qIn = samples[n * 2 + 1];
      const iShifted = iIn * cosV - qIn * sinV;
      const qShifted = iIn * sinV + qIn * cosV;
      this.phaseAccum += phaseInc;
      // Keep phase bounded
      if (this.phaseAccum > Math.PI) this.phaseAccum -= 2 * Math.PI;
      else if (this.phaseAccum < -Math.PI) this.phaseAccum += 2 * Math.PI;

      // 2. FIR low-pass filter
      this.firStateRe[this.firPos] = iShifted;
      this.firStateIm[this.firPos] = qShifted;
      
      // 3. Decimation — only compute filter output every N samples
      decimCounter++;
      if (decimCounter >= this.decimationFactor) {
        decimCounter = 0;
        let filtI = 0, filtQ = 0;
        for (let t = 0; t < numTaps; t++) {
          const idx = (this.firPos - t + numTaps * 2) % numTaps;
          filtI += this.firTaps[t] * this.firStateRe[idx];
          filtQ += this.firTaps[t] * this.firStateIm[idx];
        }

        // 4. Demodulate
        let sample = 0;
        if (this.config.mode === 'NFM') {
          // FM discriminator: atan2(Q[n]*I[n-1] - I[n]*Q[n-1], I[n]*I[n-1] + Q[n]*Q[n-1])
          const cross = filtQ * this.prevI - filtI * this.prevQ;
          const dot = filtI * this.prevI + filtQ * this.prevQ;
          sample = Math.atan2(cross, dot);
          // Normalize to [-1, 1] range (max deviation = pi)
          sample /= Math.PI;
        } else if (this.config.mode === 'AM') {
          sample = Math.sqrt(filtI * filtI + filtQ * filtQ);
        } else if (this.config.mode === 'USB') {
          sample = filtI; // Upper sideband — just take I (simplified)
        } else if (this.config.mode === 'LSB') {
          sample = filtQ;
        } else {
          sample = filtI; // RAW/CW
        }
        this.prevI = filtI;
        this.prevQ = filtQ;

        if (audioIdx < outMax) {
          audioOut[audioIdx++] = sample;
        }
      }

      this.firPos = (this.firPos + 1) % numTaps;
    }

    const result = audioOut.subarray(0, audioIdx);
    this.emit('audio', result);
    return result;
  }

  retune(centerFreq: number) {
    this.config.centerFreq = centerFreq;
    if (this.active) {
      this.offsetHz = centerFreq - this.parentCenterFreq;
      this.phaseAccum = 0;
    }
  }

  getStatus(): VirtualReceiverStatus {
    return {
      id: this.id,
      centerFreq: this.config.centerFreq,
      bandwidth: this.config.bandwidth,
      outputRate: this.config.outputRate,
      mode: this.config.mode,
      decoder: this.config.decoder || 'none',
      label: this.config.label || `${(this.config.centerFreq / 1e6).toFixed(3)} MHz ${this.config.mode}`,
      offsetHz: this.offsetHz,
      decimation: this.decimationFactor,
      active: this.active,
    };
  }

  stop() {
    this.active = false;
  }
}

// ============================================================================
// Decoder Pipeline
// ============================================================================

export class DecoderPipeline extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  readonly type: string;

  constructor(type: string) {
    super();
    this.type = type;
  }

  startMultimonNG() {
    const bin = '/opt/homebrew/bin/multimon-ng';
    try {
      this.process = spawn(bin, [
        '-a', 'POCSAG512', '-a', 'POCSAG1200', '-a', 'POCSAG2400', '-a', 'FLEX',
        '-t', 'raw', '-f', 'alpha', '/dev/stdin',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          const parsed = this.parseMultimonLine(line);
          if (parsed) this.emit('message', parsed);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        // multimon-ng sends status to stderr — ignore
      });

      this.process.on('error', (err) => {
        console.error(`🔊 DecoderPipeline error: ${err.message}`);
      });

      this.process.on('exit', (code) => {
        console.log(`🔊 multimon-ng exited with code ${code}`);
        this.process = null;
      });

      console.log('🔊 multimon-ng decoder pipeline started');
    } catch (err: any) {
      console.error(`🔊 Failed to start multimon-ng: ${err.message}`);
    }
  }

  /** Feed raw 16-bit signed PCM audio at the configured sample rate */
  feedAudio(samples: Float32Array, sampleRate: number) {
    if (!this.process?.stdin?.writable) return;
    // Convert float32 [-1,1] to signed 16-bit PCM
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const val = Math.max(-1, Math.min(1, samples[i]));
      pcm.writeInt16LE(Math.round(val * 32767), i * 2);
    }
    try {
      this.process.stdin.write(pcm);
    } catch {
      // stdin closed
    }
  }

  private parseMultimonLine(line: string): { protocol: string; capcode: number; address: number; function: number; content: string; baudRate: number } | null {
    // POCSAG512: Address: 1234000  Function: 0  Alpha:   FIRE ALARM AT 123 MAIN ST
    // POCSAG1200: Address: 5678000  Function: 2  Numeric:   1234567890
    // FLEX: ...
    let m = line.match(/POCSAG(\d+):\s+Address:\s+(\d+)\s+Function:\s+(\d+)\s+(Alpha|Numeric|Tone):\s*(.*)/i);
    if (m) {
      return {
        protocol: 'POCSAG',
        baudRate: parseInt(m[1]),
        address: parseInt(m[2]),
        capcode: parseInt(m[2]),
        function: parseInt(m[3]),
        content: m[5]?.trim() || '',
      };
    }
    m = line.match(/FLEX[:|]\s*.*?(\d{7,}).*?ALN\s*\|\s*(.*)/i);
    if (m) {
      return {
        protocol: 'FLEX',
        baudRate: 6400,
        address: parseInt(m[1]),
        capcode: parseInt(m[1]),
        function: 0,
        content: m[2]?.trim() || '',
      };
    }
    return null;
  }

  stop() {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}

// ============================================================================
// SDR Multiplexer
// ============================================================================

export interface MultiplexerStatus {
  connected: boolean;
  centerFreq: number;
  sampleRate: number;
  fftSize: number;
  fftRate: number;
  receivers: VirtualReceiverStatus[];
  rtlTcpPid: number | null;
}

export class SDRMultiplexer extends EventEmitter {
  private client: RtlTcpClient | null = null;
  private receivers = new Map<string, VirtualReceiver>();
  private decoders = new Map<string, DecoderPipeline>();
  private rtlTcpProcess: ChildProcess | null = null;
  private fftSize = 2048;
  private fftWindow: Float64Array;
  private fftCount = 0;
  private fftSkip = 4; // Process every Nth IQ chunk for FFT (throttle)
  private connected = false;
  private centerFreq = 153.350e6;
  private sampleRate = 2.048e6;

  constructor() {
    super();
    this.on('error', () => {}); // Prevent unhandled error crashes
    this.fftWindow = blackmanHarrisWindow(this.fftSize);
  }

  /** Auto-detect SDR device */
  detectDevice(): { found: boolean; info?: string } {
    try {
      const result = execSync('/opt/homebrew/bin/rtl_test -t 2>&1 || true', { timeout: 5000 }).toString();
      const found = result.includes('Found') || result.includes('Sampling at');
      return { found, info: result.split('\n').slice(0, 5).join('; ') };
    } catch {
      return { found: false };
    }
  }

  /** Start rtl_tcp as a child process */
  startRtlTcp(port = 1235): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.rtlTcpProcess) { resolve(); return; }
      
      try {
        this.rtlTcpProcess = spawn('/opt/homebrew/bin/rtl_tcp', ['-p', String(port)], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const timeout = setTimeout(() => {
          resolve(); // Assume started after 2s
        }, 2000);

        this.rtlTcpProcess.stderr?.on('data', (data: Buffer) => {
          const msg = data.toString();
          console.log(`📡 rtl_tcp: ${msg.trim()}`);
          if (msg.includes('listening')) {
            clearTimeout(timeout);
            resolve();
          }
        });

        this.rtlTcpProcess.on('error', (err) => {
          console.error(`📡 rtl_tcp spawn error: ${err.message}`);
          this.rtlTcpProcess = null;
          clearTimeout(timeout);
          reject(err);
        });

        this.rtlTcpProcess.on('exit', (code) => {
          console.log(`📡 rtl_tcp exited (code ${code})`);
          this.rtlTcpProcess = null;
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Connect to rtl_tcp and start processing */
  async connect(host = '127.0.0.1', port = 1235): Promise<boolean> {
    try {
      this.client = new RtlTcpClient(host, port);
      this.client.on('error', () => {}); // Prevent crash on unhandled error

      this.client.on('iq_data', (data: { samples: Float32Array; sampleRate: number; centerFrequency: number; timestamp: number }) => {
        this.centerFreq = data.centerFrequency;
        this.sampleRate = data.sampleRate;

        // FFT for spectrum display (throttled)
        this.fftCount++;
        if (this.fftCount >= this.fftSkip) {
          this.fftCount = 0;
          this.computeAndEmitFFT(data.samples, data.sampleRate, data.centerFrequency);
        }

        // Emit IQ metadata
        this.emit('iq_meta', {
          type: 'iq_meta',
          sampleRate: data.sampleRate,
          centerFrequency: data.centerFrequency,
          timestamp: data.timestamp,
        });

        // Feed virtual receivers
        for (const [, rx] of this.receivers) {
          rx.processIQ(data.samples, data.sampleRate, data.centerFrequency);
        }
      });

      this.client.on('disconnected', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      // Configure for pager frequency
      const info = await this.client.connect();
      this.client.setFrequency(this.centerFreq);
      this.client.setSampleRate(this.sampleRate);
      this.client.setGain(40);
      this.connected = true;
      this.emit('connected', info);

      // Configure all existing receivers
      for (const [, rx] of this.receivers) {
        rx.configure(this.centerFreq, this.sampleRate);
      }

      console.log('📡 SDR Multiplexer connected and processing');
      return true;
    } catch (err: any) {
      console.error(`📡 SDR Multiplexer connect failed: ${err.message}`);
      this.connected = false;
      return false;
    }
  }

  private computeAndEmitFFT(samples: Float32Array, sampleRate: number, centerFreq: number) {
    const N = this.fftSize;
    if (samples.length < N * 2) return;

    const re = new Float64Array(N);
    const im = new Float64Array(N);

    // Apply window and copy
    for (let i = 0; i < N; i++) {
      re[i] = samples[i * 2] * this.fftWindow[i];
      im[i] = samples[i * 2 + 1] * this.fftWindow[i];
    }

    fft(re, im);

    // Compute magnitude in dB, FFT-shifted
    const magnitudes = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const idx = (i + N / 2) % N; // FFT shift
      const mag = Math.sqrt(re[idx] * re[idx] + im[idx] * im[idx]) / N;
      magnitudes[i] = 20 * Math.log10(Math.max(mag, 1e-10));
    }

    this.emit('fft_data', {
      type: 'fft_data',
      magnitudes,
      centerFrequency: centerFreq,
      sampleRate,
      fftSize: N,
      timestamp: Date.now(),
    });
  }

  /** Add a virtual receiver */
  addReceiver(config: VirtualReceiverConfig): VirtualReceiver {
    const rx = new VirtualReceiver(config);
    if (this.connected) {
      rx.configure(this.centerFreq, this.sampleRate);
    }
    this.receivers.set(rx.id, rx);

    // Set up decoder if requested
    if (config.decoder === 'multimon-ng') {
      const decoder = new DecoderPipeline('multimon-ng');
      decoder.startMultimonNG();
      decoder.on('message', (msg) => {
        this.emit('pager_message', msg);
      });
      this.decoders.set(rx.id, decoder);

      rx.on('audio', (audio: Float32Array) => {
        decoder.feedAudio(audio, config.outputRate);
      });
    }

    console.log(`📡 Virtual receiver added: ${rx.getStatus().label} (${rx.id})`);
    this.emit('receiver_added', rx.getStatus());
    return rx;
  }

  /** Remove a virtual receiver */
  removeReceiver(id: string): boolean {
    const rx = this.receivers.get(id);
    if (!rx) return false;
    rx.stop();
    this.receivers.delete(id);
    const decoder = this.decoders.get(id);
    if (decoder) {
      decoder.stop();
      this.decoders.delete(id);
    }
    this.emit('receiver_removed', id);
    return true;
  }

  /** Retune a virtual receiver */
  retuneReceiver(id: string, centerFreq: number): boolean {
    const rx = this.receivers.get(id);
    if (!rx) return false;
    rx.retune(centerFreq);
    return true;
  }

  /** Get status */
  getStatus(): MultiplexerStatus {
    return {
      connected: this.connected,
      centerFreq: this.centerFreq,
      sampleRate: this.sampleRate,
      fftSize: this.fftSize,
      fftRate: Math.round(this.sampleRate / (this.fftSize * this.fftSkip)),
      receivers: Array.from(this.receivers.values()).map(r => r.getStatus()),
      rtlTcpPid: this.rtlTcpProcess?.pid || null,
    };
  }

  getClient(): RtlTcpClient | null { return this.client; }
  isConnected(): boolean { return this.connected; }

  /** Auto-start: detect device, start rtl_tcp, connect, create default receivers */
  async autoStart(): Promise<boolean> {
    console.log('📡 SDR Multiplexer auto-start...');
    
    const detection = this.detectDevice();
    if (!detection.found) {
      console.log('📡 No RTL-SDR device detected');
      return false;
    }
    console.log(`📡 RTL-SDR detected: ${detection.info}`);

    // Kill any existing rtl_tcp
    try { execSync('pkill -f rtl_tcp 2>/dev/null || true'); } catch {}
    await new Promise(r => setTimeout(r, 1000));

    try {
      await this.startRtlTcp(1235);
      await new Promise(r => setTimeout(r, 1500)); // Give it time
      const ok = await this.connect('127.0.0.1', 1235);
      if (!ok) return false;

      // Create default pager receiver
      this.addReceiver({
        centerFreq: 153.350e6,
        bandwidth: 12500,
        outputRate: 22050,
        mode: 'NFM',
        decoder: 'multimon-ng',
        label: 'Pager 153.350 MHz',
      });

      return true;
    } catch (err: any) {
      console.error(`📡 Auto-start failed: ${err.message}`);
      return false;
    }
  }

  /** Shutdown everything */
  shutdown() {
    for (const [id] of this.receivers) this.removeReceiver(id);
    this.client?.disconnect();
    if (this.rtlTcpProcess) {
      this.rtlTcpProcess.kill('SIGTERM');
      this.rtlTcpProcess = null;
    }
    this.connected = false;
  }
}
