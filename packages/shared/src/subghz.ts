// Sub-GHz Analyzer Types

export interface SubGHzSignal {
  id: string;
  timestamp: number;
  frequency: number;
  bandwidth: number;
  power: number;
  protocol?: string;
  deviceType?: SubGHzDeviceType;
  modulation?: string;
  bitrate?: number;
  raw?: Uint8Array;
  isReplay: boolean;
  replayCount: number;
}

export type SubGHzDeviceType = 'garage_door' | 'keyfob' | 'weather_station' | 'doorbell' | 'tire_sensor' | 'remote_control' | 'unknown';

export interface SubGHzSweepResult {
  timestamp: number;
  startFreq: number;
  endFreq: number;
  stepSize: number;
  powers: number[];
  peakFrequency: number;
  peakPower: number;
}

export interface SubGHzProtocolMatch {
  protocol: string;
  confidence: number;
  frequency: number;
  modulation: string;
  deviceType: SubGHzDeviceType;
  description: string;
}

export interface HackRFConfig {
  enabled: boolean;
  mode: 'sweep' | 'transfer';
  startFreq: number;
  endFreq: number;
  lnaGain: number;
  vgaGain: number;
  sampleRate: number;
}

export interface SubGHzStatus {
  connected: boolean;
  sweeping: boolean;
  signalsDetected: number;
  protocolsIdentified: number;
  replayAttemptsDetected: number;
  config: HackRFConfig;
}
