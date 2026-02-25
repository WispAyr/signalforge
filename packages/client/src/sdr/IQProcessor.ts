import { getGpuDspEngine } from "../gpu/engine";

export type SpectrumCallback = (spectrum: Float32Array, centerFreq: number, sampleRate: number) => void;

/**
 * IQProcessor — receives IQ frames from WebSocket, runs GPU FFT, outputs spectrum data.
 * Connects the SDR data stream to the waterfall/spectrum display.
 */
export class IQProcessor {
  private ws: WebSocket | null = null;
  private running = false;
  private spectrumCallbacks: SpectrumCallback[] = [];
  private rawCallbacks: ((iq: Float32Array) => void)[] = [];
  private fftSize = 2048;
  private centerFreq = 100e6;
  private sampleRate = 2400000;

  get isRunning() { return this.running; }

  onSpectrum(cb: SpectrumCallback) {
    this.spectrumCallbacks.push(cb);
    return () => { this.spectrumCallbacks = this.spectrumCallbacks.filter(c => c !== cb); };
  }

  onRawIQ(cb: (iq: Float32Array) => void) {
    this.rawCallbacks.push(cb);
    return () => { this.rawCallbacks = this.rawCallbacks.filter(c => c !== cb); };
  }

  async start(wsUrl?: string) {
    if (this.running) return;
    this.running = true;

    const url = wsUrl || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("[IQProcessor] WebSocket connected");
      // Request demo stream start
      this.ws?.send(JSON.stringify({ type: "start" }));
    };

    this.ws.onmessage = async (e) => {
      if (!(e.data instanceof ArrayBuffer)) {
        // Handle JSON messages (metadata updates)
        try {
          const msg = JSON.parse(e.data as string);
          if (msg.type === "status" && msg.streaming) {
            console.log("[IQProcessor] Stream active");
          }
          if (msg.centerFrequency) this.centerFreq = msg.centerFrequency;
          if (msg.sampleRate) this.sampleRate = msg.sampleRate;
        } catch {}
        return;
      }

      // Binary IQ data — Float32 interleaved I/Q from demo bridge
      const iq = new Float32Array(e.data);
      if (iq.length < 2) return;

      // Notify raw listeners
      for (const cb of this.rawCallbacks) cb(iq);

      // Run GPU FFT for spectrum
      await this.processFFT(iq);
    };

    this.ws.onclose = () => {
      console.log("[IQProcessor] WebSocket closed");
      this.running = false;
    };

    this.ws.onerror = (err) => {
      console.error("[IQProcessor] WebSocket error", err);
    };
  }

  stop() {
    this.running = false;
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "stop" }));
      this.ws.close();
      this.ws = null;
    }
  }

  setFrequency(freq: number) {
    this.centerFreq = freq;
    this.ws?.send(JSON.stringify({ type: "set_frequency", frequency: freq }));
  }

  private async processFFT(iq: Float32Array) {
    try {
      const engine = await getGpuDspEngine();
      // Take fftSize samples (interleaved I/Q = fftSize*2 floats)
      const n = Math.min(this.fftSize * 2, iq.length);
      const chunk = iq.subarray(0, n);

      // engine.fft() already returns magnitude in dB (full N bins)
      const spectrum = await engine.fft(chunk, this.fftSize);

      // FFT shift (swap halves for centered spectrum)
      const half = this.fftSize / 2;
      const shifted = new Float32Array(this.fftSize);
      shifted.set(spectrum.subarray(half), 0);
      shifted.set(spectrum.subarray(0, half), half);

      for (const cb of this.spectrumCallbacks) {
        cb(shifted, this.centerFreq, this.sampleRate);
      }
    } catch (err) {
      // GPU not available — skip silently
    }
  }
}

// Singleton
let _processor: IQProcessor | null = null;
export function getIQProcessor(): IQProcessor {
  if (!_processor) _processor = new IQProcessor();
  return _processor;
}
