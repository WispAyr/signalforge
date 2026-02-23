// Aaronia Spectran V6 Series — Shared Types

export interface AaroniaDeviceInfo {
  id: string;
  host: string;
  port: number;
  model: string;
  serial?: string;
  firmwareVersion?: string;
  connected: boolean;
  lastSeen: number;
}

export interface AaroniaSweepConfig {
  startFrequency: number;
  stopFrequency: number;
  rbw: number;
  span?: number;
  referenceLevel?: number;
  attenuator?: number;
  detector?: 'peak' | 'rms' | 'average' | 'sample';
  sweepMode?: 'single' | 'continuous';
  profile?: 'tscm' | 'emc' | 'general' | 'nearfield';
}

export interface AaroniaSweepResult {
  id: string;
  timestamp: number;
  startFrequency: number;
  stopFrequency: number;
  rbw: number;
  referenceLevel: number;
  detector: string;
  samples: number[];
  peakFrequency: number;
  peakPower: number;
  noiseFloor: number;
  sweepTime: number;
}

export interface AaroniaModel {
  id: string;
  name: string;
  manufacturer: string;
  frequencyRange: [number, number];
  maxRTBW: number;
  adcBits: number;
  price: string;
  features: string[];
}

export interface AaroniaStatus {
  device: AaroniaDeviceInfo | null;
  sweeping: boolean;
  streaming: boolean;
  currentConfig: AaroniaSweepConfig | null;
  sweepCount: number;
  lastSweep: AaroniaSweepResult | null;
}
