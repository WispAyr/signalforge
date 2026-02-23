// ============================================================================
// SignalForge Telemetry Dashboard Types
// ============================================================================

export interface TelemetryFrame {
  id: string;
  satelliteName: string;
  noradId: number;
  timestamp: number;
  protocol: 'ccsds' | 'csp' | 'ax25' | 'custom';
  rawHex: string;
  parsed: TelemetryValue[];
  source: string;
}

export interface TelemetryValue {
  key: string;
  name: string;
  value: number | string | boolean;
  unit?: string;
  category: 'power' | 'thermal' | 'attitude' | 'comms' | 'payload' | 'system' | 'custom';
  min?: number;
  max?: number;
  warning?: { low?: number; high?: number };
  critical?: { low?: number; high?: number };
}

export interface TelemetryDefinition {
  id: string;
  satelliteName: string;
  noradId: number;
  protocol: string;
  source: 'satnogs' | 'custom';
  fields: TelemetryFieldDef[];
}

export interface TelemetryFieldDef {
  key: string;
  name: string;
  offset: number;   // byte offset in frame
  length: number;    // bytes
  type: 'uint8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32' | 'bitfield';
  endian: 'big' | 'little';
  scale?: number;
  offset_val?: number;
  unit?: string;
  category: TelemetryValue['category'];
}

export interface TelemetryTimeSeries {
  key: string;
  name: string;
  unit?: string;
  points: { timestamp: number; value: number }[];
}
