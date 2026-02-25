// ============================================================================
// SignalForge Edge Node v1.0.0 — Lightweight SDR Agent
// Runs on Raspberry Pi, Van Pi, or any remote machine
// Connects back to SignalForge server via WebSocket
// ============================================================================
import WebSocket from 'ws';
import os from 'os';
import { exec, execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import net from 'net';

// ============================================================================
// Configuration
// ============================================================================
const SERVER_URL = process.env.SIGNALFORGE_SERVER || 'ws://localhost:3401/ws';
const NODE_NAME = process.env.NODE_NAME || os.hostname();
const NODE_ID = process.env.NODE_ID || `edge-${os.hostname()}`;
const HEARTBEAT_INTERVAL = 30_000;
const TELEMETRY_INTERVAL = 60_000;
const RECONNECT_BASE = 2_000;
const RECONNECT_MAX = 60_000;
const BAYWATCH_URL = process.env.BAYWATCH_URL || 'http://localhost:3050';
const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:3051';
const LLAMA_URL = process.env.LLAMA_URL || 'http://localhost:8080';

// Location (manual override or GPS)
const MANUAL_LAT = process.env.LATITUDE ? parseFloat(process.env.LATITUDE) : undefined;
const MANUAL_LON = process.env.LONGITUDE ? parseFloat(process.env.LONGITUDE) : undefined;
const MANUAL_ALT = process.env.ALTITUDE ? parseFloat(process.env.ALTITUDE) : undefined;

// ============================================================================
// Types
// ============================================================================
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
  diskUsage?: { total: number; used: number; available: number; percent: string };
}

interface NetworkInfo {
  interfaces: { name: string; ip: string; mac: string; type: string }[];
  hostname: string;
}

interface GPSPosition {
  latitude: number;
  longitude: number;
  altitude: number;
  source: 'gps' | 'manual' | 'ip';
  timestamp?: number;
  satellites?: number;
  hdop?: number;
}

interface SDRDevice {
  id: string;
  type: string;
  name: string;
  serial?: string;
  available: boolean;
  currentFrequency?: number;
  sampleRate?: number;
}

interface Capabilities {
  sdr: boolean;
  gps: boolean;
  hailo: boolean;
  audio: boolean;
  baywatch: boolean;
  whisper: boolean;
  llama: boolean;
}

// ============================================================================
// System Telemetry
// ============================================================================
function getSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  let temperature: number | undefined;
  
  // Try multiple temperature sources
  const tempPaths = [
    '/sys/class/thermal/thermal_zone0/temp',
    '/sys/class/hwmon/hwmon0/temp1_input',
  ];
  for (const p of tempPaths) {
    try {
      const tempStr = readFileSync(p, 'utf8').trim();
      temperature = parseInt(tempStr) / 1000;
      break;
    } catch { /* next */ }
  }

  // macOS temperature (for dev)
  if (temperature === undefined && os.platform() === 'darwin') {
    try {
      // Skip on macOS - no easy way without sudo
    } catch { /* skip */ }
  }

  let diskUsage: SystemInfo['diskUsage'];
  try {
    const df = execSync("df -B1 / 2>/dev/null | tail -1", { encoding: 'utf8' }).trim().split(/\s+/);
    if (df.length >= 5) {
      diskUsage = {
        total: parseInt(df[1]),
        used: parseInt(df[2]),
        available: parseInt(df[3]),
        percent: df[4],
      };
    }
  } catch {
    try {
      // macOS df
      const df = execSync("df -k / | tail -1", { encoding: 'utf8' }).trim().split(/\s+/);
      if (df.length >= 5) {
        diskUsage = {
          total: parseInt(df[1]) * 1024,
          used: parseInt(df[2]) * 1024,
          available: parseInt(df[3]) * 1024,
          percent: df[4],
        };
      }
    } catch { /* skip */ }
  }

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
    diskUsage,
  };
}

function getNetworkInfo(): NetworkInfo {
  const interfaces = os.networkInterfaces();
  const result: NetworkInfo = { interfaces: [], hostname: os.hostname() };
  
  for (const [name, ifaces] of Object.entries(interfaces)) {
    if (!ifaces) continue;
    for (const info of ifaces) {
      if (info.family === 'IPv4' && !info.internal) {
        result.interfaces.push({
          name,
          ip: info.address,
          mac: info.mac,
          type: name.startsWith('zt') ? 'zerotier' : name.startsWith('wl') ? 'wifi' : name.startsWith('eth') ? 'ethernet' : 'other',
        });
      }
    }
  }
  return result;
}

// ============================================================================
// GPS Client (gpsd)
// ============================================================================
class GPSClient {
  private position: GPSPosition | null = null;
  private socket: net.Socket | null = null;
  private available = false;

  constructor() {
    if (MANUAL_LAT !== undefined && MANUAL_LON !== undefined) {
      this.position = {
        latitude: MANUAL_LAT,
        longitude: MANUAL_LON,
        altitude: MANUAL_ALT || 0,
        source: 'manual',
      };
      this.available = true;
    }
  }

  start() {
    if (this.position?.source === 'manual') return; // Using manual position
    this.connectGPSD();
  }

  private connectGPSD() {
    try {
      this.socket = net.createConnection({ host: '127.0.0.1', port: 2947 }, () => {
        this.available = true;
        this.socket!.write('?WATCH={"enable":true,"json":true}\n');
      });

      const rl = createInterface({ input: this.socket });
      rl.on('line', (line) => {
        try {
          const data = JSON.parse(line);
          if (data.class === 'TPV' && data.lat !== undefined) {
            this.position = {
              latitude: data.lat,
              longitude: data.lon,
              altitude: data.alt || 0,
              source: 'gps',
              timestamp: Date.now(),
              satellites: data.nSat,
              hdop: data.hdop,
            };
          }
        } catch { /* skip */ }
      });

      this.socket.on('error', () => { this.available = false; });
      this.socket.on('close', () => {
        this.available = false;
        setTimeout(() => this.connectGPSD(), 30_000);
      });
    } catch {
      this.available = false;
    }
  }

  getPosition(): GPSPosition | null { return this.position; }
  isAvailable(): boolean { return this.available; }
  stop() { this.socket?.destroy(); }
}

// ============================================================================
// SDR Bridge
// ============================================================================
class SDRBridge {
  private rtlTcpProcess: ChildProcess | null = null;
  private devices: SDRDevice[] = [];
  private streaming = false;
  private currentFreq = 0;
  private currentGain = 0;
  private currentSampleRate = 2_048_000;

  detectDevices(): SDRDevice[] {
    this.devices = [];
    
    try {
      const output = execSync('rtl_test -t 2>&1 || true', { encoding: 'utf8', timeout: 5000 });
      if (output.includes('Found') && !output.includes('No supported')) {
        const match = output.match(/Found (\d+) device/);
        const count = match ? parseInt(match[1]) : 1;
        for (let i = 0; i < count; i++) {
          const serialMatch = output.match(/SN:\s*(\S+)/);
          this.devices.push({
            id: `rtlsdr-${i}`,
            type: 'rtlsdr',
            name: 'RTL-SDR USB',
            serial: serialMatch?.[1],
            available: true,
          });
        }
      }
    } catch { /* not available */ }

    try {
      const output = execSync('SoapySDRUtil --find 2>&1 || true', { encoding: 'utf8', timeout: 5000 });
      if (output.includes('driver=')) {
        this.devices.push({ id: 'soapy-0', type: 'soapy', name: 'SoapySDR Device', available: true });
      }
    } catch { /* not available */ }

    return this.devices;
  }

  getDevices(): SDRDevice[] { return this.devices; }
  isStreaming(): boolean { return this.streaming; }

  startRtlTcp(frequency: number, sampleRate: number, gain: number): boolean {
    if (this.rtlTcpProcess) this.stopRtlTcp();
    
    try {
      this.rtlTcpProcess = spawn('rtl_tcp', [
        '-f', String(frequency),
        '-s', String(sampleRate),
        '-g', String(gain),
        '-a', '127.0.0.1',
        '-p', '1234',
      ]);
      
      this.rtlTcpProcess.on('exit', () => {
        this.rtlTcpProcess = null;
        this.streaming = false;
      });

      this.currentFreq = frequency;
      this.currentSampleRate = sampleRate;
      this.currentGain = gain;
      this.streaming = true;
      return true;
    } catch {
      return false;
    }
  }

  stopRtlTcp() {
    if (this.rtlTcpProcess) {
      this.rtlTcpProcess.kill('SIGTERM');
      this.rtlTcpProcess = null;
    }
    this.streaming = false;
  }

  tune(frequency: number) {
    this.currentFreq = frequency;
    // If rtl_tcp is running, we'd need to restart or use the TCP control protocol
    if (this.streaming) {
      this.startRtlTcp(frequency, this.currentSampleRate, this.currentGain);
    }
  }

  setGain(gain: number) {
    this.currentGain = gain;
  }

  setSampleRate(rate: number) {
    this.currentSampleRate = rate;
  }

  getState() {
    return {
      streaming: this.streaming,
      frequency: this.currentFreq,
      gain: this.currentGain,
      sampleRate: this.currentSampleRate,
    };
  }

  stop() {
    this.stopRtlTcp();
  }
}

// ============================================================================
// Audio Capture
// ============================================================================
class AudioCapture {
  private process: ChildProcess | null = null;
  private streaming = false;
  private device: string | null = null;

  detectDevice(): string | null {
    try {
      const output = execSync('arecord -l 2>/dev/null', { encoding: 'utf8' });
      if (output.includes('card')) {
        const match = output.match(/card (\d+).*device (\d+)/);
        if (match) {
          this.device = `hw:${match[1]},${match[2]}`;
          return this.device;
        }
      }
    } catch { /* no audio device */ }
    return null;
  }

  startCapture(onData: (buf: Buffer) => void): boolean {
    if (!this.device) return false;
    
    try {
      this.process = spawn('arecord', [
        '-D', this.device,
        '-f', 'S16_LE',
        '-r', '48000',
        '-c', '1',
        '-t', 'raw',
        '-',
      ]);

      this.process.stdout?.on('data', onData);
      this.process.on('exit', () => { this.streaming = false; this.process = null; });
      this.streaming = true;
      return true;
    } catch {
      return false;
    }
  }

  stopCapture() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.streaming = false;
  }

  isStreaming(): boolean { return this.streaming; }
  hasDevice(): boolean { return this.device !== null; }
}

// ============================================================================
// Hailo-8 Integration
// ============================================================================
class HailoIntegration {
  private available = false;

  detect(): boolean {
    try {
      execSync('hailortcli fw-control identify 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
      this.available = true;
    } catch {
      // Also check if Baywatch is running (indicates Hailo setup)
      try {
        execSync(`curl -sf ${BAYWATCH_URL}/health 2>/dev/null`, { timeout: 3000 });
        this.available = true;
      } catch {
        this.available = false;
      }
    }
    return this.available;
  }

  isAvailable(): boolean { return this.available; }

  async classify(imageUrl: string): Promise<unknown> {
    try {
      const resp = await fetch(`${BAYWATCH_URL}/api/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      return await resp.json();
    } catch (err) {
      return { error: String(err) };
    }
  }

  async lpr(imageUrl: string): Promise<unknown> {
    try {
      const resp = await fetch(`${BAYWATCH_URL}/api/lpr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      return await resp.json();
    } catch (err) {
      return { error: String(err) };
    }
  }

  getCapabilities(): string[] {
    if (!this.available) return [];
    return ['yolo-detection', 'license-plate-recognition', 'object-classification'];
  }
}

// ============================================================================
// Service Detection
// ============================================================================
async function detectServices(): Promise<{ baywatch: boolean; whisper: boolean; llama: boolean }> {
  const check = async (url: string): Promise<boolean> => {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch { return false; }
  };

  const [baywatch, whisper, llama] = await Promise.all([
    check(`${BAYWATCH_URL}/health`),
    check(`${WHISPER_URL}/health`),
    check(`${LLAMA_URL}/health`),
  ]);
  return { baywatch, whisper, llama };
}

// ============================================================================
// Edge Node Client
// ============================================================================
class EdgeNodeClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE;
  private connected = false;

  private gps = new GPSClient();
  private sdr = new SDRBridge();
  private audio = new AudioCapture();
  private hailo = new HailoIntegration();
  private capabilities: Capabilities = {
    sdr: false, gps: false, hailo: false, audio: false,
    baywatch: false, whisper: false, llama: false,
  };

  async init() {
    console.log('🔍 Detecting hardware and services...');
    
    // Detect hardware
    this.sdr.detectDevices();
    this.audio.detectDevice();
    this.hailo.detect();
    this.gps.start();
    
    // Detect services
    const services = await detectServices();
    
    this.capabilities = {
      sdr: this.sdr.getDevices().length > 0 && this.sdr.getDevices()[0]?.type !== 'demo',
      gps: this.gps.isAvailable(),
      hailo: this.hailo.isAvailable(),
      audio: this.audio.hasDevice(),
      baywatch: services.baywatch,
      whisper: services.whisper,
      llama: services.llama,
    };

    console.log('📋 Capabilities:');
    console.log(`   SDR:      ${this.capabilities.sdr ? '✅' : '❌'} (${this.sdr.getDevices().length} devices)`);
    console.log(`   GPS:      ${this.capabilities.gps ? '✅' : '❌'}`);
    console.log(`   Hailo-8:  ${this.capabilities.hailo ? '✅' : '❌'}`);
    console.log(`   Audio:    ${this.capabilities.audio ? '✅' : '❌'}`);
    console.log(`   Baywatch: ${this.capabilities.baywatch ? '✅' : '❌'}`);
    console.log(`   Whisper:  ${this.capabilities.whisper ? '✅' : '❌'}`);
    console.log(`   Llama:    ${this.capabilities.llama ? '✅' : '❌'}`);
  }

  connect() {
    const url = `${SERVER_URL}?edge=true&nodeId=${encodeURIComponent(NODE_ID)}`;
    console.log(`\n🔗 Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error('❌ Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('✅ Connected to SignalForge server');
      this.connected = true;
      this.reconnectDelay = RECONNECT_BASE; // Reset backoff
      this.register();
      this.startHeartbeat();
      this.startTelemetry();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch {
        // Could be binary IQ data
      }
    });

    this.ws.on('close', (code) => {
      console.log(`❌ Disconnected (code: ${code})`);
      this.connected = false;
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('⚠️ WebSocket error:', err.message);
    });

    this.ws.on('ping', () => {
      this.ws?.pong();
    });
  }

  private register() {
    const capList: string[] = [];
    if (this.capabilities.sdr) capList.push('sdr', 'spectrum', 'record');
    if (this.capabilities.gps) capList.push('gps');
    if (this.capabilities.hailo) capList.push('hailo', 'yolo', 'lpr');
    if (this.capabilities.audio) capList.push('audio-capture');
    if (this.capabilities.baywatch) capList.push('baywatch');
    if (this.capabilities.whisper) capList.push('whisper', 'speech-to-text');
    if (this.capabilities.llama) capList.push('llama', 'llm');
    capList.push('telemetry'); // Always available

    const position = this.gps.getPosition();

    const info = {
      name: NODE_NAME,
      hostname: os.hostname(),
      ip: this.getLocalIP(),
      system: getSystemInfo(),
      network: getNetworkInfo(),
      sdrDevices: this.sdr.getDevices(),
      capabilities: capList,
      hasGPS: this.capabilities.gps,
      hasHailo: this.capabilities.hailo,
      location: position ? {
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude,
        source: position.source,
      } : undefined,
      services: {
        baywatch: this.capabilities.baywatch,
        whisper: this.capabilities.whisper,
        llama: this.capabilities.llama,
      },
      version: '1.0.0',
    };

    this.send({ type: 'edge_register', info });
    console.log(`📡 Registered as: ${NODE_NAME} (${NODE_ID})`);
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'edge_heartbeat',
        heartbeat: {
          nodeId: NODE_ID,
          timestamp: Date.now(),
          system: getSystemInfo(),
          sdrDevices: this.sdr.getDevices(),
          location: this.gps.getPosition() || undefined,
        },
      });
    }, HEARTBEAT_INTERVAL);
  }

  private startTelemetry() {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    // Send detailed telemetry less frequently
    this.telemetryTimer = setInterval(() => {
      this.send({
        type: 'edge_telemetry',
        telemetry: {
          nodeId: NODE_ID,
          timestamp: Date.now(),
          system: getSystemInfo(),
          network: getNetworkInfo(),
          gps: this.gps.getPosition(),
          sdr: this.sdr.getState(),
          capabilities: this.capabilities,
        },
      });
    }, TELEMETRY_INTERVAL);
  }

  private async handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    if (type === 'edge_command') {
      const cmd = msg.command as { type: string; params: Record<string, unknown>; id: string };
      console.log(`📥 Command [${cmd.id}]: ${cmd.type}`, cmd.params || {});
      
      let result: unknown;
      let success = true;

      try {
        switch (cmd.type) {
          case 'tune':
            this.sdr.tune(cmd.params.frequency as number);
            result = { frequency: cmd.params.frequency };
            break;

          case 'start_stream':
            success = this.sdr.startRtlTcp(
              (cmd.params.frequency as number) || 100_000_000,
              (cmd.params.sampleRate as number) || 2_048_000,
              (cmd.params.gain as number) || 40,
            );
            result = success ? this.sdr.getState() : { error: 'Failed to start rtl_tcp' };
            break;

          case 'stop_stream':
            this.sdr.stopRtlTcp();
            result = { stopped: true };
            break;

          case 'set_gain':
            this.sdr.setGain(cmd.params.gain as number);
            result = { gain: cmd.params.gain };
            break;

          case 'set_sample_rate':
            this.sdr.setSampleRate(cmd.params.sampleRate as number);
            result = { sampleRate: cmd.params.sampleRate };
            break;

          case 'start_audio':
            if (!this.capabilities.audio) {
              success = false;
              result = { error: 'No audio device' };
            } else {
              success = this.audio.startCapture((buf) => {
                // Send raw audio as binary frame
                if (this.ws?.readyState === WebSocket.OPEN) {
                  this.ws.send(buf);
                }
              });
              result = { streaming: success };
            }
            break;

          case 'stop_audio':
            this.audio.stopCapture();
            result = { stopped: true };
            break;

          case 'classify':
            if (!this.capabilities.hailo && !this.capabilities.baywatch) {
              success = false;
              result = { error: 'No AI capability' };
            } else {
              result = await this.hailo.classify(cmd.params.imageUrl as string);
            }
            break;

          case 'lpr':
            if (!this.capabilities.baywatch) {
              success = false;
              result = { error: 'No LPR capability' };
            } else {
              result = await this.hailo.lpr(cmd.params.imageUrl as string);
            }
            break;

          case 'whisper':
            if (!this.capabilities.whisper) {
              success = false;
              result = { error: 'No Whisper capability' };
            } else {
              try {
                const resp = await fetch(`${WHISPER_URL}/transcribe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(cmd.params),
                });
                result = await resp.json();
              } catch (err) {
                success = false;
                result = { error: String(err) };
              }
            }
            break;

          case 'llm':
            if (!this.capabilities.llama) {
              success = false;
              result = { error: 'No LLM capability' };
            } else {
              try {
                const resp = await fetch(`${LLAMA_URL}/completion`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: cmd.params.prompt, ...cmd.params }),
                });
                result = await resp.json();
              } catch (err) {
                success = false;
                result = { error: String(err) };
              }
            }
            break;

          case 'get_status':
            result = {
              system: getSystemInfo(),
              network: getNetworkInfo(),
              gps: this.gps.getPosition(),
              sdr: this.sdr.getState(),
              capabilities: this.capabilities,
            };
            break;

          case 'reboot':
            console.log('🔄 Reboot requested!');
            result = { rebooting: true };
            this.send({ type: 'edge_command_result', commandId: cmd.id, success: true, result });
            setTimeout(() => {
              try { execSync('sudo reboot'); } catch { /* */ }
            }, 2000);
            return;

          default:
            success = false;
            result = { error: `Unknown command: ${cmd.type}` };
        }
      } catch (err) {
        success = false;
        result = { error: String(err) };
      }

      // Send result back
      this.send({
        type: 'edge_command_result',
        commandId: cmd.id,
        success,
        result,
      });
    }
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private cleanup() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.telemetryTimer) { clearInterval(this.telemetryTimer); this.telemetryTimer = null; }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`🔄 Reconnecting in ${(this.reconnectDelay / 1000).toFixed(1)}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    // Exponential backoff with jitter
    this.reconnectDelay = Math.min(this.reconnectDelay * 2 + Math.random() * 1000, RECONNECT_MAX);
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    // Prefer ZeroTier IP
    for (const [name, ifaces] of Object.entries(interfaces)) {
      if (!ifaces || !name.startsWith('zt')) continue;
      for (const info of ifaces) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
    // Fall back to any non-internal IPv4
    for (const ifaces of Object.values(interfaces)) {
      if (!ifaces) continue;
      for (const info of ifaces) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
    return '0.0.0.0';
  }

  shutdown() {
    console.log('\n🛑 Shutting down...');
    this.cleanup();
    this.sdr.stop();
    this.audio.stopCapture();
    this.gps.stop();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}

// ============================================================================
// Main
// ============================================================================
console.log(`
  📡 ╔═══════════════════════════════════════╗
  📡 ║    SignalForge Edge Node v1.0.0       ║
  📡 ╠═══════════════════════════════════════╣
  📡 ║  Node:   ${NODE_NAME.padEnd(28)}║
  📡 ║  ID:     ${NODE_ID.slice(0, 28).padEnd(28)}║
  📡 ║  Server: ${SERVER_URL.slice(0, 28).padEnd(28)}║
  📡 ╚═══════════════════════════════════════╝
`);

const client = new EdgeNodeClient();

// Graceful shutdown
process.on('SIGTERM', () => { client.shutdown(); process.exit(0); });
process.on('SIGINT', () => { client.shutdown(); process.exit(0); });

(async () => {
  await client.init();
  client.connect();
})();
