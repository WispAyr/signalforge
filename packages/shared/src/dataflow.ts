// ============================================================================
// Data Flow Node Definitions — separate from RF Flow
// ============================================================================

import type { DataFlowPortType, DataFlowCategory } from './rules';

export interface DataFlowPortDef {
  id: string;
  name: string;
  type: DataFlowPortType;
  direction: 'input' | 'output';
}

export interface DataFlowParamDef {
  id: string;
  label: string;
  type: 'number' | 'select' | 'text' | 'textarea' | 'toggle';
  default: unknown;
  options?: string[];
  placeholder?: string;
}

export interface DataFlowNodeDef {
  type: string;
  name: string;
  icon: string;
  color: string;
  category: DataFlowCategory;
  inputs: DataFlowPortDef[];
  outputs: DataFlowPortDef[];
  params: DataFlowParamDef[];
}

// Port type colours (amber/orange palette for data flow)
export const DATA_PORT_COLORS: Record<DataFlowPortType, string> = {
  event: '#ffab00',
  bool: '#00e676',
  action: '#ff6d00',
  any: '#9e9e9e',
};

// ==========================================================================
// Node Ports
// ==========================================================================
export const DATA_NODE_PORTS: Record<string, { inputs: DataFlowPortType[]; outputs: DataFlowPortType[] }> = {
  // Sources — no inputs, emit events
  decoder_feed:     { inputs: [],        outputs: ['event'] },
  manual_trigger:   { inputs: [],        outputs: ['event'] },
  schedule_trigger: { inputs: [],        outputs: ['event'] },

  // Conditions — event in, filtered event out (+ rejected)
  geofence_check:   { inputs: ['event'], outputs: ['event', 'event'] },   // [inside, outside]
  callsign_filter:  { inputs: ['event'], outputs: ['event'] },
  squawk_filter:    { inputs: ['event'], outputs: ['event'] },
  speed_gate:       { inputs: ['event'], outputs: ['event'] },
  altitude_gate:    { inputs: ['event'], outputs: ['event'] },
  threshold:        { inputs: ['event'], outputs: ['event'] },
  new_entity:       { inputs: ['event'], outputs: ['event'] },
  entity_lost:      { inputs: ['event'], outputs: ['event'] },
  rate_of_change:   { inputs: ['event'], outputs: ['event'] },
  keyword_match:    { inputs: ['event'], outputs: ['event'] },
  emergency_detect: { inputs: ['event'], outputs: ['event'] },
  custom_filter:    { inputs: ['event'], outputs: ['event'] },

  // Logic — combine/split
  and_gate:         { inputs: ['event', 'event'], outputs: ['event'] },
  or_gate:          { inputs: ['event', 'event'], outputs: ['event'] },
  not_gate:         { inputs: ['event'],          outputs: ['event'] },
  debounce:         { inputs: ['event'],          outputs: ['event'] },
  rate_limit:       { inputs: ['event'],          outputs: ['event'] },

  // Actions — event in, no output (terminal) or chain
  webhook_action:   { inputs: ['event'], outputs: [] },
  mqtt_action:      { inputs: ['event'], outputs: [] },
  telegram_action:  { inputs: ['event'], outputs: [] },
  log_action:       { inputs: ['event'], outputs: [] },
  sound_action:     { inputs: ['event'], outputs: [] },
  highlight_map:    { inputs: ['event'], outputs: [] },
  tts_action:       { inputs: ['event'], outputs: [] },
  tag_entity:       { inputs: ['event'], outputs: ['event'] },  // passthrough

  // Bridge nodes — link to RF flow
  record_signal:    { inputs: ['event'], outputs: [] },
  tune_sdr:         { inputs: ['event'], outputs: [] },
};

// ==========================================================================
// Node Params
// ==========================================================================
export const DATA_NODE_PARAMS: Record<string, DataFlowParamDef[]> = {
  decoder_feed: [
    { id: 'source', label: 'Source', type: 'select', default: 'any', options: ['any', 'aprs', 'adsb', 'ais', 'acars', 'rtl433', 'meshtastic', 'satellite', 'weather'] },
  ],
  schedule_trigger: [
    { id: 'cron', label: 'Cron Expression', type: 'text', default: '*/5 * * * *', placeholder: '*/5 * * * *' },
  ],
  geofence_check: [
    { id: 'zoneId', label: 'Zone', type: 'select', default: '', options: [] },
  ],
  callsign_filter: [
    { id: 'pattern', label: 'Pattern (regex)', type: 'text', default: '.*', placeholder: 'GM8.*' },
  ],
  squawk_filter: [
    { id: 'codes', label: 'Squawk Codes', type: 'text', default: '7500,7600,7700', placeholder: '7500,7600,7700' },
  ],
  speed_gate: [
    { id: 'operator', label: 'Operator', type: 'select', default: '>', options: ['>', '<', '>=', '<='] },
    { id: 'threshold', label: 'Speed (kts)', type: 'number', default: 100 },
  ],
  altitude_gate: [
    { id: 'operator', label: 'Operator', type: 'select', default: '>', options: ['>', '<', '>=', '<='] },
    { id: 'threshold', label: 'Altitude (ft)', type: 'number', default: 10000 },
  ],
  threshold: [
    { id: 'field', label: 'Field', type: 'text', default: 'speed', placeholder: 'speed' },
    { id: 'operator', label: 'Operator', type: 'select', default: '>', options: ['>', '<', '>=', '<=', '==', '!='] },
    { id: 'value', label: 'Value', type: 'number', default: 0 },
  ],
  entity_lost: [
    { id: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 300000 },
  ],
  rate_of_change: [
    { id: 'field', label: 'Field', type: 'text', default: 'altitude' },
    { id: 'threshold', label: 'Rate Threshold', type: 'number', default: 1000 },
    { id: 'direction', label: 'Direction', type: 'select', default: 'falling', options: ['rising', 'falling'] },
  ],
  keyword_match: [
    { id: 'field', label: 'Field', type: 'text', default: 'comment', placeholder: 'comment' },
    { id: 'pattern', label: 'Pattern (regex)', type: 'text', default: '.*', placeholder: 'EMERGENCY' },
  ],
  custom_filter: [
    { id: 'expression', label: 'JS Expression', type: 'textarea', default: 'data.speed > 100' },
  ],
  debounce: [
    { id: 'delayMs', label: 'Delay (ms)', type: 'number', default: 5000 },
  ],
  rate_limit: [
    { id: 'maxPerMin', label: 'Max / minute', type: 'number', default: 10 },
  ],
  webhook_action: [
    { id: 'url', label: 'URL', type: 'text', default: '', placeholder: 'https://...' },
    { id: 'method', label: 'Method', type: 'select', default: 'POST', options: ['POST', 'PUT', 'GET'] },
  ],
  mqtt_action: [
    { id: 'topic', label: 'Topic', type: 'text', default: 'signalforge/alerts', placeholder: 'signalforge/alerts' },
    { id: 'payload', label: 'Payload Template', type: 'textarea', default: '{{json}}' },
  ],
  telegram_action: [
    { id: 'chatId', label: 'Chat ID', type: 'text', default: '' },
    { id: 'message', label: 'Message Template', type: 'textarea', default: '⚡ {{entity}} triggered {{ruleName}}' },
  ],
  log_action: [
    { id: 'level', label: 'Level', type: 'select', default: 'info', options: ['info', 'warn', 'alert'] },
  ],
  sound_action: [
    { id: 'sound', label: 'Sound', type: 'select', default: 'alert', options: ['alert', 'ping', 'alarm', 'chime'] },
  ],
  highlight_map: [
    { id: 'duration', label: 'Duration (ms)', type: 'number', default: 10000 },
  ],
  tts_action: [
    { id: 'message', label: 'Message Template', type: 'textarea', default: 'Alert: {{entity}} detected', placeholder: 'Alert: {{entity}}' },
  ],
  tag_entity: [
    { id: 'tags', label: 'Tags (comma sep)', type: 'text', default: '', placeholder: 'tracked,alert' },
  ],
  record_signal: [
    { id: 'durationMs', label: 'Duration (ms)', type: 'number', default: 30000 },
  ],
  tune_sdr: [
    { id: 'frequency', label: 'Frequency (Hz)', type: 'number', default: 0 },
  ],
};

// ==========================================================================
// Node Metadata (name, icon, color, category)
// ==========================================================================
export const DATA_NODE_META: Record<string, { name: string; icon: string; color: string; category: DataFlowCategory }> = {
  // Sources
  decoder_feed:     { name: 'Decoder Feed',      icon: '📡', color: '#ffab00', category: 'source' },
  manual_trigger:   { name: 'Manual Trigger',     icon: '👆', color: '#ffab00', category: 'source' },
  schedule_trigger: { name: 'Schedule',           icon: '⏰', color: '#ffab00', category: 'source' },

  // Conditions
  geofence_check:   { name: 'Geofence',          icon: '🔲', color: '#ff6d00', category: 'condition' },
  callsign_filter:  { name: 'Callsign Filter',   icon: '🔤', color: '#ff6d00', category: 'condition' },
  squawk_filter:    { name: 'Squawk Filter',      icon: '🚨', color: '#ff6d00', category: 'condition' },
  speed_gate:       { name: 'Speed Gate',         icon: '⚡', color: '#ff6d00', category: 'condition' },
  altitude_gate:    { name: 'Altitude Gate',      icon: '📏', color: '#ff6d00', category: 'condition' },
  threshold:        { name: 'Threshold',          icon: '📊', color: '#ff6d00', category: 'condition' },
  new_entity:       { name: 'New Entity',         icon: '✨', color: '#ff6d00', category: 'condition' },
  entity_lost:      { name: 'Entity Lost',        icon: '👻', color: '#ff6d00', category: 'condition' },
  rate_of_change:   { name: 'Rate of Change',     icon: '📈', color: '#ff6d00', category: 'condition' },
  keyword_match:    { name: 'Keyword Match',      icon: '🔍', color: '#ff6d00', category: 'condition' },
  emergency_detect: { name: 'Emergency',          icon: '🆘', color: '#ff1744', category: 'condition' },
  custom_filter:    { name: 'Custom JS',          icon: '📜', color: '#ff6d00', category: 'condition' },

  // Logic
  and_gate:         { name: 'AND',                icon: '&',  color: '#00e676', category: 'logic' },
  or_gate:          { name: 'OR',                 icon: '|',  color: '#00e676', category: 'logic' },
  not_gate:         { name: 'NOT',                icon: '!',  color: '#00e676', category: 'logic' },
  debounce:         { name: 'Debounce',           icon: '⏱️', color: '#00e676', category: 'logic' },
  rate_limit:       { name: 'Rate Limit',         icon: '🚦', color: '#00e676', category: 'logic' },

  // Actions
  webhook_action:   { name: 'Webhook',            icon: '🌐', color: '#448aff', category: 'action' },
  mqtt_action:      { name: 'MQTT Publish',       icon: '📤', color: '#448aff', category: 'action' },
  telegram_action:  { name: 'Telegram',           icon: '✈️', color: '#448aff', category: 'action' },
  log_action:       { name: 'Log Event',          icon: '📝', color: '#448aff', category: 'action' },
  sound_action:     { name: 'Play Sound',         icon: '🔔', color: '#448aff', category: 'action' },
  highlight_map:    { name: 'Highlight Map',      icon: '🗺️', color: '#448aff', category: 'action' },
  tts_action:       { name: 'Text to Speech',     icon: '🗣️', color: '#448aff', category: 'action' },
  tag_entity:       { name: 'Tag Entity',         icon: '🏷️', color: '#448aff', category: 'action' },

  // Bridge
  record_signal:    { name: 'Record Signal',      icon: '⏺️', color: '#aa00ff', category: 'bridge' },
  tune_sdr:         { name: 'Tune SDR',           icon: '📻', color: '#aa00ff', category: 'bridge' },
};

// Category display
export const DATA_CATEGORIES: { id: DataFlowCategory; label: string; icon: string; color: string }[] = [
  { id: 'source',    label: 'Sources',    icon: '📡', color: '#ffab00' },
  { id: 'condition', label: 'Conditions', icon: '🔍', color: '#ff6d00' },
  { id: 'logic',     label: 'Logic',      icon: '🔀', color: '#00e676' },
  { id: 'action',    label: 'Actions',    icon: '⚡', color: '#448aff' },
  { id: 'bridge',    label: 'RF Bridge',  icon: '🔗', color: '#aa00ff' },
];
