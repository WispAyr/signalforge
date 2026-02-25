import { GPUFft } from './fft';
import { GPUFilter, type FilterType } from './filter';
import { GPUFmDemod } from './demod';

export interface GpuStatus {
  available: boolean;
  backend: 'webgpu' | 'js-fallback';
  adapterName: string;
  vendor: string;
  architecture: string;
  description: string;
  maxBufferSize: number;
  maxComputeWorkgroupsPerDimension: number;
}

// CPU fallback implementations
function cpuFFT(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = 2 * Math.PI / len;
    const wR = Math.cos(angle), wI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * curR - imag[i + j + len / 2] * curI;
        const vI = real[i + j + len / 2] * curI + imag[i + j + len / 2] * curR;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR; imag[i + j + len / 2] = uI - vI;
        const newR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR; curR = newR;
      }
    }
  }
}

function cpuFIR(input: Float32Array, taps: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let sum = 0;
    for (let j = 0; j < taps.length; j++) {
      if (i - j >= 0) sum += input[i - j] * taps[j];
    }
    output[i] = sum;
  }
  return output;
}

function cpuFMDemod(iData: Float32Array, qData: Float32Array): Float32Array {
  const output = new Float32Array(iData.length);
  for (let n = 1; n < iData.length; n++) {
    const re = iData[n] * iData[n - 1] + qData[n] * qData[n - 1];
    const im = qData[n] * iData[n - 1] - iData[n] * qData[n - 1];
    output[n] = Math.atan2(im, re);
  }
  return output;
}

export interface DspMetrics {
  fftCount: number;
  fftSamplesTotal: number;
  fftTimeMs: number;
  filterCount: number;
  demodCount: number;
  lastFftMs: number;
  samplesPerSec: number;
}

export class GpuDspEngine {
  private device: GPUDevice | null = null;
  private adapter: GPUAdapter | null = null;
  private gpuFft: GPUFft | null = null;
  private gpuFilter: GPUFilter | null = null;
  private gpuDemod: GPUFmDemod | null = null;
  private _status: GpuStatus = {
    available: false,
    backend: 'js-fallback',
    adapterName: '',
    vendor: '',
    architecture: '',
    description: '',
    maxBufferSize: 0,
    maxComputeWorkgroupsPerDimension: 0,
  };

  // Performance metrics
  private _metrics: DspMetrics = {
    fftCount: 0, fftSamplesTotal: 0, fftTimeMs: 0,
    filterCount: 0, demodCount: 0, lastFftMs: 0, samplesPerSec: 0,
  };
  private _metricsWindowStart = performance.now();

  get status(): GpuStatus { return this._status; }
  get isGPU(): boolean { return this._status.available; }
  get metrics(): DspMetrics { return this._metrics; }

  /** Reset metrics window (call once per second for rolling stats) */
  resetMetricsWindow(): void {
    const now = performance.now();
    const elapsed = (now - this._metricsWindowStart) / 1000;
    if (elapsed > 0) {
      this._metrics.samplesPerSec = this._metrics.fftSamplesTotal / elapsed;
    }
    this._metrics.fftCount = 0;
    this._metrics.fftSamplesTotal = 0;
    this._metrics.fftTimeMs = 0;
    this._metrics.filterCount = 0;
    this._metrics.demodCount = 0;
    this._metricsWindowStart = now;
  }

  async init(): Promise<GpuStatus> {
    if (!navigator.gpu) {
      console.warn('[GpuDspEngine] WebGPU not available, using JS fallback');
      return this._status;
    }

    try {
      this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!this.adapter) throw new Error('No adapter');

      const info = this.adapter.info;
      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxBufferSize: Math.min(this.adapter.limits.maxBufferSize, 256 * 1024 * 1024),
          maxStorageBufferBindingSize: Math.min(this.adapter.limits.maxStorageBufferBindingSize, 128 * 1024 * 1024),
        },
      });

      this.device.lost.then((lostInfo) => {
        console.error('[GpuDspEngine] Device lost:', lostInfo.message);
        this._status.available = false;
        this._status.backend = 'js-fallback';
      });

      this.gpuFft = new GPUFft(this.device);
      this.gpuFilter = new GPUFilter(this.device);
      this.gpuDemod = new GPUFmDemod(this.device);

      await Promise.all([
        this.gpuFft.init(),
        this.gpuFilter.init(),
        this.gpuDemod.init(),
      ]);

      this._status = {
        available: true,
        backend: 'webgpu',
        adapterName: info.device || 'Unknown GPU',
        vendor: info.vendor || 'Unknown',
        architecture: info.architecture || 'Unknown',
        description: info.description || '',
        maxBufferSize: this.device.limits.maxBufferSize,
        maxComputeWorkgroupsPerDimension: this.device.limits.maxComputeWorkgroupsPerDimension,
      };

      console.log(`[GpuDspEngine] Initialized: ${this._status.adapterName} (${this._status.vendor})`);
    } catch (err) {
      console.warn('[GpuDspEngine] GPU init failed, using JS fallback:', err);
    }

    return this._status;
  }

  /**
   * FFT on interleaved IQ data. Returns magnitude spectrum in dB (full N bins).
   */
  async fft(iq: Float32Array, size?: number): Promise<Float32Array> {
    const n = size ?? iq.length / 2;
    const t0 = performance.now();
    let result: Float32Array;

    if (this.gpuFft && this._status.available) {
      result = await this.gpuFft.fft(iq, n);
    } else {
      // JS fallback
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        real[i] = iq[i * 2] ?? 0;
        imag[i] = iq[i * 2 + 1] ?? 0;
      }
      cpuFFT(real, imag);
      result = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
        result[i] = 20 * Math.log10(Math.max(mag, 1e-10));
      }
    }

    const dt = performance.now() - t0;
    this._metrics.fftCount++;
    this._metrics.fftSamplesTotal += n;
    this._metrics.fftTimeMs += dt;
    this._metrics.lastFftMs = dt;
    return result;
  }

  /**
   * Windowed FFT on interleaved IQ data with FFT-shift.
   * Returns FFT-shifted magnitude spectrum in dB (N bins).
   * Primary entry point for waterfall/spectrum display.
   */
  async fftWindowed(iq: Float32Array, size: number, window: Float32Array): Promise<Float32Array> {
    const t0 = performance.now();
    let result: Float32Array;

    if (this.gpuFft && this._status.available) {
      result = await this.gpuFft.fftWindowed(iq, size, window);
    } else {
      // JS fallback: window + FFT + magnitude + shift
      const real = new Float32Array(size);
      const imag = new Float32Array(size);
      const offset = iq.length > size * 2 ? iq.length - size * 2 : 0;
      for (let i = 0; i < size; i++) {
        real[i] = (iq[offset + i * 2] ?? 0) * window[i];
        imag[i] = (iq[offset + i * 2 + 1] ?? 0) * window[i];
      }
      cpuFFT(real, imag);
      const half = size >> 1;
      result = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        const j = (i + half) % size;
        const pwr = real[j] * real[j] + imag[j] * imag[j];
        result[i] = 10 * Math.log10(pwr + 1e-20);
      }
    }

    const dt = performance.now() - t0;
    this._metrics.fftCount++;
    this._metrics.fftSamplesTotal += size;
    this._metrics.fftTimeMs += dt;
    this._metrics.lastFftMs = dt;
    return result;
  }

  /**
   * FFT on separate real/imag arrays
   */
  async fftSeparate(real: Float32Array, imag: Float32Array): Promise<Float32Array> {
    if (this.gpuFft && this._status.available) {
      return this.gpuFft.fftSeparate(real, imag);
    }
    const r = new Float32Array(real);
    const im = new Float32Array(imag);
    cpuFFT(r, im);
    const spectrum = new Float32Array(r.length);
    for (let i = 0; i < r.length; i++) {
      const mag = Math.sqrt(r[i] * r[i] + im[i] * im[i]) / r.length;
      spectrum[i] = 20 * Math.log10(Math.max(mag, 1e-10));
    }
    return spectrum;
  }

  async filter(input: Float32Array, taps: Float32Array): Promise<Float32Array> {
    this._metrics.filterCount++;
    if (this.gpuFilter && this._status.available) {
      return this.gpuFilter.filter(input, taps);
    }
    return cpuFIR(input, taps);
  }

  async fmDemod(iData: Float32Array, qData: Float32Array): Promise<Float32Array> {
    this._metrics.demodCount++;
    if (this.gpuDemod && this._status.available) {
      return this.gpuDemod.demod(iData, qData);
    }
    return cpuFMDemod(iData, qData);
  }

  destroy(): void {
    this.gpuFft?.destroy();
    this.device?.destroy();
    this.device = null;
    this.gpuFft = null;
    this.gpuFilter = null;
    this.gpuDemod = null;
    this._status.available = false;
    this._status.backend = 'js-fallback';
  }
}

// Singleton
let _engine: GpuDspEngine | null = null;

export async function getGpuDspEngine(): Promise<GpuDspEngine> {
  if (!_engine) {
    _engine = new GpuDspEngine();
    await _engine.init();
  }
  return _engine;
}

export type { DspMetrics };
export { GPUFilter, type FilterType } from './filter';
