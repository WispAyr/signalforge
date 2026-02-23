// Meshtastic Integration Types

export interface MeshNode {
  id: string;
  longName: string;
  shortName: string;
  macAddr: string;
  hwModel: string;
  role: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  batteryLevel?: number;
  voltage?: number;
  snr?: number;
  lastHeard: number;
  hopsAway: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  airQuality?: number;
}

export interface MeshMessage {
  id: string;
  timestamp: number;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  channel: number;
  text: string;
  hopLimit: number;
  rxSnr: number;
  rxRssi: number;
}

export interface MeshTelemetry {
  nodeId: string;
  timestamp: number;
  batteryLevel: number;
  voltage: number;
  channelUtilization: number;
  airUtilTx: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
}

export interface MeshtasticConfig {
  enabled: boolean;
  connectionType: 'serial' | 'tcp';
  host: string;
  port: number;
  serialPort: string;
  baudRate: number;
}

export interface MeshtasticStatus {
  connected: boolean;
  myNodeId: string;
  nodeCount: number;
  messagesReceived: number;
  config: MeshtasticConfig;
}
