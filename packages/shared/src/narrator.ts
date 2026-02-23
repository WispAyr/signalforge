// Phase 8: AI Signal Narrator types

export interface NarrationRequest {
  frequencyHz: number;
  mode?: string;
  bandwidth?: number;
  signalStrengthDbm?: number;
  classifierResult?: string;
  decoderOutput?: string;
  location?: { lat: number; lon: number };
}

export interface Narration {
  id: string;
  frequencyHz: number;
  text: string;
  timestamp: number;
  confidence: number;
  tags: string[];
  isAnomaly: boolean;
}

export interface NarratorConfig {
  enabled: boolean;
  autoNarrate: boolean;
  autoNarrateIntervalMs: number;
  anomalyThreshold: number;
  maxNarrations: number;
}
