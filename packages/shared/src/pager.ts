// POCSAG/FLEX Pager Decoder Types (Enhanced)

export type PagerProtocol = 'POCSAG' | 'FLEX';

export interface PagerMessage {
  id: string;
  protocol: PagerProtocol;
  timestamp: number;
  capcode: number;
  address: number;
  function: number;
  messageType: 'numeric' | 'alpha' | 'tone' | 'unknown';
  content: string;
  baudRate: number;
  rssi?: number;
  frequency?: number;
  phase?: string;
  frameNo?: number;
}

export interface PagerFilter {
  id: string;
  name: string;
  capcodes: number[];
  keywords: string[];
  alertEnabled: boolean;
  color: string;
}

export interface PagerAlert {
  id: string;
  filterId: string;
  filterName: string;
  message: PagerMessage;
  timestamp: number;
  acknowledged: boolean;
}

export interface PagerConfig {
  enabled: boolean;
  source: 'multimon-ng' | 'tcp';
  host: string;
  port: number;
  pocsagEnabled: boolean;
  flexEnabled: boolean;
  baudRates: number[];
}

export interface PagerStats {
  totalMessages: number;
  pocsagMessages: number;
  flexMessages: number;
  uniqueCapcodes: number;
  messagesPerHour: number;
}
