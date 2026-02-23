// ============================================================================
// SignalForge Timeline Types
// ============================================================================

export type TimelineEventType = 'observation' | 'recording' | 'decode' | 'alert' | 'scan_hit' | 'classification' | 'satellite_pass' | 'chat' | 'system';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string;
  timestamp: number;
  endTimestamp?: number;
  frequency?: number;
  mode?: string;
  source?: string; // edge node, local, etc.
  userId?: string;
  nickname?: string;
  icon: string;
  color: string;
  data?: Record<string, unknown>;
  tags?: string[];
}

export interface TimelineFilter {
  types?: TimelineEventType[];
  sources?: string[];
  frequencyRange?: { min: number; max: number };
  timeRange?: { start: number; end: number };
  search?: string;
  userId?: string;
  tags?: string[];
}

export interface TimelineExport {
  format: 'pdf' | 'html' | 'json' | 'csv';
  filter?: TimelineFilter;
  title?: string;
  includeSpectrogram?: boolean;
}
