// ============================================================================
// SignalForge Edge Node Manager
// ============================================================================
import { EventEmitter } from 'events';
import type { EdgeNode, EdgeHeartbeat, EdgeCommand } from '@signalforge/shared';
import { WebSocket } from 'ws';

export class EdgeNodeManager extends EventEmitter {
  private nodes = new Map<string, EdgeNode>();
  private connections = new Map<string, WebSocket>();
  private commandQueue = new Map<string, EdgeCommand[]>();

  registerNode(nodeId: string, info: Partial<EdgeNode>, ws: WebSocket): EdgeNode {
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
      version: info.version || '0.5.0',
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

  sendCommand(nodeId: string, command: Omit<EdgeCommand, 'id' | 'timestamp'>): boolean {
    const ws = this.connections.get(nodeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cmd: EdgeCommand = { ...command, id: `cmd-${Date.now()}`, timestamp: Date.now() };
    ws.send(JSON.stringify({ type: 'edge_command', command: cmd }));
    return true;
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

  removeNode(id: string) {
    const ws = this.connections.get(id);
    if (ws) ws.close();
    this.nodes.delete(id);
    this.connections.delete(id);
  }

  // Check for stale nodes
  checkHealth() {
    const cutoff = Date.now() - 30000;
    for (const [, node] of this.nodes) {
      if (node.status === 'online' && node.lastHeartbeat < cutoff) {
        node.status = 'degraded';
        this.emit('node_degraded', node);
      }
    }
  }
}
