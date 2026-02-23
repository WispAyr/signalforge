// Phase 8: Integration Hub types

export type IntegrationType = 'homeassistant' | 'nodered' | 'grafana' | 'telegram' | 'discord' | 'broadcastify' | 'flightaware' | 'marinetraffic' | 'aprsis';
export type IntegrationStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Integration {
  id: IntegrationType;
  name: string;
  description: string;
  iconEmoji: string;
  status: IntegrationStatus;
  config: Record<string, any>;
  lastConnected?: number;
  lastError?: string;
  enabled: boolean;
}

export interface IntegrationTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  timestamp: number;
}

export const INTEGRATION_DEFINITIONS: Array<{ id: IntegrationType; name: string; description: string; iconEmoji: string; configFields: Array<{ key: string; label: string; type: 'text' | 'password' | 'number' | 'url'; required: boolean }> }> = [
  { id: 'homeassistant', name: 'Home Assistant', description: 'Publish sensor data via MQTT discovery', iconEmoji: '🏠', configFields: [{ key: 'mqttBroker', label: 'MQTT Broker URL', type: 'url', required: true }, { key: 'mqttUser', label: 'MQTT Username', type: 'text', required: false }, { key: 'mqttPass', label: 'MQTT Password', type: 'password', required: false }] },
  { id: 'nodered', name: 'Node-RED', description: 'MQTT + WebSocket integration nodes', iconEmoji: '🔴', configFields: [{ key: 'nodeRedUrl', label: 'Node-RED URL', type: 'url', required: true }] },
  { id: 'grafana', name: 'Grafana', description: 'Prometheus metrics endpoint (/metrics)', iconEmoji: '📊', configFields: [{ key: 'metricsPort', label: 'Metrics Port', type: 'number', required: false }] },
  { id: 'telegram', name: 'Telegram', description: 'Alert notifications via bot', iconEmoji: '💬', configFields: [{ key: 'botToken', label: 'Bot Token', type: 'password', required: true }, { key: 'chatId', label: 'Chat ID', type: 'text', required: true }] },
  { id: 'discord', name: 'Discord', description: 'Webhook alerts', iconEmoji: '🎮', configFields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url', required: true }] },
  { id: 'broadcastify', name: 'Broadcastify', description: 'Stream audio to public feed', iconEmoji: '📻', configFields: [{ key: 'mountPoint', label: 'Mount Point', type: 'text', required: true }, { key: 'password', label: 'Password', type: 'password', required: true }, { key: 'server', label: 'Server', type: 'text', required: true }] },
  { id: 'flightaware', name: 'FlightAware', description: 'Feed ADS-B data', iconEmoji: '✈️', configFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }, { key: 'feederId', label: 'Feeder ID', type: 'text', required: false }] },
  { id: 'marinetraffic', name: 'MarineTraffic', description: 'Feed AIS data', iconEmoji: '🚢', configFields: [{ key: 'stationId', label: 'Station ID', type: 'text', required: true }, { key: 'apiKey', label: 'API Key', type: 'password', required: true }] },
  { id: 'aprsis', name: 'APRS-IS', description: 'Connect to APRS Internet System', iconEmoji: '📍', configFields: [{ key: 'callsign', label: 'Callsign', type: 'text', required: true }, { key: 'passcode', label: 'Passcode', type: 'password', required: true }, { key: 'server', label: 'Server', type: 'text', required: false }] },
];
