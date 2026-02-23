// VDL2 Decoder Types

export interface VDL2Message {
  id: string;
  timestamp: number;
  frequency: number;
  icao?: string;
  registration?: string;
  callsign?: string;
  flightNumber?: string;
  aircraftType?: string;
  messageType: VDL2MessageType;
  avlcType?: string;
  groundStation?: string;
  dstAddress?: string;
  srcAddress?: string;
  acarsLabel?: string;
  acarsBlkId?: string;
  acarsText?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  squawk?: string;
  rssi?: number;
  bitsCorreected?: number;
  raw?: string;
}

export type VDL2MessageType = 'ACARS' | 'ADS-C' | 'CPDLC' | 'CM' | 'UNKNOWN';

export interface VDL2Config {
  enabled: boolean;
  source?: string;
  host?: string;
  port?: number;
  frequency?: number;
  frequencies?: number[];
  correctionPpm?: number;
  groundStations?: string[];
  logAll?: boolean;
  acarsOnly?: boolean;
}

export interface VDL2Status {
  connected: boolean;
  messagesDecoded: number;
  uniqueAircraft: number;
  acarsMessages: number;
  lastMessage: number | null;
  config: VDL2Config;
}

export const VDL2_FREQUENCIES = [
  136.650e6, 136.700e6, 136.725e6, 136.750e6,
  136.775e6, 136.800e6, 136.825e6, 136.850e6,
  136.875e6, 136.900e6, 136.925e6, 136.950e6,
  136.975e6,
];
