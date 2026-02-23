// SatNOGS Network Integration Types

export interface SatNOGSObservation {
  id: number;
  start: string;
  end: string;
  ground_station: number;
  transmitter: string;
  norad_cat_id: number;
  satellite_name: string;
  status: 'future' | 'good' | 'bad' | 'failed' | 'unknown';
  waterfall?: string;
  demoddata?: string[];
  station_name: string;
  station_lat: number;
  station_lng: number;
  station_alt: number;
}

export interface SatNOGSTransmitter {
  uuid: string;
  description: string;
  alive: boolean;
  type: 'Transmitter' | 'Transceiver' | 'Transponder';
  uplink_low?: number;
  uplink_high?: number;
  uplink_drift?: number;
  downlink_low?: number;
  downlink_high?: number;
  downlink_drift?: number;
  mode?: string;
  mode_id?: number;
  baud?: number;
  norad_cat_id: number;
  status: 'active' | 'inactive' | 'invalid';
  service: string;
}

export interface SatNOGSStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
  alt: number;
  status: 'Online' | 'Testing' | 'Offline';
  observations: number;
  description: string;
  client_version: string;
}

export interface SatNOGSFlowgraphConfig {
  satelliteName: string;
  noradId: number;
  transmitters: SatNOGSTransmitter[];
  selectedTransmitter?: string; // uuid
  flowgraphPreset: string;
  frequency: number;
  mode: string;
  bandwidth: number;
  baud?: number;
}
