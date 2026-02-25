// ============================================================================
// SignalForge — Auto-Frequency Discovery
// ============================================================================

interface FrequencyCandidate {
  frequency: number;
  power_db: number;
  noise_floor_db: number;
  excess_db: number;
  first_seen: number;
  last_seen: number;
  hit_count: number;
}

export class FrequencyDiscovery {
  private avgEnergy: Float64Array | null = null;
  private frameCount = 0;
  private alpha = 0.01; // EMA smoothing
  private candidates = new Map<number, FrequencyCandidate>();
  private coveredFreqs: Set<number>;
  private lastCenterFreq = 0;
  private lastSampleRate = 0;
  private lastFftSize = 0;

  constructor(coveredFreqsMHz: number[]) {
    // Convert MHz to Hz for comparison
    this.coveredFreqs = new Set(coveredFreqsMHz.map(f => Math.round(f * 1e6)));
  }

  updateCovered(freqsMHz: number[]) {
    this.coveredFreqs = new Set(freqsMHz.map(f => Math.round(f * 1e6)));
  }

  processFFT(data: { magnitudes: Float64Array | number[]; centerFrequency: number; sampleRate: number; fftSize: number }) {
    const { magnitudes, centerFrequency, sampleRate, fftSize } = data;
    const N = magnitudes.length;

    this.lastCenterFreq = centerFrequency;
    this.lastSampleRate = sampleRate;
    this.lastFftSize = fftSize;

    if (!this.avgEnergy || this.avgEnergy.length !== N) {
      this.avgEnergy = new Float64Array(N);
      for (let i = 0; i < N; i++) this.avgEnergy[i] = magnitudes[i] as number;
      this.frameCount = 1;
      return;
    }

    // EMA update
    for (let i = 0; i < N; i++) {
      this.avgEnergy[i] = this.avgEnergy[i] * (1 - this.alpha) + (magnitudes[i] as number) * this.alpha;
    }
    this.frameCount++;

    // Only check every 100 frames
    if (this.frameCount % 100 !== 0) return;

    // Compute noise floor (median of avg energy)
    const sorted = [...this.avgEnergy].sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];

    const binBW = sampleRate / fftSize;
    const startFreq = centerFrequency - sampleRate / 2;

    for (let i = 0; i < N; i++) {
      const power = this.avgEnergy[i];
      const excess = power - noiseFloor;
      if (excess <= 10) continue; // Below 10dB threshold

      const freq = startFreq + i * binBW;
      const freqRounded = Math.round(freq / 1000) * 1000; // Round to nearest kHz

      // Skip if already covered by a receiver (within 12.5kHz)
      let covered = false;
      for (const cf of this.coveredFreqs) {
        if (Math.abs(cf - freqRounded) < 12500) { covered = true; break; }
      }
      if (covered) continue;

      // Only interested in POCSAG band (148-154 MHz roughly)
      if (freqRounded < 148e6 || freqRounded > 156e6) continue;

      const existing = this.candidates.get(freqRounded);
      if (existing) {
        existing.power_db = power;
        existing.excess_db = excess;
        existing.noise_floor_db = noiseFloor;
        existing.last_seen = Date.now();
        existing.hit_count++;
      } else {
        this.candidates.set(freqRounded, {
          frequency: freqRounded,
          power_db: power,
          noise_floor_db: noiseFloor,
          excess_db: excess,
          first_seen: Date.now(),
          last_seen: Date.now(),
          hit_count: 1,
        });
      }
    }

    // Prune stale candidates (not seen in 5 min)
    const cutoff = Date.now() - 300000;
    for (const [f, c] of this.candidates) {
      if (c.last_seen < cutoff) this.candidates.delete(f);
    }
  }

  getDiscovered(): FrequencyCandidate[] {
    return [...this.candidates.values()]
      .filter(c => c.hit_count >= 5)
      .sort((a, b) => b.excess_db - a.excess_db);
  }
}
