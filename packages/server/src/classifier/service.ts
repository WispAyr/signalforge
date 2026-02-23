// ============================================================================
// SignalForge Signal Classifier
// ============================================================================
import { EventEmitter } from 'events';
import type { ClassificationResult, SignalFeatures, SignalClassification, ClassifierConfig } from '@signalforge/shared';

export class SignalClassifier extends EventEmitter {
  private results: ClassificationResult[] = [];
  private config: ClassifierConfig = {
    enabled: true, autoClassify: true, minSNR: 10,
    hailoEnabled: false, patternMatchThreshold: 0.6,
  };
  private maxResults = 500;

  classify(frequency: number, fftData?: Float32Array): ClassificationResult {
    // Generate synthetic features for demo
    const features = this.extractFeatures(frequency, fftData);
    const classification = this.matchPattern(features);

    const result: ClassificationResult = {
      id: `cls-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      frequency,
      bandwidth: features.bandwidth,
      timestamp: Date.now(),
      classification: classification.type,
      confidence: classification.confidence,
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
    // Simulated feature extraction
    const freqMHz = frequency / 1e6;
    let bandwidth = 200000;
    let spectralFlatness = 0.3;
    let crestFactor = 6;

    // Heuristics based on frequency
    if (freqMHz >= 87.5 && freqMHz <= 108) { bandwidth = 200000; spectralFlatness = 0.4; }
    else if (freqMHz >= 108 && freqMHz <= 137) { bandwidth = 8333; spectralFlatness = 0.2; crestFactor = 10; }
    else if (freqMHz >= 144 && freqMHz <= 148) { bandwidth = 12500; spectralFlatness = 0.5; }
    else if (freqMHz >= 156 && freqMHz <= 162) { bandwidth = 25000; spectralFlatness = 0.3; }
    else if (freqMHz >= 1090 && freqMHz <= 1091) { bandwidth = 2000000; spectralFlatness = 0.7; }

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

  private matchPattern(features: SignalFeatures): { type: SignalClassification; confidence: number } {
    const { bandwidth, spectralFlatness, crestFactor } = features;

    if (bandwidth > 150000 && bandwidth < 250000 && spectralFlatness < 0.6) return { type: 'fm', confidence: 0.85 + Math.random() * 0.1 };
    if (bandwidth < 12000 && spectralFlatness < 0.3) return { type: 'am', confidence: 0.8 + Math.random() * 0.1 };
    if (bandwidth < 1000) return { type: 'cw', confidence: 0.9 + Math.random() * 0.05 };
    if (bandwidth < 4000 && spectralFlatness < 0.4) return { type: 'ssb', confidence: 0.75 + Math.random() * 0.1 };
    if (spectralFlatness > 0.7) return { type: 'digital', confidence: 0.7 + Math.random() * 0.15 };
    if (crestFactor > 12) return { type: 'pulsed', confidence: 0.65 + Math.random() * 0.15 };
    if (spectralFlatness > 0.9) return { type: 'noise', confidence: 0.6 + Math.random() * 0.15 };

    return { type: 'unknown', confidence: 0.3 + Math.random() * 0.2 };
  }

  // Hailo-8 inference stub
  async classifyWithHailo(frequency: number, spectrogramImage: Buffer): Promise<ClassificationResult | null> {
    if (!this.config.hailoEnabled || !this.config.hailoEndpoint) return null;
    // Stub — would POST spectrogram to Hailo inference endpoint
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
