// Analytics Dashboard Types

export interface HeatmapCell {
  frequency: number;
  time: number;
  intensity: number;
}

export interface SignalHeatmap {
  cells: HeatmapCell[];
  freqMin: number;
  freqMax: number;
  timeMin: number;
  timeMax: number;
  resolution: { freq: number; time: number };
}

export interface FrequencyActivity {
  frequency: number;
  label: string;
  count: number;
  totalDuration: number;
  lastSeen: number;
}

export interface DecoderStats {
  decoder: string;
  messagesTotal: number;
  messagesPerHour: number;
  messagesPerDay: number;
  lastMessage: number;
  errorRate: number;
  history: { timestamp: number; count: number }[];
}

export interface EdgeNodeMetrics {
  nodeId: string;
  nodeName: string;
  uptimePercent: number;
  cpuAvg: number;
  memAvg: number;
  tempAvg: number;
  history: { timestamp: number; cpu: number; mem: number; temp: number }[];
}

export interface ObservationStats {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  bySatellite: Record<string, { total: number; successful: number }>;
}

export interface AnalyticsReport {
  generatedAt: number;
  period: { start: number; end: number };
  heatmap: SignalHeatmap;
  busiestFrequencies: FrequencyActivity[];
  decoderStats: DecoderStats[];
  edgeNodeMetrics: EdgeNodeMetrics[];
  observationStats: ObservationStats;
}
