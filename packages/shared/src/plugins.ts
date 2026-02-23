// ============================================================================
// SignalForge Plugin System Types
// ============================================================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  homepage?: string;
  icon?: string;
  dependencies?: Record<string, string>;
  nodes: PluginNodeDefinition[];
  serverModule?: string;
  clientModule?: string;
  enabled: boolean;
}

export interface PluginNodeDefinition {
  type: string;
  name: string;
  category: 'source' | 'filter' | 'demodulator' | 'decoder' | 'display' | 'output';
  icon: string;
  color: string;
  description: string;
  inputs: PluginPort[];
  outputs: PluginPort[];
  params: PluginParam[];
}

export interface PluginPort {
  id: string;
  name: string;
  type: 'iq' | 'audio' | 'fft' | 'bits' | 'packets' | 'control' | 'any';
}

export interface PluginParam {
  id: string;
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  default: unknown;
  options?: { label: string; value: unknown }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  nodeCount: number;
}
