// TSCM (Counter-Surveillance) Types

export type ThreatLevel = 'clear' | 'low' | 'medium' | 'high' | 'critical';

export interface TSCMBaseline {
  id: string;
  name: string;
  timestamp: number;
  location: string;
  startFreq: number;
  endFreq: number;
  samples: number[];
  stepSize: number;
  noiseFloor: number;
}

export interface TSCMAnomaly {
  id: string;
  timestamp: number;
  frequency: number;
  power: number;
  baselinePower: number;
  deviation: number;
  threatLevel: ThreatLevel;
  description: string;
  acknowledged: boolean;
  knownBugMatch?: KnownBugFrequency;
}

export interface KnownBugFrequency {
  frequency: number;
  bandwidth: number;
  type: string;
  description: string;
  manufacturer?: string;
  commonNames: string[];
}

export interface TSCMSweepResult {
  id: string;
  timestamp: number;
  location: string;
  duration: number;
  baselineId: string;
  anomalies: TSCMAnomaly[];
  overallThreat: ThreatLevel;
  bandsSwept: TSCMBandResult[];
}

export interface TSCMBandResult {
  name: string;
  startFreq: number;
  endFreq: number;
  status: ThreatLevel;
  anomalyCount: number;
  maxDeviation: number;
}

export interface TSCMConfig {
  enabled: boolean;
  anomalyThresholdDb: number;
  autoSweepInterval: number;
  sweepBands: { name: string; start: number; end: number }[];
}

export interface TSCMReport {
  id: string;
  sweep: TSCMSweepResult;
  generatedAt: number;
  location: string;
  operator: string;
  summary: string;
  recommendations: string[];
}
