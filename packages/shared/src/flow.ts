// ============================================================================
// SignalForge Flow Engine Types
// ============================================================================

export type PortType = 'iq' | 'audio' | 'fft' | 'bits' | 'packets' | 'control' | 'any';

export interface PortDefinition {
  id: string;
  name: string;
  type: PortType;
  direction: 'input' | 'output';
}

export interface ParamDefinition {
  id: string;
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select' | 'frequency' | 'color';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
  unit?: string;
}

export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  name: string;
  description: string;
  icon: string;
  color: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: ParamDefinition[];
}

export type NodeCategory =
  | 'source'
  | 'filter'
  | 'demodulator'
  | 'decoder'
  | 'analysis'
  | 'output'
  | 'satellite'
  | 'math';

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
}

export interface FlowConnection {
  id: string;
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
  targetPort: string;
}

export interface FlowGraph {
  id: string;
  name: string;
  description?: string;
  nodes: FlowNode[];
  connections: FlowConnection[];
  created: string;
  modified: string;
}

export interface FlowExecutionState {
  running: boolean;
  nodeStates: Record<string, {
    processing: boolean;
    sampleRate?: number;
    dataRate?: number;
    error?: string;
  }>;
}
