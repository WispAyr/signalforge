// ============================================================================
// SignalForge Rules & Data Flow Engine Types
// ============================================================================

// --- Rule definitions (stored in DB) ---

export interface Rule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  source: RuleSource;
  conditions: RuleCondition[];
  conditionLogic: 'AND' | 'OR';
  actions: RuleAction[];
  cooldownMs: number;
  lastTriggered?: number;
  triggerCount: number;
  createdAt: number;
  updatedAt: number;
}

export type RuleSource =
  | { type: 'aprs' }
  | { type: 'adsb' }
  | { type: 'ais' }
  | { type: 'acars' }
  | { type: 'rtl433' }
  | { type: 'weather' }
  | { type: 'satellite' }
  | { type: 'meshtastic' }
  | { type: 'any' };

export type RuleCondition =
  | { type: 'geofence_enter'; zoneId: string }
  | { type: 'geofence_exit'; zoneId: string }
  | { type: 'callsign_match'; pattern: string }
  | { type: 'squawk_match'; codes: string[] }
  | { type: 'speed_above'; threshold: number }
  | { type: 'speed_below'; threshold: number }
  | { type: 'altitude_above'; threshold: number }
  | { type: 'altitude_below'; threshold: number }
  | { type: 'temp_above'; threshold: number }
  | { type: 'temp_below'; threshold: number }
  | { type: 'pressure_below'; threshold: number }
  | { type: 'wind_above'; threshold: number }
  | { type: 'new_entity' }
  | { type: 'entity_lost'; timeoutMs: number }
  | { type: 'rate_of_change'; field: string; threshold: number; direction: 'rising' | 'falling' }
  | { type: 'keyword_match'; field: string; pattern: string }
  | { type: 'emergency' }
  | { type: 'custom_js'; expression: string };

export type RuleAction =
  | { type: 'webhook'; url: string; method?: string; headers?: Record<string, string> }
  | { type: 'mqtt'; topic: string; payload?: string }
  | { type: 'telegram'; chatId: string; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'alert' }
  | { type: 'sound'; sound: string }
  | { type: 'highlight_map'; duration: number }
  | { type: 'tts'; message: string }
  | { type: 'record_signal'; durationMs: number }
  | { type: 'tag_entity'; tags: string[] }
  | { type: 'chain_rule'; ruleId: string };

export interface RuleEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  timestamp: number;
  source: string;
  entity: string;
  matchedConditions: string[];
  actionsExecuted: string[];
  data: Record<string, unknown>;
}

// --- Data Flow graph types (visual rule builder) ---

export type DataFlowPortType = 'event' | 'bool' | 'action' | 'any';

export type DataFlowCategory =
  | 'source'
  | 'condition'
  | 'logic'
  | 'action'
  | 'bridge';

export interface DataFlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
}

export interface DataFlowConnection {
  id: string;
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
  targetPort: string;
}

export interface DataFlowGraph {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  nodes: DataFlowNode[];
  connections: DataFlowConnection[];
  cooldownMs: number;
  lastTriggered?: number;
  triggerCount: number;
  createdAt: number;
  updatedAt: number;
}

// --- Rule templates ---

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  rule: Omit<Rule, 'id' | 'createdAt' | 'updatedAt' | 'triggerCount' | 'lastTriggered'>;
}
