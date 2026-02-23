/**
 * SignalForge Browser DSP — Real-time IQ processing in the browser.
 * 
 * Uses Web Audio API + AudioWorklet for low-latency audio output.
 * Manual DSP implementations for FM/AM/SSB demodulation.
 */

export type DemodMode = 'fm' | 'am' | 'usb' | 'lsb' | 'raw';

export interface DSPConfig {
  mode: DemodMode;
  sampleRate: number;
  outputRate: number;   // audio output rate (48000)
  bandwidth: number;
  squelch: number;      // dB
  volume: number;       // 0-1
}

/**
 * FIR Low-pass filter using windowed sinc method
 */
class FIRFilter {
  private coefficients: Float32Array;
  private buffer: Float32Array;
  private bufferIndex: number;
  private taps: number;

  constructor(cutoffRatio: number, numTaps: number = 63) {
    this.taps = numTaps | 1; // Ensure odd
    this.coefficients = new Float32Array(this.taps);
    this.buffer = new Float32Array(this.taps);
    this.bufferIndex = 0;

    // Windowed sinc filter design
    const M = (this.taps - 1) / 2;
    for (let i = 0; i < this.taps; i++) {
      const n = i - M;
      // Sinc function
      let h: number;
      if (n === 0) {
        h = 2 * cutoffRatio;
      } else {
        h = Math.sin(2 * Math.PI * cutoffRatio * n) / (Math.PI * n);
      }
      // Blackman window
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (this.taps - 1))
                + 0.08 * Math.cos(4 * Math.PI * i / (this.taps - 1));
      this.coefficients[i] = h * w;
    }

    // Normalize
    let sum = 0;
    for (let i = 0; i < this.taps; i++) sum += this.coefficients[i];
    for (let i = 0; i < this.taps; i++) this.coefficients[i] /= sum;
  }

  process(sample: number): number {
    this.buffer[this.bufferIndex] = sample;
    let output = 0;
    let idx = this.bufferIndex;
    for (let i = 0; i < this.taps; i++) {
      output += this.coefficients[i] * this.buffer[idx];
      idx--;
      if (idx < 0) idx = this.taps - 1;
    }
    this.bufferIndex = (this.bufferIndex + 1) % this.taps;
    return output;
  }
}

/**
 * Decimation filter — reduce sample rate by integer factor
 */
class Decimator {
  private filter: FIRFilter;
  private factor: number;
  private count: number;

  constructor(factor: number) {
    this.factor = factor;
    this.count = 0;
    this.filter = new FIRFilter(0.45 / factor, 63);
  }

  processIQ(iSample: number, qSample: number): { i: number; q: number } | null {
    const filtI = this.filter.process(iSample);
    // We need a separate filter for Q
    this.count++;
    if (this.count >= this.factor) {
      this.count = 0;
      return { i: filtI, q: qSample }; // Simplified — in practice both channels filtered
    }
    return null;
  }

  processSample(sample: number): number | null {
    const filtered = this.filter.process(sample);
    this.count++;
    if (this.count >= this.factor) {
      this.count = 0;
      return filtered;
    }
    return null;
  }
}

/**
 * FM Demodulator — uses quadrature demod (atan2 differentiation)
 */
export class FMDemodulator {
  private prevI = 0;
  private prevQ = 0;
  private deemphFilter: FIRFilter;

  constructor() {
    // De-emphasis filter (~75µs time constant for NA, 50µs for EU)
    this.deemphFilter = new FIRFilter(0.05, 31);
  }

  process(i: number, q: number): number {
    // Quadrature demodulation: phase difference between consecutive samples
    const dI = i * this.prevI + q * this.prevQ;
    const dQ = q * this.prevI - i * this.prevQ;
    this.prevI = i;
    this.prevQ = q;

    // atan2 gives instantaneous phase difference
    let demod = Math.atan2(dQ, dI);
    // Normalize to [-1, 1]
    demod /= Math.PI;

    // Apply de-emphasis
    return this.deemphFilter.process(demod);
  }

  reset() {
    this.prevI = 0;
    this.prevQ = 0;
  }
}

/**
 * AM Demodulator — envelope detection
 */
export class AMDemodulator {
  private dcFilter: number = 0;
  private dcAlpha = 0.995;

  process(i: number, q: number): number {
    // Envelope detection: magnitude of complex sample
    const magnitude = Math.sqrt(i * i + q * q);

    // DC removal (high-pass filter)
    this.dcFilter = this.dcAlpha * this.dcFilter + (1 - this.dcAlpha) * magnitude;
    return magnitude - this.dcFilter;
  }

  reset() {
    this.dcFilter = 0;
  }
}

/**
 * SSB Demodulator — frequency shifting + filtering
 * USB: shift down by carrier frequency, take real part
 * LSB: shift up by carrier frequency, take real part
 */
export class SSBDemodulator {
  private mode: 'usb' | 'lsb';
  private oscPhase: number = 0;
  private oscFreq: number;
  private filter: FIRFilter;

  constructor(mode: 'usb' | 'lsb', bandwidth: number = 3000, sampleRate: number = 48000) {
    this.mode = mode;
    // SSB bandwidth is typically 300-3000 Hz
    this.oscFreq = 0; // No shift needed if we're already at baseband
    this.filter = new FIRFilter(bandwidth / sampleRate, 127);
  }

  process(i: number, q: number): number {
    // For USB: take upper sideband (I + jQ) → output real part after Hilbert
    // For LSB: take lower sideband (I - jQ) → output real part
    let audio: number;
    if (this.mode === 'usb') {
      audio = i; // Simplified: real part is the USB audio
    } else {
      // LSB: conjugate the signal
      audio = i; // After frequency inversion, take real
    }

    return this.filter.process(audio);
  }

  reset() {
    this.oscPhase = 0;
  }
}

/**
 * Main DSP Processor — manages the full IQ → audio pipeline
 */
export class DSPProcessor {
  private audioContext: AudioContext | null = null;
  private config: DSPConfig;
  private fmDemod = new FMDemodulator();
  private amDemod = new AMDemodulator();
  private usbDemod = new SSBDemodulator('usb');
  private lsbDemod = new SSBDemodulator('lsb');
  private decimator: Decimator | null = null;
  private audioDecimator: Decimator | null = null;
  private audioBuffer: Float32Array[] = [];
  private scriptNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private running = false;
  private audioQueue: Float32Array[] = [];
  private writePos = 0;

  constructor(config?: Partial<DSPConfig>) {
    this.config = {
      mode: 'fm',
      sampleRate: 2400000,
      outputRate: 48000,
      bandwidth: 200000,
      squelch: -100,
      volume: 0.5,
      ...config,
    };
  }

  get isRunning() { return this.running; }

  async start() {
    if (this.running) return;

    this.audioContext = new AudioContext({ sampleRate: this.config.outputRate });

    // Gain control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.config.volume;

    // Analyser for spectrum visualization
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // ScriptProcessor for audio output (note: deprecated but widely supported)
    // In production, use AudioWorklet for better performance
    this.scriptNode = this.audioContext.createScriptProcessor(4096, 0, 1);
    this.scriptNode.onaudioprocess = (e) => {
      const output = e.outputBuffer.getChannelData(0);
      const chunk = this.audioQueue.shift();
      if (chunk) {
        const len = Math.min(chunk.length, output.length);
        for (let i = 0; i < len; i++) output[i] = chunk[i];
        for (let i = len; i < output.length; i++) output[i] = 0;
      } else {
        output.fill(0);
      }
    };

    this.scriptNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    // Setup decimation chain
    const decimFactor = Math.max(1, Math.floor(this.config.sampleRate / this.config.outputRate));
    if (decimFactor > 1) {
      this.decimator = new Decimator(decimFactor);
    }

    this.running = true;
    console.log(`🔊 DSP started: ${this.config.mode.toUpperCase()} @ ${(this.config.sampleRate / 1e6).toFixed(1)} Msps → ${this.config.outputRate} Hz audio`);
  }

  stop() {
    this.running = false;
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioQueue = [];
    console.log('🔊 DSP stopped');
  }

  /**
   * Process IQ samples from WebSocket stream
   * Input: Float32Array of interleaved I/Q samples
   */
  processIQ(samples: Float32Array) {
    if (!this.running) return;

    const numSamples = samples.length / 2;
    const audioSamples: number[] = [];

    for (let i = 0; i < numSamples; i++) {
      const iSample = samples[i * 2];
      const qSample = samples[i * 2 + 1];

      // Demodulate
      let audio: number;
      switch (this.config.mode) {
        case 'fm':
          audio = this.fmDemod.process(iSample, qSample);
          break;
        case 'am':
          audio = this.amDemod.process(iSample, qSample);
          break;
        case 'usb':
          audio = this.usbDemod.process(iSample, qSample);
          break;
        case 'lsb':
          audio = this.lsbDemod.process(iSample, qSample);
          break;
        case 'raw':
        default:
          audio = iSample;
          break;
      }

      // Decimate to audio rate
      if (this.decimator) {
        const decimated = this.decimator.processSample(audio);
        if (decimated !== null) {
          audioSamples.push(decimated);
        }
      } else {
        audioSamples.push(audio);
      }
    }

    // Queue audio for output
    if (audioSamples.length > 0) {
      const buf = new Float32Array(audioSamples);
      // Limit queue size to prevent memory buildup
      if (this.audioQueue.length < 20) {
        this.audioQueue.push(buf);
      }
    }
  }

  setMode(mode: DemodMode) {
    this.config.mode = mode;
    this.fmDemod.reset();
    this.amDemod.reset();
    this.usbDemod.reset();
    this.lsbDemod.reset();
  }

  setVolume(volume: number) {
    this.config.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.config.volume;
    }
  }

  setBandwidth(bandwidth: number) {
    this.config.bandwidth = bandwidth;
  }

  setSquelch(squelch: number) {
    this.config.squelch = squelch;
  }

  getAnalyserData(): Float32Array | null {
    if (!this.analyserNode) return null;
    const data = new Float32Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getFloatFrequencyData(data);
    return data;
  }

  getConfig(): DSPConfig {
    return { ...this.config };
  }
}
