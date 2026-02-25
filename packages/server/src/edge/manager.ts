// ============================================================================
// SignalForge Edge Node Manager v1.0
// ============================================================================
import { EventEmitter } from 'events';
import type { EdgeNode, EdgeHeartbeat, EdgeCommand } from '@signalforge/shared';
import { WebSocket } from 'ws';

export interface EdgeTelemetry {
  nodeId: string;
  timestamp: number;
  system: EdgeNode['system'];
  network?: { interfaces: { name: string; ip: string; mac: string; type: string }[]; hostname: string };
  gps?: EdgeNode['location'] & { satellites?: number; hdop?: number };
  sdr?: { streaming: boolean; frequency: number; gain: number; sampleRate: number };
  capabilities?: Record<string, boolean>;
}

export interface EdgeCommandResult {
  commandId: string;
  success: boolean;
  result: unknown;
}

export class EdgeNodeManager extends EventEmitter {
  private nodes = new Map<string, EdgeNode>();
  private connections = new Map<string, WebSocket>();
  private telemetryHistory = new Map<string, EdgeTelemetry[]>();
  private commandCallbacks = new Map<string, (result: EdgeCommandResult) => void>();
  private readonly MAX_TELEMETRY_HISTORY = 60; // Keep last 60 readings per node

  registerNode(nodeId: string, info: Partial<EdgeNode> & { services?: Record<string, boolean> }, ws: WebSocket): EdgeNode {
    const existing = this.nodes.get(nodeId);
    const node: EdgeNode = {
      id: nodeId,
      name: info.name || `Edge-${nodeId.slice(-4)}`,
      hostname: info.hostname || 'unknown',
      ip: info.ip || '0.0.0.0',
      connectedAt: existing?.connectedAt || Date.now(),
      lastHeartbeat: Date.now(),
      status: 'online',
      location: info.location,
      sdrDevices: info.sdrDevices || [],
      capabilities: info.capabilities || [],
      system: info.system || { platform: 'linux', arch: 'arm64', cpuModel: 'unknown', cpuCores: 4, memoryTotal: 0, memoryFree: 0, uptime: 0, loadAvg: [0, 0, 0] },
      hasGPS: info.hasGPS || false,
      hasHailo: info.hasHailo || false,
      version: info.version || '1.0.0',
    };
    this.nodes.set(nodeId, node);
    this.connections.set(nodeId, ws);

    ws.on('close', () => {
      const n = this.nodes.get(nodeId);
      if (n) {
        n.status = 'offline';
        this.emit('node_offline', n);
      }
      this.connections.delete(nodeId);
    });

    this.emit('node_online', node);
    console.log(`🖥️ Edge node registered: ${node.name} (${nodeId}) — capabilities: ${node.capabilities.join(', ')}`);
    return node;
  }

  handleHeartbeat(hb: EdgeHeartbeat) {
    const node = this.nodes.get(hb.nodeId);
    if (!node) return;
    node.lastHeartbeat = hb.timestamp;
    node.system = hb.system;
    node.sdrDevices = hb.sdrDevices;
    if (hb.location) node.location = hb.location;
    node.status = 'online';
    this.emit('heartbeat', node);
  }

  handleTelemetry(telemetry: EdgeTelemetry) {
    const node = this.nodes.get(telemetry.nodeId);
    if (!node) return;

    // Update node with latest telemetry
    node.system = telemetry.system;
    if (telemetry.gps) {
      node.location = {
        latitude: telemetry.gps.latitude,
        longitude: telemetry.gps.longitude,
        altitude: telemetry.gps.altitude,
        source: telemetry.gps.source,
      };
    }

    // Store history
    let history = this.telemetryHistory.get(telemetry.nodeId);
    if (!history) {
      history = [];
      this.telemetryHistory.set(telemetry.nodeId, history);
    }
    history.push(telemetry);
    if (history.length > this.MAX_TELEMETRY_HISTORY) {
      history.splice(0, history.length - this.MAX_TELEMETRY_HISTORY);
    }

    this.emit('telemetry', telemetry);
  }

  handleCommandResult(result: EdgeCommandResult) {
    const cb = this.commandCallbacks.get(result.commandId);
    if (cb) {
      cb(result);
      this.commandCallbacks.delete(result.commandId);
    }
    this.emit('command_result', result);
  }

  sendCommand(nodeId: string, command: Omit<EdgeCommand, 'id' | 'timestamp'>): boolean {
    const ws = this.connections.get(nodeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cmd: EdgeCommand = { ...command, id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() };
    ws.send(JSON.stringify({ type: 'edge_command', command: cmd }));
    return true;
  }

  async sendCommandAsync(nodeId: string, command: Omit<EdgeCommand, 'id' | 'timestamp'>, timeoutMs = 30000): Promise<EdgeCommandResult> {
    const ws = this.connections.get(nodeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { commandId: '', success: false, result: { error: 'Node not connected' } };
    }
    
    const cmd: EdgeCommand = { ...command, id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() };
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.commandCallbacks.delete(cmd.id);
        resolve({ commandId: cmd.id, success: false, result: { error: 'Timeout' } });
      }, timeoutMs);

      this.commandCallbacks.set(cmd.id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      ws.send(JSON.stringify({ type: 'edge_command', command: cmd }));
    });
  }

  getNodes(): EdgeNode[] {
    return Array.from(this.nodes.values());
  }

  getOnlineNodes(): EdgeNode[] {
    return this.getNodes().filter(n => n.status === 'online');
  }

  getNode(id: string): EdgeNode | undefined {
    return this.nodes.get(id);
  }

  getNodeTelemetry(id: string, limit = 60): EdgeTelemetry[] {
    const history = this.telemetryHistory.get(id) || [];
    return history.slice(-limit);
  }

  removeNode(id: string) {
    const ws = this.connections.get(id);
    if (ws) ws.close();
    this.nodes.delete(id);
    this.connections.delete(id);
    this.telemetryHistory.delete(id);
  }

  checkHealth() {
    const cutoff = Date.now() - 45000; // 1.5x heartbeat interval
    for (const [, node] of this.nodes) {
      if (node.status === 'online' && node.lastHeartbeat < cutoff) {
        node.status = 'degraded';
        this.emit('node_degraded', node);
      }
    }
  }
}
