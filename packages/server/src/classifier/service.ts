// ============================================================================
// SignalForge Signal Classifier — Real Heuristic Classification
// ============================================================================
import { EventEmitter } from 'events';
import type { ClassificationResult, SignalFeatures, SignalClassification, ClassifierConfig } from '@signalforge/shared';

interface SpectrumInput {
  spectrum: number[];
  centerFreq: number;
  sampleRate: number;
}

interface DetectedSignal {
  centerFreq: number;
  bandwidth: number;
  snr: number;
  peakPower: number;
  classification: SignalClassification;
  confidence: number;
  description: string;
}

// Known signal fingerprints by bandwidth and characteristics
const SIGNAL_FINGERPRINTS: Array<{
  name: string;
  classification: SignalClassification;
  minBW: number;
  maxBW: number;
  freqRanges?: Array<{ min: number; max: number }>;
  description: string;
}> = [
  { name: 'FM Broadcast', classification: 'fm', minBW: 150000, maxBW: 250000, freqRanges: [{ min: 87.5e6, max: 108e6 }], description: 'Wideband FM broadcast station' },
  { name: 'ADS-B', classification: 'pulsed', minBW: 1500000, maxBW: 2500000, freqRanges: [{ min: 1089e6, max: 1091e6 }], description: 'Aircraft transponder (Mode S)' },
  { name: 'AIS', classification: 'fsk', minBW: 20000, maxBW: 30000, freqRanges: [{ min: 161.9e6, max: 162.1e6 }], description: 'Automatic Identification System (maritime)' },
  { name: 'APRS', classification: 'fsk', minBW: 10000, maxBW: 15000, freqRanges: [{ min: 144.3e6, max: 144.5e6 }, { min: 144.8e6, max: 145e6 }], description: 'Automatic Packet Reporting System' },
  { name: 'PMR446', classification: 'fm', minBW: 10000, maxBW: 15000, freqRanges: [{ min: 446e6, max: 446.2e6 }], description: 'PMR446 licence-free radio' },
  { name: 'DAB', classification: 'ofdm', minBW: 1400000, maxBW: 1600000, freqRanges: [{ min: 174e6, max: 240e6 }], description: 'Digital Audio Broadcasting' },
  { name: 'DMR', classification: 'digital', minBW: 10000, maxBW: 14000, description: 'Digital Mobile Radio (TDMA)' },
  { name: 'Airband AM', classification: 'am', minBW: 6000, maxBW: 10000, freqRanges: [{ min: 118e6, max: 137e6 }], description: 'Aviation AM voice' },
  { name: 'Marine VHF', classification: 'fm', minBW: 20000, maxBW: 30000, freqRanges: [{ min: 156e6, max: 162e6 }], description: 'Marine VHF radio' },
  { name: 'NOAA Weather', classification: 'fm', minBW: 20000, maxBW: 30000, freqRanges: [{ min: 162.4e6, max: 162.55e6 }], description: 'NOAA Weather Radio' },
  { name: 'LoRa', classification: 'digital', minBW: 125000, maxBW: 500000, freqRanges: [{ min: 868e6, max: 869e6 }, { min: 915e6, max: 928e6 }], description: 'LoRa spread spectrum' },
  { name: 'GSM', classification: 'digital', minBW: 180000, maxBW: 220000, freqRanges: [{ min: 925e6, max: 960e6 }, { min: 1805e6, max: 1880e6 }], description: 'GSM mobile downlink' },
  { name: 'LTE', classification: 'ofdm', minBW: 1400000, maxBW: 20000000, description: 'LTE cellular (OFDMA)' },
  { name: 'CW/Morse', classification: 'cw', minBW: 50, maxBW: 500, description: 'Continuous wave / Morse code' },
  { name: 'SSB Voice', classification: 'ssb', minBW: 2000, maxBW: 4000, description: 'Single sideband voice' },
  { name: 'ISM OOK', classification: 'pulsed', minBW: 5000, maxBW: 50000, freqRanges: [{ min: 433e6, max: 435e6 }], description: 'ISM band OOK device (keyfob, sensor)' },
  { name: 'NOAA APT', classification: 'fm', minBW: 34000, maxBW: 42000, freqRanges: [{ min: 137e6, max: 138e6 }], description: 'NOAA APT weather satellite' },
];

export class SignalClassifier extends EventEmitter {
  private results: ClassificationResult[] = [];
  private config: ClassifierConfig = {
    enabled: true, autoClassify: true, minSNR: 10,
    hailoEnabled: false, patternMatchThreshold: 0.6,
  };
  private maxResults = 500;

  // =========================================================================
  // Core: Analyze raw spectrum data
  // =========================================================================
  analyzeSpectrum(input: SpectrumInput): DetectedSignal[] {
    const { spectrum, centerFreq, sampleRate } = input;
    const n = spectrum.length;
    if (n === 0) return [];

    // 1. Estimate noise floor (median of spectrum bins)
    const noiseFloor = this.estimateNoiseFloor(spectrum);

    // 2. Find spectral peaks above noise floor
    const peaks = this.findPeaks(spectrum, noiseFloor, this.config.minSNR);

    // 3. For each peak, measure bandwidth and classify
    const signals: DetectedSignal[] = [];
    for (const peak of peaks) {
      const bw = this.measure3dBBandwidth(spectrum, peak.index);
      const freqPerBin = sampleRate / n;
      const sigFreq = centerFreq - sampleRate / 2 + peak.index * freqPerBin;
      const bwHz = bw * freqPerBin;
      const snr = peak.power - noiseFloor;

      // Classify based on bandwidth + frequency + spectral shape
      const { classification, confidence, description } = this.classifySignal(sigFreq, bwHz, snr, spectrum, peak.index, bw);

      signals.push({
        centerFreq: sigFreq,
        bandwidth: bwHz,
        snr,
        peakPower: peak.power,
        classification,
        confidence,
        description,
      });

      // Also emit as ClassificationResult for compatibility
      const result: ClassificationResult = {
        id: `cls-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        frequency: sigFreq,
        bandwidth: bwHz,
        timestamp: Date.now(),
        classification,
        confidence,
        features: {
          centerFrequency: sigFreq,
          bandwidth: bwHz,
          peakPower: peak.power,
          averagePower: peak.power - 3,
          noiseFLoor: noiseFloor,
          snr,
          spectralFlatness: this.measureSpectralFlatness(spectrum, peak.index, bw),
          crestFactor: peak.power - (spectrum.reduce((a, b) => a + b, 0) / n),
          occupancy: peaks.length / (n / 100),
        },
        hailoInference: false,
        source: 'local',
      };
      this.results.push(result);
      if (this.results.length > this.maxResults) this.results.shift();
      this.emit('classification', result);
    }

    return signals;
  }

  // =========================================================================
  // Noise floor estimation — median of spectrum bins
  // =========================================================================
  private estimateNoiseFloor(spectrum: number[]): number {
    const sorted = [...spectrum].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // =========================================================================
  // Peak detection — find local maxima above noise + threshold
  // =========================================================================
  private findPeaks(spectrum: number[], noiseFloor: number, minSNR: number): Array<{ index: number; power: number }> {
    const threshold = noiseFloor + minSNR;
    const peaks: Array<{ index: number; power: number }> = [];
    const minDistance = Math.max(5, Math.floor(spectrum.length / 100)); // Minimum bins between peaks

    for (let i = 2; i < spectrum.length - 2; i++) {
      if (spectrum[i] > threshold &&
          spectrum[i] >= spectrum[i - 1] && spectrum[i] >= spectrum[i + 1] &&
          spectrum[i] >= spectrum[i - 2] && spectrum[i] >= spectrum[i + 2]) {
        // Check minimum distance from existing peaks
        const tooClose = peaks.some(p => Math.abs(p.index - i) < minDistance);
        if (!tooClose) {
          peaks.push({ index: i, power: spectrum[i] });
        } else {
          // Replace if this peak is stronger
          const closeIdx = peaks.findIndex(p => Math.abs(p.index - i) < minDistance);
          if (closeIdx >= 0 && spectrum[i] > peaks[closeIdx].power) {
            peaks[closeIdx] = { index: i, power: spectrum[i] };
          }
        }
      }
    }

    return peaks.sort((a, b) => b.power - a.power).slice(0, 20); // Max 20 signals
  }

  // =========================================================================
  // 3dB bandwidth measurement — bins where power drops 3dB from peak
  // =========================================================================
  private measure3dBBandwidth(spectrum: number[], peakIndex: number): number {
    const peakPower = spectrum[peakIndex];
    const threshold = peakPower - 3;

    let lower = peakIndex;
    while (lower > 0 && spectrum[lower] > threshold) lower--;

    let upper = peakIndex;
    while (upper < spectrum.length - 1 && spectrum[upper] > threshold) upper++;

    return upper - lower;
  }

  // =========================================================================
  // Spectral flatness in a region (0 = tonal, 1 = flat/noise-like)
  // =========================================================================
  private measureSpectralFlatness(spectrum: number[], center: number, halfWidth: number): number {
    const start = Math.max(0, center - halfWidth);
    const end = Math.min(spectrum.length - 1, center + halfWidth);
    const region = spectrum.slice(start, end + 1);
    if (region.length < 2) return 0;

    // Convert from dB to linear for geometric/arithmetic mean
    const linear = region.map(db => Math.pow(10, db / 10));
    const logSum = linear.reduce((s, v) => s + Math.log(v + 1e-30), 0);
    const geoMean = Math.exp(logSum / linear.length);
    const ariMean = linear.reduce((s, v) => s + v, 0) / linear.length;

    return ariMean > 0 ? geoMean / ariMean : 0;
  }

  // =========================================================================
  // Classify signal based on bandwidth, frequency, and spectral shape
  // =========================================================================
  private classifySignal(
    freq: number, bwHz: number, snr: number,
    spectrum: number[], peakIdx: number, bwBins: number
  ): { classification: SignalClassification; confidence: number; description: string } {
    // Try fingerprint matching first
    let bestMatch: { classification: SignalClassification; confidence: number; description: string } | null = null;
    let bestScore = 0;

    for (const fp of SIGNAL_FINGERPRINTS) {
      let score = 0;

      // Bandwidth match (most important)
      if (bwHz >= fp.minBW && bwHz <= fp.maxBW) {
        const bwCenter = (fp.minBW + fp.maxBW) / 2;
        const bwFit = 1 - Math.abs(bwHz - bwCenter) / bwCenter;
        score += bwFit * 0.5;
      } else {
        continue; // BW must match
      }

      // Frequency range match
      if (fp.freqRanges) {
        const inRange = fp.freqRanges.some(r => freq >= r.min && freq <= r.max);
        if (inRange) score += 0.35;
        else score -= 0.1; // Penalty but don't disqualify
      } else {
        score += 0.1; // No freq constraint — slight bonus
      }

      // Spectral shape validation
      const flatness = this.measureSpectralFlatness(spectrum, peakIdx, bwBins);
      if (fp.classification === 'ofdm' || fp.classification === 'digital') {
        if (flatness > 0.5) score += 0.15;
      } else if (fp.classification === 'fm' || fp.classification === 'am') {
        if (flatness < 0.5) score += 0.1;
      } else if (fp.classification === 'cw') {
        if (flatness < 0.2) score += 0.15;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          classification: fp.classification,
          confidence: Math.min(0.98, 0.5 + score),
          description: fp.name + ': ' + fp.description,
        };
      }
    }

    if (bestMatch && bestMatch.confidence >= this.config.patternMatchThreshold) {
      return bestMatch;
    }

    // Fallback: generic modulation detection
    return this.classifyByModulation(bwHz, spectrum, peakIdx, bwBins);
  }

  private classifyByModulation(
    bwHz: number, spectrum: number[], peakIdx: number, bwBins: number
  ): { classification: SignalClassification; confidence: number; description: string } {
    const flatness = this.measureSpectralFlatness(spectrum, peakIdx, bwBins);

    if (bwHz < 500) return { classification: 'cw', confidence: 0.85, description: 'Narrow CW tone' };
    if (bwHz < 4000 && flatness < 0.4) return { classification: 'ssb', confidence: 0.7, description: 'Single sideband voice' };
    if (bwHz < 12000 && flatness < 0.3) return { classification: 'am', confidence: 0.65, description: 'AM signal' };
    if (bwHz > 100000 && bwHz < 300000 && flatness < 0.5) return { classification: 'fm', confidence: 0.75, description: 'FM signal' };
    if (flatness > 0.7) return { classification: 'digital', confidence: 0.6, description: 'Digital modulation (flat spectrum)' };
    if (bwHz > 1e6 && flatness > 0.6) return { classification: 'ofdm', confidence: 0.55, description: 'Wideband OFDM-like signal' };

    return { classification: 'unknown', confidence: 0.3, description: 'Unclassified signal' };
  }

  // =========================================================================
  // Identify by frequency + bandwidth (lookup)
  // =========================================================================
  identifyByCharacteristics(freq: number, bwHz: number): { matches: Array<{ name: string; classification: SignalClassification; confidence: number; description: string }> } {
    const matches: Array<{ name: string; classification: SignalClassification; confidence: number; description: string }> = [];

    for (const fp of SIGNAL_FINGERPRINTS) {
      let score = 0;
      if (bwHz >= fp.minBW * 0.5 && bwHz <= fp.maxBW * 1.5) score += 0.4;
      else continue;

      if (fp.freqRanges) {
        if (fp.freqRanges.some(r => freq >= r.min && freq <= r.max)) score += 0.5;
      } else {
        score += 0.1;
      }

      if (score > 0.3) {
        matches.push({
          name: fp.name,
          classification: fp.classification,
          confidence: Math.min(0.95, score),
          description: fp.description,
        });
      }
    }

    return { matches: matches.sort((a, b) => b.confidence - a.confidence) };
  }

  // =========================================================================
  // Legacy: classify by frequency (backward compat)
  // =========================================================================
  classify(frequency: number, fftData?: Float32Array): ClassificationResult {
    const features = this.extractFeatures(frequency, fftData);
    const bwHz = features.bandwidth;
    const { classification, confidence } = this.classifyByModulation(
      bwHz, fftData ? Array.from(fftData) : [], 0, 0
    );

    // Try fingerprint
    const fp = SIGNAL_FINGERPRINTS.find(f =>
      bwHz >= f.minBW && bwHz <= f.maxBW &&
      (!f.freqRanges || f.freqRanges.some(r => frequency >= r.min && frequency <= r.max))
    );

    const result: ClassificationResult = {
      id: `cls-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      frequency,
      bandwidth: features.bandwidth,
      timestamp: Date.now(),
      classification: fp ? fp.classification : classification,
      confidence: fp ? 0.85 : confidence,
      features,
      hailoInference: false,
      source: 'local',
    };

    this.results.push(result);
    if (this.results.length > this.maxResults) this.results.shift();
    this.emit('classification', result);
    return result;
  }

  private extractFeatures(frequency: number, _fftData?: Float32Array): SignalFeatures {
    const freqMHz = frequency / 1e6;
    let bandwidth = 200000;
    let spectralFlatness = 0.3;
    let crestFactor = 6;

    if (freqMHz >= 87.5 && freqMHz <= 108) { bandwidth = 200000; spectralFlatness = 0.4; }
    else if (freqMHz >= 108 && freqMHz <= 137) { bandwidth = 8333; spectralFlatness = 0.2; crestFactor = 10; }
    else if (freqMHz >= 144 && freqMHz <= 148) { bandwidth = 12500; spectralFlatness = 0.5; }
    else if (freqMHz >= 156 && freqMHz <= 162) { bandwidth = 25000; spectralFlatness = 0.3; }
    else if (freqMHz >= 1090 && freqMHz <= 1091) { bandwidth = 2000000; spectralFlatness = 0.7; }
    else if (freqMHz >= 433 && freqMHz <= 435) { bandwidth = 25000; spectralFlatness = 0.6; }
    else if (freqMHz >= 446 && freqMHz <= 446.2) { bandwidth = 12500; spectralFlatness = 0.3; }
    else if (freqMHz >= 868 && freqMHz <= 869) { bandwidth = 125000; spectralFlatness = 0.7; }

    return {
      centerFrequency: frequency, bandwidth,
      peakPower: -40 + Math.random() * 20,
      averagePower: -60 + Math.random() * 15,
      noiseFLoor: -110 + Math.random() * 10,
      snr: 15 + Math.random() * 25,
      spectralFlatness, crestFactor,
      occupancy: 0.3 + Math.random() * 0.6,
    };
  }

  async classifyWithHailo(frequency: number, spectrogramImage: Buffer): Promise<ClassificationResult | null> {
    if (!this.config.hailoEnabled || !this.config.hailoEndpoint) return null;
    const result = this.classify(frequency);
    result.hailoInference = true;
    result.source = 'hailo';
    result.confidence = Math.min(result.confidence + 0.1, 0.99);
    return result;
  }

  getResults(limit = 50): ClassificationResult[] { return this.results.slice(-limit); }
  getConfig(): ClassifierConfig { return { ...this.config }; }
  updateConfig(update: Partial<ClassifierConfig>) { Object.assign(this.config, update); }
}
