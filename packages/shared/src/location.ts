// ============================================================================
// SignalForge Observer Location Types
// ============================================================================

export type LocationSource = 'manual' | 'browser' | 'gps' | 'starlink' | 'auto';

export interface ObserverLocation {
  latitude: number;
  longitude: number;
  altitude: number;       // meters above sea level
  name?: string;           // human-readable place name
  source: LocationSource;
  accuracy?: number;       // meters
  lastUpdated: string;     // ISO timestamp
}

export interface GPSConfig {
  enabled: boolean;
  type: 'serial' | 'gpsd' | 'none';
  serialPort?: string;     // e.g. /dev/ttyUSB0, /dev/tty.usbserial
  serialBaud?: number;
  gpsdHost?: string;       // default 127.0.0.1
  gpsdPort?: number;       // default 2947
}

export interface StarlinkConfig {
  enabled: boolean;
  host: string;            // default 192.168.100.1
  pollIntervalMs: number;  // default 30000
}

export interface LocationSettings {
  observer: ObserverLocation;
  source: LocationSource;  // active source
  gps: GPSConfig;
  starlink: StarlinkConfig;
}

export const DEFAULT_LOCATION: ObserverLocation = {
  latitude: 55.4583,
  longitude: -4.6298,
  altitude: 20,
  name: 'Ayr, Scotland',
  source: 'manual',
  lastUpdated: new Date().toISOString(),
};

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = {
  observer: { ...DEFAULT_LOCATION },
  source: 'manual',
  gps: { enabled: false, type: 'none' },
  starlink: { enabled: false, host: '192.168.100.1', pollIntervalMs: 30000 },
};
