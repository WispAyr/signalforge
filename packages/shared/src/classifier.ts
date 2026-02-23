// ============================================================================
// SignalForge Signal Classifier Types
// ============================================================================

export type SignalClassification = 'fm' | 'am' | 'digital' | 'pulsed' | 'cw' | 'noise' | 'ssb' | 'fsk' | 'psk' | 'ofdm' | 'unknown';

export interface ClassificationResult {
  id: string;
  frequency: number;
  bandwidth: number;
  timestamp: number;
  classification: SignalClassification;
  confidence: number; // 0-1
  features: SignalFeatures;
  spectrogramPattern?: string;
  hailoInference?: boolean;
  source: 'local' | 'edge' | 'hailo';
}

export interface SignalFeatures {
  centerFrequency: number;
  bandwidth: number;
  peakPower: number;
  averagePower: number;
  noiseFLoor: number;
  snr: number;
  modulationIndex?: number;
  symbolRate?: number;
  dutyCycle?: number;
  pulseWidth?: number;
  pulseRepetitionRate?: number;
  harmonics?: number[];
  spectralFlatness: number;
  crestFactor: number;
  occupancy: number; // % of time signal is present
}

export interface ClassifierConfig {
  enabled: boolean;
  autoClassify: boolean;
  minSNR: number;
  hailoEnabled: boolean;
  hailoEndpoint?: string;
  patternMatchThreshold: number;
}

export const SIGNAL_PATTERNS: Record<SignalClassification, { description: string; features: Partial<SignalFeatures> }> = {
  fm: { description: 'Frequency Modulation — smooth spectral occupancy, ~200kHz BW for broadcast', features: { bandwidth: 200000 } },
  am: { description: 'Amplitude Modulation — carrier + sidebands, narrow BW', features: { bandwidth: 10000 } },
  digital: { description: 'Digital modulation — flat-topped spectrum, sharp edges', features: { spectralFlatness: 0.8 } },
  pulsed: { description: 'Pulsed signal — radar, DME, etc.', features: { dutyCycle: 0.1 } },
  cw: { description: 'Continuous Wave — Morse code, single tone', features: { bandwidth: 500 } },
  noise: { description: 'Broadband noise or interference', features: { spectralFlatness: 0.95 } },
  ssb: { description: 'Single Sideband — voice, ~3kHz BW', features: { bandwidth: 3000 } },
  fsk: { description: 'Frequency Shift Keying — two or more tones', features: {} },
  psk: { description: 'Phase Shift Keying — BPSK, QPSK, etc.', features: {} },
  ofdm: { description: 'Orthogonal Frequency Division Multiplexing — many subcarriers', features: { spectralFlatness: 0.85 } },
  unknown: { description: 'Unclassified signal', features: {} },
};
