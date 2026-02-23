// ============================================================================
// SignalForge SDR Types
// ============================================================================

export type SDRType = 'rtlsdr' | 'airspy' | 'hackrf' | 'usrp' | 'limesdr' | 'file' | 'demo';

export interface SDRDeviceInfo {
  id: string;
  name: string;
  type: SDRType;
  serial?: string;
  available: boolean;
  sampleRates: number[];
  frequencyRange: { min: number; max: number };
  gainRange: { min: number; max: number };
}

export interface SDRConfig {
  deviceId: string;
  centerFrequency: number;
  sampleRate: number;
  gain: number;
  bandwidth?: number;
  ppm?: number;       // frequency correction
  agc?: boolean;
}

export interface IQFrame {
  sequence: number;
  sampleRate: number;
  centerFrequency: number;
  timestamp: number;
  samples: Float32Array;  // interleaved I/Q
}

export interface FFTResult {
  centerFrequency: number;
  sampleRate: number;
  binCount: number;
  magnitudes: Float32Array;  // dB values
  timestamp: number;
}

// WebSocket message types
export type SDRMessage =
  | { type: 'devices'; devices: SDRDeviceInfo[] }
  | { type: 'iq_frame'; frame: IQFrame }
  | { type: 'status'; deviceId: string; streaming: boolean }
  | { type: 'error'; message: string };

export type SDRCommand =
  | { type: 'list_devices' }
  | { type: 'start'; config: SDRConfig }
  | { type: 'stop'; deviceId: string }
  | { type: 'configure'; deviceId: string; changes: Partial<SDRConfig> };
