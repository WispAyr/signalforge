// Bluetooth Scanner Types

export type BTDeviceType = 'classic' | 'ble' | 'dual';
export type TrackerType = 'airtag' | 'tile' | 'smarttag' | 'chipolo' | 'unknown' | 'none';

export interface BTDevice {
  id: string;
  mac: string;
  name?: string;
  type: BTDeviceType;
  rssi: number;
  txPower?: number;
  manufacturer?: string;
  trackerType: TrackerType;
  services: string[];
  firstSeen: number;
  lastSeen: number;
  seenCount: number;
  latitude?: number;
  longitude?: number;
  signalTrail: BTSignalPoint[];
  isTarget: boolean;
}

export interface BTSignalPoint {
  timestamp: number;
  rssi: number;
  latitude?: number;
  longitude?: number;
}

export interface BTProximityAlert {
  id: string;
  deviceId: string;
  deviceName: string;
  trackerType: TrackerType;
  rssi: number;
  timestamp: number;
  acknowledged: boolean;
}

export interface BTConfig {
  enabled: boolean;
  interface: string;
  ubertoothEnabled: boolean;
  scanInterval: number;
  trackerDetection: boolean;
  proximityThreshold: number;
  locateMode: boolean;
  targetDevices: string[];
}

export interface BTStatus {
  scanning: boolean;
  deviceCount: number;
  trackerCount: number;
  ubertoothConnected: boolean;
  locateActive: boolean;
  config: BTConfig;
}
