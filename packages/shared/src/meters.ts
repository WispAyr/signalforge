// Utility Meter Reading Types

export type MeterType = 'electric' | 'gas' | 'water';

export interface MeterDevice {
  id: string;
  meterId: string;
  type: MeterType;
  protocol: string;
  manufacturer?: string;
  firstSeen: number;
  lastSeen: number;
  readings: MeterReading[];
  lastReading: MeterReading | null;
}

export interface MeterReading {
  timestamp: number;
  consumption: number;
  unit: string;
  rate?: number;
  temperature?: number;
  rssi?: number;
  raw: Record<string, unknown>;
}

export interface MeterConfig {
  enabled: boolean;
  source: 'rtl_433' | 'rtl_amr';
  host: string;
  port: number;
  meterIds: string[];
}

export interface MeterStats {
  totalMeters: number;
  readingsToday: number;
  byType: Record<MeterType, number>;
}
