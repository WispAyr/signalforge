// DX Cluster / Spots Integration Types

export interface DXSpot {
  id: string;
  spotter: string;
  spotterGrid?: string;
  spotted: string;
  spottedGrid?: string;
  frequency: number;
  mode?: string;
  comment: string;
  timestamp: number;
  // Great circle path
  path?: { lat: number; lng: number }[];
  distance?: number; // km
  bearing?: number;
  // Entity info
  dxcc?: number;
  entity?: string;
  continent?: string;
  cqZone?: number;
  ituZone?: number;
  isRare?: boolean;
}

export interface DXClusterConfig {
  connected: boolean;
  host: string;
  port: number;
  callsign: string;
  filters: DXFilter[];
}

export interface DXFilter {
  id: string;
  type: 'band' | 'mode' | 'entity' | 'continent' | 'callsign';
  value: string;
  enabled: boolean;
}

export interface DXSpotAlert {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    entities?: string[];
    callsignPatterns?: string[];
    bands?: string[];
    modes?: string[];
    continents?: string[];
  };
  sound: boolean;
  notification: boolean;
  autoTune: boolean;
}
