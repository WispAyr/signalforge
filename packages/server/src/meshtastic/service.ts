// ============================================================================
// SignalForge — Meshtastic Integration Service
// ============================================================================
import { EventEmitter } from 'events';
import type { MeshNode, MeshMessage, MeshTelemetry, MeshtasticConfig, MeshtasticStatus } from '@signalforge/shared';

export class MeshtasticService extends EventEmitter {
  private nodes = new Map<string, MeshNode>();
  private messages: MeshMessage[] = [];
  private telemetry: MeshTelemetry[] = [];
  private config: MeshtasticConfig = {
    enabled: false, connectionType: 'tcp', host: 'localhost', port: 4403,
    serialPort: '/dev/ttyUSB0', baudRate: 115200,
  };
  private myNodeId = '!a1b2c3d4';
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getNodes(): MeshNode[] { return Array.from(this.nodes.values()); }
  getNode(id: string): MeshNode | undefined { return this.nodes.get(id); }
  getMessages(limit = 100): MeshMessage[] { return this.messages.slice(0, limit); }
  getTelemetry(nodeId?: string, limit = 100): MeshTelemetry[] {
    let t = this.telemetry;
    if (nodeId) t = t.filter(tt => tt.nodeId === nodeId);
    return t.slice(0, limit);
  }

  getStatus(): MeshtasticStatus {
    return {
      connected: this.config.enabled, myNodeId: this.myNodeId,
      nodeCount: this.nodes.size, messagesReceived: this.messages.length,
      config: this.config,
    };
  }

  getConfig(): MeshtasticConfig { return this.config; }
  updateConfig(cfg: Partial<MeshtasticConfig>): MeshtasticConfig { Object.assign(this.config, cfg); return this.config; }

  sendMessage(text: string, to = '!ffffffff', channel = 0): MeshMessage {
    const msg: MeshMessage = {
      id: `mm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(), from: this.myNodeId, fromName: 'SignalForge',
      to, toName: to === '!ffffffff' ? 'Broadcast' : this.nodes.get(to)?.longName || to,
      channel, text, hopLimit: 3, rxSnr: 0, rxRssi: 0,
    };
    this.messages.unshift(msg);
    if (this.messages.length > 2000) this.messages = this.messages.slice(0, 2000);
    this.emit('message', msg);
    return msg;
  }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    const demoNodes: Omit<MeshNode, 'lastHeard'>[] = [
      { id: '!a1b2c3d4', longName: 'SignalForge Base', shortName: 'SF', macAddr: 'a1:b2:c3:d4', hwModel: 'TBEAM', role: 'ROUTER', latitude: 51.505, longitude: -0.09, altitude: 30, batteryLevel: 100, hopsAway: 0, voltage: 4.2 },
      { id: '!e5f6a7b8', longName: 'Field Unit Alpha', shortName: 'FA', macAddr: 'e5:f6:a7:b8', hwModel: 'HELTEC_V3', role: 'CLIENT', latitude: 51.51, longitude: -0.08, altitude: 25, batteryLevel: 78, hopsAway: 1, voltage: 3.9 },
      { id: '!c9d0e1f2', longName: 'Relay Node 1', shortName: 'R1', macAddr: 'c9:d0:e1:f2', hwModel: 'TBEAM', role: 'ROUTER', latitude: 51.508, longitude: -0.095, altitude: 45, batteryLevel: 92, hopsAway: 1, voltage: 4.1 },
      { id: '!a3b4c5d6', longName: 'Mobile Unit', shortName: 'MU', macAddr: 'a3:b4:c5:d6', hwModel: 'RAK4631', role: 'CLIENT', latitude: 51.502, longitude: -0.085, altitude: 20, batteryLevel: 45, hopsAway: 2, voltage: 3.6 },
    ];
    for (const n of demoNodes) this.nodes.set(n.id, { ...n, lastHeard: Date.now() });

    const demoMessages = [
      'All stations, comms check', 'Roger, loud and clear', 'Moving to grid ref 51.508,-0.095',
      'Battery low, RTB in 30', 'New signal detected 433.920', 'Copy, monitoring',
      'Weather update: rain expected 1400Z', 'Checkpoint Alpha reached',
    ];

    this.demoInterval = setInterval(() => {
      // Update node telemetry
      for (const node of this.nodes.values()) {
        node.lastHeard = Date.now();
        if (node.batteryLevel && node.batteryLevel > 10) node.batteryLevel -= Math.random() * 0.5;
        node.latitude! += (Math.random() - 0.5) * 0.001;
        node.longitude! += (Math.random() - 0.5) * 0.001;
        node.temperature = 15 + Math.random() * 10;
        node.humidity = 40 + Math.random() * 40;
        const tel: MeshTelemetry = {
          nodeId: node.id, timestamp: Date.now(),
          batteryLevel: node.batteryLevel || 0, voltage: node.voltage || 0,
          channelUtilization: Math.random() * 30, airUtilTx: Math.random() * 10,
          temperature: node.temperature, humidity: node.humidity,
        };
        this.telemetry.unshift(tel);
        this.emit('telemetry', tel);
      }
      if (this.telemetry.length > 2000) this.telemetry = this.telemetry.slice(0, 2000);
      this.emit('nodes_update', this.getNodes());

      // Random message
      if (Math.random() > 0.5) {
        const nodes = Array.from(this.nodes.values());
        const from = nodes[Math.floor(Math.random() * nodes.length)];
        const msg: MeshMessage = {
          id: `mm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(), from: from.id, fromName: from.longName,
          to: '!ffffffff', toName: 'Broadcast', channel: 0,
          text: demoMessages[Math.floor(Math.random() * demoMessages.length)],
          hopLimit: 3, rxSnr: -10 + Math.random() * 20, rxRssi: -60 - Math.random() * 40,
        };
        this.messages.unshift(msg);
        if (this.messages.length > 2000) this.messages = this.messages.slice(0, 2000);
        this.emit('message', msg);
      }
    }, 8000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
