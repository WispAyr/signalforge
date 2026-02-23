// ============================================================================
// SignalForge SDR Types
// ============================================================================

export type SDRType = 'rtlsdr' | 'airspy' | 'hackrf' | 'usrp' | 'limesdr' | 'soapy' | 'file' | 'demo';

export interface SDRDeviceInfo {
  id: string;
  name: string;
  type: SDRType;
  serial?: string;
  available: boolean;
  sampleRates: number[];
  frequencyRange: { min: number; max: number };
  gainRange: { min: number; max: number };
  remote?: boolean;
  host?: string;
  port?: number;
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

// RTL-TCP connection
export interface RtlTcpConnection {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  deviceInfo?: {
    tunerType: string;
    gainCount: number;
  };
  config: SDRConfig;
}

// SoapySDR connection
export interface SoapyConnection {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  driver?: string;
  channels: number;
  antennas: string[];
  gains: Record<string, { min: number; max: number }>;
  sampleRates: number[];
  frequencyRange: { min: number; max: number };
}

// Rotator types
export interface RotatorState {
  connected: boolean;
  host?: string;
  port?: number;
  azimuth: number;
  elevation: number;
  targetAzimuth?: number;
  targetElevation?: number;
  moving: boolean;
  model?: string;
}

export interface RotatorCommand {
  type: 'set_position' | 'stop' | 'park';
  azimuth?: number;
  elevation?: number;
}

// Observation scheduler
export interface Observation {
  id: string;
  name: string;
  satelliteCatalogNumber?: number;
  satelliteName?: string;
  frequency: number;
  mode: string;
  minElevation: number;
  autoRecord: boolean;
  autoDoppler: boolean;
  autoRotator: boolean;
  status: 'scheduled' | 'active' | 'completed' | 'missed' | 'cancelled';
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  recordingPath?: string;
  notes?: string;
  created: string;
}

export interface ObservationScheduleConfig {
  satelliteCatalogNumber: number;
  satelliteName: string;
  frequency: number;
  mode: string;
  minElevation: number;
  autoRecord: boolean;
  autoDoppler: boolean;
  autoRotator: boolean;
  maxObservations?: number;
  notes?: string;
}

// Spectrum analyzer
export interface SpectrumSweepConfig {
  startFrequency: number;
  endFrequency: number;
  stepSize: number;
  dwellTime: number;    // ms per step
  rbw: number;          // resolution bandwidth
  fftSize: number;
}

export interface SpectrumSweepResult {
  frequencies: Float32Array;
  powers: Float32Array;
  maxHold: Float32Array;
  timestamp: number;
  sweepCount: number;
}

export interface DetectedSignal {
  frequency: number;
  power: number;
  bandwidth: number;
  classification?: string;
  confidence?: number;
  timestamp: number;
}

// MQTT types
export interface MqttConfig {
  broker: string;
  port: number;
  clientId?: string;
  username?: string;
  password?: string;
  topics: MqttTopicConfig[];
  connected: boolean;
}

export interface MqttTopicConfig {
  topic: string;
  direction: 'publish' | 'subscribe';
  format: 'json' | 'raw' | 'csv';
  qos: 0 | 1 | 2;
}

export interface MqttMessage {
  topic: string;
  payload: string;
  timestamp: number;
  direction: 'in' | 'out';
}

// Doppler correction
export interface DopplerCorrection {
  satelliteName: string;
  nominalFrequency: number;
  correctedFrequency: number;
  dopplerShift: number;
  rangeRate: number;  // km/s
  timestamp: number;
}

// WebSocket message types
export type SDRMessage =
  | { type: 'devices'; devices: SDRDeviceInfo[] }
  | { type: 'iq_frame'; frame: IQFrame }
  | { type: 'iq_data'; data: ArrayBuffer }
  | { type: 'status'; deviceId: string; streaming: boolean }
  | { type: 'sdr_connected'; connection: RtlTcpConnection }
  | { type: 'sdr_disconnected'; id: string }
  | { type: 'soapy_connected'; connection: SoapyConnection }
  | { type: 'rotator_state'; state: RotatorState }
  | { type: 'doppler'; correction: DopplerCorrection }
  | { type: 'spectrum_sweep'; result: SpectrumSweepResult }
  | { type: 'detected_signals'; signals: DetectedSignal[] }
  | { type: 'observation_update'; observation: Observation }
  | { type: 'mqtt_message'; message: MqttMessage }
  | { type: 'error'; message: string };

export type SDRCommand =
  | { type: 'list_devices' }
  | { type: 'start'; config: SDRConfig }
  | { type: 'stop'; deviceId: string }
  | { type: 'configure'; deviceId: string; changes: Partial<SDRConfig> }
  | { type: 'connect_rtltcp'; host: string; port: number }
  | { type: 'disconnect_rtltcp'; id: string }
  | { type: 'connect_soapy'; host: string; port: number; driver?: string }
  | { type: 'set_frequency'; frequency: number }
  | { type: 'set_gain'; gain: number }
  | { type: 'set_sample_rate'; sampleRate: number }
  | { type: 'set_agc'; enabled: boolean }
  | { type: 'start_sweep'; config: SpectrumSweepConfig }
  | { type: 'stop_sweep' }
  | { type: 'rotator_command'; command: RotatorCommand }
  | { type: 'subscribe'; channels: string[] };
