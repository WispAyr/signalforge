// WiFi Scanner Types

export interface WiFiAP {
  bssid: string;
  ssid: string;
  channel: number;
  frequency: number;
  signalStrength: number;
  encryption: WiFiEncryption;
  manufacturer?: string;
  firstSeen: number;
  lastSeen: number;
  clients: WiFiClient[];
  beaconCount: number;
  dataFrames: number;
  latitude?: number;
  longitude?: number;
}

export type WiFiEncryption = 'OPEN' | 'WEP' | 'WPA' | 'WPA2' | 'WPA3' | 'WPA2-Enterprise' | 'Unknown';

export interface WiFiClient {
  mac: string;
  signalStrength: number;
  firstSeen: number;
  lastSeen: number;
  dataFrames: number;
  manufacturer?: string;
  probeRequests: string[];
}

export interface WiFiDeauthEvent {
  id: string;
  timestamp: number;
  sourceMac: string;
  targetMac: string;
  bssid: string;
  reason: number;
  count: number;
}

export interface WiFiChannelUtil {
  channel: number;
  frequency: number;
  utilization: number;
  apCount: number;
  noiseFloor: number;
}

export interface WiFiConfig {
  enabled: boolean;
  interface: string;
  channelHop: boolean;
  hopInterval: number;
  channels: number[];
  monitorDeauth: boolean;
}

export interface WiFiStatus {
  scanning: boolean;
  interface: string;
  monitorMode: boolean;
  apCount: number;
  clientCount: number;
  deauthEvents: number;
  config: WiFiConfig;
}
