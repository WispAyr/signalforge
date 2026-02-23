// ============================================================================
// SignalForge Edge Node — Lightweight SDR Agent
// Runs on Raspberry Pi, Van Pi, or any remote machine with SDR hardware
// Connects back to SignalForge server via WebSocket
// ============================================================================
import WebSocket from 'ws';
import os from 'os';
import { execSync } from 'child_process';

const SERVER_URL = process.env.SIGNALFORGE_SERVER || 'ws://localhost:3401/ws';
const NODE_NAME = process.env.NODE_NAME || os.hostname();
const NODE_ID = process.env.NODE_ID || `edge-${os.hostname()}-${Date.now().toString(36)}`;
const HEARTBEAT_INTERVAL = 10000;
const RECONNECT_DELAY = 5000;

interface SystemInfo {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  memoryTotal: number;
  memoryFree: number;
  uptime: number;
  loadAvg: number[];
  temperature?: number;
}

function getSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  let temperature: number | undefined;
  try {
    const tempStr = execSync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null', { encoding: 'utf8' });
    temperature = parseInt(tempStr) / 1000;
  } catch { /* not available */ }

  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model || 'unknown',
    cpuCores: cpus.length,
    memoryTotal: os.totalmem(),
    memoryFree: os.freemem(),
    uptime: os.uptime(),
    loadAvg: os.loadavg(),
    temperature,
  };
}

function detectSDRDevices(): { id: string; type: string; name: string; available: boolean }[] {
  const devices: { id: string; type: string; name: string; available: boolean }[] = [];
  try {
    const output = execSync('rtl_test -t 2>&1 || true', { encoding: 'utf8', timeout: 5000 });
    if (output.includes('Found') && !output.includes('No supported')) {
      devices.push({ id: 'rtlsdr-0', type: 'rtlsdr', name: 'RTL-SDR USB', available: true });
    }
  } catch { /* not available */ }

  try {
    const output = execSync('SoapySDRUtil --find 2>&1 || true', { encoding: 'utf8', timeout: 5000 });
    if (output.includes('driver=')) {
      devices.push({ id: 'soapy-0', type: 'soapy', name: 'SoapySDR Device', available: true });
    }
  } catch { /* not available */ }

  // If no hardware found, list as demo
  if (devices.length === 0) {
    devices.push({ id: 'demo-0', type: 'demo', name: 'Demo SDR (no hardware)', available: true });
  }

  return devices;
}

function checkHailo(): boolean {
  try {
    execSync('hailortcli fw-control identify 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch { return false; }
}

function checkGPS(): boolean {
  try {
    execSync('gpspipe -w -n 1 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch { return false; }
}

class EdgeNodeClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const url = `${SERVER_URL}?edge=true&nodeId=${encodeURIComponent(NODE_ID)}`;
    console.log(`🔗 Connecting to ${url}...`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log(`✅ Connected to SignalForge server`);
      this.register();
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleCommand(msg);
      } catch { /* ignore */ }
    });

    this.ws.on('close', () => {
      console.log('❌ Disconnected from server');
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('⚠️ WebSocket error:', err.message);
    });
  }

  private register() {
    const info = {
      name: NODE_NAME,
      hostname: os.hostname(),
      ip: this.getLocalIP(),
      system: getSystemInfo(),
      sdrDevices: detectSDRDevices(),
      capabilities: ['sdr', 'spectrum', 'record'],
      hasGPS: checkGPS(),
      hasHailo: checkHailo(),
      version: '0.5.0',
    };

    this.send({ type: 'edge_register', info });
    console.log(`📡 Registered as: ${NODE_NAME} (${NODE_ID})`);
    console.log(`   SDR devices: ${info.sdrDevices.map(d => d.name).join(', ')}`);
    console.log(`   GPS: ${info.hasGPS ? '✅' : '❌'} | Hailo: ${info.hasHailo ? '✅' : '❌'}`);
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'edge_heartbeat',
        heartbeat: {
          nodeId: NODE_ID,
          timestamp: Date.now(),
          system: getSystemInfo(),
          sdrDevices: detectSDRDevices(),
        },
      });
    }, HEARTBEAT_INTERVAL);
  }

  private handleCommand(msg: Record<string, unknown>) {
    if (msg.type === 'edge_command') {
      const cmd = msg.command as { type: string; params: Record<string, unknown> };
      console.log(`📥 Command: ${cmd.type}`, cmd.params);
      // Handle commands (tune, stream, etc.)
      switch (cmd.type) {
        case 'tune':
          console.log(`🎯 Tuning to ${cmd.params.frequency} Hz`);
          break;
        case 'start_stream':
          console.log(`▶️ Starting IQ stream`);
          break;
        case 'stop_stream':
          console.log(`⏹️ Stopping IQ stream`);
          break;
        default:
          console.log(`❓ Unknown command: ${cmd.type}`);
      }
    }
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private cleanup() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`🔄 Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
    return '0.0.0.0';
  }
}

// ============================================================================
// Main
// ============================================================================
console.log(`
  🖥️ ╔═══════════════════════════════════════╗
  🖥️ ║    SignalForge Edge Node v0.5.0       ║
  🖥️ ╠═══════════════════════════════════════╣
  🖥️ ║  Node:   ${NODE_NAME.padEnd(28)}║
  🖥️ ║  ID:     ${NODE_ID.slice(0, 28).padEnd(28)}║
  🖥️ ║  Server: ${SERVER_URL.slice(0, 28).padEnd(28)}║
  🖥️ ╚═══════════════════════════════════════╝
`);

const client = new EdgeNodeClient();
client.connect();
