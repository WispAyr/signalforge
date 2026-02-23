import type { SDRDeviceInfo, IQFrame } from '@signalforge/shared';

/**
 * SDR Bridge — abstracts SDR hardware access.
 * Currently provides a demo mode that generates synthetic signals.
 * Future: WebUSB passthrough, SoapySDR native bindings, remote SDR.
 */
export class SDRBridge {
  private sequence = 0;

  getDevices(): SDRDeviceInfo[] {
    // Demo device always available
    return [
      {
        id: 'demo-0',
        name: 'SignalForge Demo SDR',
        type: 'demo',
        serial: 'DEMO-001',
        available: true,
        sampleRates: [250000, 1000000, 2000000, 2400000],
        frequencyRange: { min: 24e6, max: 1766e6 },
        gainRange: { min: 0, max: 50 },
      },
    ];
  }

  /**
   * Start a demo IQ stream that generates synthetic signals.
   * Includes: noise floor, a few carrier signals, and an FM-modulated signal.
   */
  startDemoStream(callback: (frame: IQFrame) => void): ReturnType<typeof setInterval> {
    const sampleRate = 2400000;
    const centerFreq = 100e6; // 100 MHz
    const frameSize = 4096;

    return setInterval(() => {
      const samples = new Float32Array(frameSize * 2);

      // Generate noise + synthetic signals
      for (let i = 0; i < frameSize; i++) {
        const t = (this.sequence * frameSize + i) / sampleRate;

        // Noise floor
        let I = (Math.random() - 0.5) * 0.01;
        let Q = (Math.random() - 0.5) * 0.01;

        // Carrier at +200kHz offset
        const f1 = 200000;
        I += 0.3 * Math.cos(2 * Math.PI * f1 * t);
        Q += 0.3 * Math.sin(2 * Math.PI * f1 * t);

        // Weak carrier at -500kHz
        const f2 = -500000;
        I += 0.05 * Math.cos(2 * Math.PI * f2 * t);
        Q += 0.05 * Math.sin(2 * Math.PI * f2 * t);

        // FM signal at +800kHz (modulated by 1kHz tone)
        const fmCarrier = 800000;
        const fmMod = 1000;
        const fmDev = 75000;
        const phase = 2 * Math.PI * fmCarrier * t + (fmDev / fmMod) * Math.sin(2 * Math.PI * fmMod * t);
        I += 0.15 * Math.cos(phase);
        Q += 0.15 * Math.sin(phase);

        samples[i * 2] = I;
        samples[i * 2 + 1] = Q;
      }

      callback({
        sequence: this.sequence++,
        sampleRate,
        centerFrequency: centerFreq,
        timestamp: Date.now(),
        samples,
      });
    }, (frameSize / sampleRate) * 1000); // ~1.7ms per frame
  }
}
