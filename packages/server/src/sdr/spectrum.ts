import { EventEmitter } from 'events';
import type { SpectrumSweepConfig, SpectrumSweepResult, DetectedSignal } from '@signalforge/shared';

/**
 * Spectrum Analyzer — wideband spectrum sweep and signal detection.
 * 
 * When connected to an SDR, hops across frequency range collecting FFT data.
 * In demo mode, generates realistic synthetic spectrum data.
 */

export class SpectrumAnalyzer extends EventEmitter {
  private sweeping = false;
  private config: SpectrumSweepConfig | null = null;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private sweepCount = 0;
  private maxHold: Float32Array | null = null;
  private currentStep = 0;
  private frequencies: Float32Array | null = null;
  private powers: Float32Array | null = null;
  private detectedSignals: DetectedSignal[] = [];

  // Callback to tune SDR
  private tuneCallback: ((freq: number) => void) | null = null;

  get isSweeping() { return this.sweeping; }
  get currentConfig() { return this.config; }

  setTuneCallback(cb: (freq: number) => void) {
    this.tuneCallback = cb;
  }

  startSweep(config: SpectrumSweepConfig) {
    this.config = config;
    this.sweeping = true;
    this.sweepCount = 0;
    this.currentStep = 0;

    const numBins = Math.ceil((config.endFrequency - config.startFrequency) / config.stepSize);
    this.frequencies = new Float32Array(numBins);
    this.powers = new Float32Array(numBins);
    this.maxHold = new Float32Array(numBins).fill(-120);

    for (let i = 0; i < numBins; i++) {
      this.frequencies[i] = config.startFrequency + i * config.stepSize;
    }

    // Step through frequencies at dwellTime intervals
    this.sweepInterval = setInterval(() => this.step(), config.dwellTime);
    console.log(`📊 Spectrum sweep started: ${(config.startFrequency / 1e6).toFixed(1)}-${(config.endFrequency / 1e6).toFixed(1)} MHz`);
  }

  stopSweep() {
    this.sweeping = false;
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    this.sweepInterval = null;
    console.log(`📊 Spectrum sweep stopped after ${this.sweepCount} sweeps`);
  }

  getDetectedSignals(): DetectedSignal[] {
    return [...this.detectedSignals];
  }

  /**
   * Feed real FFT data from the SDR at the current frequency
   */
  feedFFTData(centerFreq: number, magnitudes: Float32Array) {
    if (!this.sweeping || !this.frequencies || !this.powers || !this.maxHold) return;

    // Map FFT bins to our sweep frequency array
    const binWidth = this.config!.stepSize;
    const startIdx = Math.floor((centerFreq - this.config!.startFrequency) / binWidth);

    for (let i = 0; i < magnitudes.length && startIdx + i < this.powers.length; i++) {
      if (startIdx + i >= 0) {
        this.powers[startIdx + i] = magnitudes[i];
        if (magnitudes[i] > this.maxHold[startIdx + i]) {
          this.maxHold[startIdx + i] = magnitudes[i];
        }
      }
    }
  }

  private step() {
    if (!this.config || !this.frequencies || !this.powers || !this.maxHold) return;

    const numBins = this.frequencies.length;
    const freq = this.frequencies[this.currentStep];

    // Tune SDR if callback available
    if (this.tuneCallback) {
      this.tuneCallback(freq);
    }

    // In demo mode, generate synthetic power data
    if (!this.tuneCallback) {
      this.generateDemoData();
    }

    this.currentStep++;

    // Complete sweep
    if (this.currentStep >= numBins) {
      this.currentStep = 0;
      this.sweepCount++;

      // Detect signals
      this.detectSignals();

      // Emit sweep result
      const result: SpectrumSweepResult = {
        frequencies: new Float32Array(this.frequencies),
        powers: new Float32Array(this.powers),
        maxHold: new Float32Array(this.maxHold),
        timestamp: Date.now(),
        sweepCount: this.sweepCount,
      };

      this.emit('sweep', result);
    }
  }

  private generateDemoData() {
    if (!this.frequencies || !this.powers || !this.maxHold) return;

    for (let i = 0; i < this.frequencies.length; i++) {
      const freq = this.frequencies[i];
      let power = -100 + (Math.random() - 0.5) * 6; // Noise floor ~-100 dBm

      // FM broadcast band (87.5-108 MHz)
      if (freq >= 87.5e6 && freq <= 108e6) {
        // Add FM stations every ~2 MHz
        const fmStations = [88.1e6, 89.5e6, 91.3e6, 93.5e6, 95.8e6, 97.6e6, 99.1e6, 101.1e6, 103.0e6, 104.5e6, 106.2e6];
        for (const station of fmStations) {
          const offset = Math.abs(freq - station);
          if (offset < 150e3) {
            power = Math.max(power, -30 - (offset / 150e3) * 40 + (Math.random() - 0.5) * 3);
          }
        }
      }

      // Air band signals (118-137 MHz)
      if (freq >= 118e6 && freq <= 137e6) {
        const airFreqs = [121.5e6, 123.45e6, 125.8e6, 127.275e6, 131.55e6, 136.975e6];
        for (const af of airFreqs) {
          const offset = Math.abs(freq - af);
          if (offset < 25e3) {
            power = Math.max(power, -55 - (offset / 25e3) * 20 + (Math.random() - 0.5) * 5);
          }
        }
      }

      // NOAA weather satellites (~137 MHz)
      const noaaFreqs = [137.1e6, 137.62e6, 137.9125e6];
      for (const nf of noaaFreqs) {
        const offset = Math.abs(freq - nf);
        if (offset < 40e3) {
          power = Math.max(power, -60 - (offset / 40e3) * 15);
        }
      }

      // 2m amateur (144-146 MHz)
      if (freq >= 144e6 && freq <= 146e6) {
        if (Math.abs(freq - 144.8e6) < 12.5e3) power = Math.max(power, -50 + Math.random() * 10);
        if (Math.abs(freq - 145.5e6) < 12.5e3) power = Math.max(power, -55 + Math.random() * 8);
      }

      // ADS-B (1090 MHz)
      if (Math.abs(freq - 1090e6) < 1e6) {
        power = Math.max(power, -70 + Math.random() * 15);
      }

      // PMR446
      if (freq >= 446e6 && freq <= 446.2e6) {
        power = Math.max(power, -75 + Math.random() * 10);
      }

      this.powers[i] = power;
      if (power > this.maxHold[i]) {
        this.maxHold[i] = power;
      }
    }
  }

  private detectSignals() {
    if (!this.frequencies || !this.powers) return;

    const threshold = -70; // dBm threshold for signal detection
    this.detectedSignals = [];

    let inSignal = false;
    let signalStart = 0;
    let peakPower = -200;
    let peakIdx = 0;

    for (let i = 0; i < this.powers.length; i++) {
      if (this.powers[i] > threshold) {
        if (!inSignal) {
          inSignal = true;
          signalStart = i;
          peakPower = this.powers[i];
          peakIdx = i;
        } else if (this.powers[i] > peakPower) {
          peakPower = this.powers[i];
          peakIdx = i;
        }
      } else if (inSignal) {
        inSignal = false;
        const bandwidth = (i - signalStart) * (this.config?.stepSize || 1000);
        this.detectedSignals.push({
          frequency: this.frequencies[peakIdx],
          power: peakPower,
          bandwidth,
          timestamp: Date.now(),
        });
      }
    }

    if (this.detectedSignals.length > 0) {
      this.emit('signals', this.detectedSignals);
    }
  }
}
