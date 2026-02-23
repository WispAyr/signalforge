// Phase 8: Signal History / Time Machine types

export interface SignalHistoryEntry {
  id: string;
  frequencyHz: number;
  mode?: string;
  signalStrengthDbm: number;
  bandwidth?: number;
  decoderType?: string;
  decodedData?: string;
  timestamp: number;
  source: string; // edge node or local
}

export interface HistoryQuery {
  frequencyHz?: number;
  frequencyRangeHz?: [number, number];
  startTime: number;
  endTime: number;
  mode?: string;
  decoderType?: string;
  limit?: number;
  offset?: number;
}

export interface HistoryConfig {
  enabled: boolean;
  retentionDays: number;
  recordSignals: boolean;
  recordDecodes: boolean;
  recordEvents: boolean;
  maxStorageMb: number;
}

export interface HistoryStats {
  totalEntries: number;
  oldestEntry: number;
  newestEntry: number;
  storageSizeMb: number;
  entriesByDecoder: Record<string, number>;
}
