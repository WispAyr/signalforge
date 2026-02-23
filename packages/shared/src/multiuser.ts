// ============================================================================
// SignalForge Multi-User Types
// ============================================================================

export interface UserSession {
  id: string;
  nickname: string;
  token: string;
  color: string;
  connectedAt: number;
  lastSeen: number;
  tuning?: {
    frequency: number;
    mode: string;
    description?: string;
  };
  activeView?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  color: string;
  text: string;
  timestamp: number;
  type: 'message' | 'system' | 'observation';
}

export interface SharedObservation {
  id: string;
  userId: string;
  nickname: string;
  color: string;
  frequency: number;
  mode: string;
  description: string;
  timestamp: number;
  signalStrength?: number;
  tags?: string[];
}

export interface FlowgraphExport {
  id: string;
  name: string;
  description?: string;
  version: string;
  author: string;
  created: number;
  nodes: unknown[];
  connections: unknown[];
  metadata?: Record<string, unknown>;
}
