// ============================================================================
// SignalForge Edge Node Types
// ============================================================================

export interface EdgeNode {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  connectedAt: number;
  lastHeartbeat: number;
  status: 'online' | 'offline' | 'degraded';
  location?: {
    latitude: number;
    longitude: number;
    altitude: number;
    source: 'gps' | 'manual' | 'ip';
  };
  sdrDevices: EdgeSDRDevice[];
  capabilities: string[];
  system: {
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCores: number;
    memoryTotal: number;
    memoryFree: number;
    uptime: number;
    loadAvg: number[];
    temperature?: number;
  };
  hasGPS: boolean;
  hasHailo?: boolean;
  version: string;
}

export interface EdgeSDRDevice {
  id: string;
  type: 'rtlsdr' | 'soapy' | 'hackrf' | 'limesdr' | 'airspy';
  name: string;
  serial?: string;
  available: boolean;
  currentFrequency?: number;
  sampleRate?: number;
}

export interface EdgeHeartbeat {
  nodeId: string;
  timestamp: number;
  system: EdgeNode['system'];
  sdrDevices: EdgeSDRDevice[];
  location?: EdgeNode['location'];
}

export interface EdgeCommand {
  id: string;
  type: 'tune' | 'start_stream' | 'stop_stream' | 'set_gain' | 'set_sample_rate' | 'scan' | 'classify';
  params: Record<string, unknown>;
  timestamp: number;
}

export interface EdgeIQData {
  nodeId: string;
  deviceId: string;
  frequency: number;
  sampleRate: number;
  timestamp: number;
  samples: Float32Array;
}
