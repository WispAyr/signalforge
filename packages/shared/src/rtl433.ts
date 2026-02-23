// rtl_433 IoT Sensor Decoder Types

export interface ISMDevice {
  id: string;
  protocol: string;
  model: string;
  deviceType: ISMDeviceType;
  deviceId: number;
  channel?: number;
  firstSeen: number;
  lastSeen: number;
  readings: ISMReading[];
  lastReading: ISMReading | null;
  rssi?: number;
}

export type ISMDeviceType = 'weather_station' | 'tpms' | 'doorbell' | 'smoke_detector' | 'soil_moisture' | 'pool_thermometer' | 'power_meter' | 'unknown';

export interface ISMReading {
  timestamp: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  windSpeed?: number;
  windDirection?: number;
  rainfall?: number;
  battery?: string;
  tirePressure?: number;
  tireTemperature?: number;
  moisture?: number;
  uv?: number;
  raw: Record<string, unknown>;
}

export interface RTL433Config {
  enabled: boolean;
  source: 'tcp' | 'pipe';
  host: string;
  port: number;
  protocols: number[];
  hopInterval: number;
}

export interface RTL433Status {
  connected: boolean;
  devicesDiscovered: number;
  messagesReceived: number;
  lastMessage: number;
  config: RTL433Config;
}
