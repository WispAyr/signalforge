import EventEmitter from 'events';
import type { Integration, IntegrationType, IntegrationTestResult, IntegrationStatus, INTEGRATION_DEFINITIONS } from '@signalforge/shared';

export class IntegrationHubService extends EventEmitter {
  private integrations: Map<IntegrationType, Integration> = new Map();

  constructor() {
    super();
    this.initDefaults();
  }

  private initDefaults() {
    const defs: Array<{ id: IntegrationType; name: string; description: string; iconEmoji: string }> = [
      { id: 'homeassistant', name: 'Home Assistant', description: 'Publish sensor data via MQTT discovery', iconEmoji: '🏠' },
      { id: 'nodered', name: 'Node-RED', description: 'MQTT + WebSocket integration', iconEmoji: '🔴' },
      { id: 'grafana', name: 'Grafana', description: 'Prometheus metrics endpoint', iconEmoji: '📊' },
      { id: 'telegram', name: 'Telegram', description: 'Alert notifications via bot', iconEmoji: '💬' },
      { id: 'discord', name: 'Discord', description: 'Webhook alerts', iconEmoji: '🎮' },
      { id: 'broadcastify', name: 'Broadcastify', description: 'Stream audio to public feed', iconEmoji: '📻' },
      { id: 'flightaware', name: 'FlightAware', description: 'Feed ADS-B data', iconEmoji: '✈️' },
      { id: 'marinetraffic', name: 'MarineTraffic', description: 'Feed AIS data', iconEmoji: '🚢' },
      { id: 'aprsis', name: 'APRS-IS', description: 'APRS Internet System', iconEmoji: '📍' },
    ];

    for (const d of defs) {
      this.integrations.set(d.id, {
        id: d.id, name: d.name, description: d.description, iconEmoji: d.iconEmoji,
        status: 'disconnected', config: {}, enabled: false,
      });
    }
  }

  getAll(): Integration[] { return Array.from(this.integrations.values()); }
  get(id: IntegrationType): Integration | undefined { return this.integrations.get(id); }

  configure(id: IntegrationType, config: Record<string, any>): Integration | null {
    const integ = this.integrations.get(id);
    if (!integ) return null;
    integ.config = { ...integ.config, ...config };
    integ.enabled = true;
    return integ;
  }

  async test(id: IntegrationType): Promise<IntegrationTestResult> {
    const integ = this.integrations.get(id);
    if (!integ) return { success: false, message: 'Integration not found', timestamp: Date.now() };
    if (!integ.enabled) return { success: false, message: 'Integration not configured', timestamp: Date.now() };

    // Simulate test
    const start = Date.now();
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    const latency = Date.now() - start;

    // Simulate success/failure
    const success = Math.random() > 0.2;
    if (success) {
      integ.status = 'connected';
      integ.lastConnected = Date.now();
    } else {
      integ.status = 'error';
      integ.lastError = 'Connection timed out';
    }

    return { success, message: success ? `Connected successfully (${latency}ms)` : 'Connection timed out — check configuration', latencyMs: latency, timestamp: Date.now() };
  }

  enable(id: IntegrationType): boolean {
    const integ = this.integrations.get(id);
    if (!integ) return false;
    integ.enabled = true;
    integ.status = 'connecting';
    setTimeout(() => { integ.status = 'connected'; integ.lastConnected = Date.now(); }, 1000);
    return true;
  }

  disable(id: IntegrationType): boolean {
    const integ = this.integrations.get(id);
    if (!integ) return false;
    integ.enabled = false;
    integ.status = 'disconnected';
    return true;
  }

  // Prometheus metrics endpoint content
  getPrometheusMetrics(): string {
    return [
      '# HELP signalforge_signals_total Total signals received',
      '# TYPE signalforge_signals_total counter',
      'signalforge_signals_total 0',
      '# HELP signalforge_active_decoders Number of active decoders',
      '# TYPE signalforge_active_decoders gauge',
      'signalforge_active_decoders 0',
      '# HELP signalforge_edge_nodes_connected Connected edge nodes',
      '# TYPE signalforge_edge_nodes_connected gauge',
      'signalforge_edge_nodes_connected 0',
      '# HELP signalforge_cpu_dsp_ms DSP processing time in milliseconds',
      '# TYPE signalforge_cpu_dsp_ms histogram',
      'signalforge_cpu_dsp_ms_bucket{le="1"} 0',
      'signalforge_cpu_dsp_ms_bucket{le="5"} 0',
      'signalforge_cpu_dsp_ms_bucket{le="10"} 0',
      'signalforge_cpu_dsp_ms_bucket{le="+Inf"} 0',
    ].join('\n');
  }
}
