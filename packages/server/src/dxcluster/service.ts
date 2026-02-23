import { EventEmitter } from 'events';
import * as net from 'net';
import type { DXSpot, DXClusterConfig, DXFilter, DXSpotAlert } from '@signalforge/shared';

const DX_HOSTS = [
  { host: 'dxc.nc7j.com', port: 7300 },
  { host: 'dxc.ve7cc.net', port: 23 },
];
const CALLSIGN = 'SFORG';
const RECONNECT_DELAY = 30000;

export class DXClusterService extends EventEmitter {
  private config: DXClusterConfig = {
    connected: false,
    host: DX_HOSTS[0].host,
    port: DX_HOSTS[0].port,
    callsign: CALLSIGN,
    filters: [],
  };
  private spots: DXSpot[] = [];
  private alerts: DXSpotAlert[] = [];
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private socket: net.Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = '';
  private hostIndex = 0;
  private useLive = false;
  private loginSent = false;

  connect(host?: string, port?: number, callsign?: string): DXClusterConfig {
    if (host) this.config.host = host;
    if (port) this.config.port = port;
    if (callsign) this.config.callsign = callsign;
    this.connectLive();
    return this.config;
  }

  disconnect(): DXClusterConfig {
    this.config.connected = false;
    this.useLive = false;
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopDemo();
    this.emit('disconnected');
    return this.config;
  }

  getConfig(): DXClusterConfig { return this.config; }
  getSpots(limit = 100): DXSpot[] { return this.spots.slice(0, limit); }
  getAlerts(): DXSpotAlert[] { return this.alerts; }
  isLive(): boolean { return this.useLive; }

  addFilter(filter: Omit<DXFilter, 'id'>): DXFilter {
    const f: DXFilter = { ...filter, id: `df-${Date.now()}` };
    this.config.filters.push(f);
    return f;
  }

  removeFilter(id: string) {
    this.config.filters = this.config.filters.filter(f => f.id !== id);
  }

  addAlert(alert: Omit<DXSpotAlert, 'id'>): DXSpotAlert {
    const a: DXSpotAlert = { ...alert, id: `da-${Date.now()}` };
    this.alerts.push(a);
    return a;
  }

  removeAlert(id: string) {
    this.alerts = this.alerts.filter(a => a.id !== id);
  }

  // ── Real telnet connection ──
  private connectLive() {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    this.loginSent = false;
    this.buffer = '';

    const { host, port } = this.config;
    console.log(`🌍 DX Cluster connecting to ${host}:${port}...`);

    const sock = new net.Socket();
    this.socket = sock;
    sock.setTimeout(120000);

    sock.connect(port, host, () => {
      console.log(`🌍 DX Cluster connected to ${host}:${port}`);
      this.config.connected = true;
      this.useLive = true;
      this.emit('connected', this.config);
      // Stop demo
      this.stopDemo();
    });

    sock.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf-8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Login prompt detection — send callsign
        const lower = trimmed.toLowerCase();
        if (!this.loginSent && (lower.includes('login') || lower.includes('call') || lower.includes('please enter'))) {
          sock.write(this.config.callsign + '\r\n');
          this.loginSent = true;
          console.log(`🌍 DX Cluster logged in as ${this.config.callsign}`);
          continue;
        }

        // Parse DX spots
        const spot = this.parseSpotLine(trimmed);
        if (spot) {
          this.spots.unshift(spot);
          if (this.spots.length > 1000) this.spots.length = 1000;
          this.checkAlerts(spot);
          this.emit('spot', spot);
        }
      }
    });

    sock.on('timeout', () => {
      console.log('🌍 DX Cluster timeout — reconnecting');
      sock.destroy();
    });

    sock.on('error', (err) => {
      console.log(`🌍 DX Cluster error: ${err.message}`);
    });

    sock.on('close', () => {
      console.log('🌍 DX Cluster disconnected');
      this.config.connected = false;
      this.socket = null;

      if (!this.demoInterval) {
        console.log('🌍 Falling back to demo DX spots');
        this.useLive = false;
        this.startDemo();
      }

      // Try next host
      this.hostIndex = (this.hostIndex + 1) % DX_HOSTS.length;
      this.config.host = DX_HOSTS[this.hostIndex].host;
      this.config.port = DX_HOSTS[this.hostIndex].port;

      this.reconnectTimer = setTimeout(() => this.connectLive(), RECONNECT_DELAY);
    });
  }

  // ── Parse DX spot line ──
  // Format: DX de SPOTTER:     FREQ  DXCALL       comment                 HHMM
  private parseSpotLine(line: string): DXSpot | null {
    // Standard: "DX de G4ABC:     14025.0  3B8CF        CQ DX                  1423Z"
    const match = line.match(/^DX\s+de\s+(\S+?):\s+([\d.]+)\s+(\S+)\s+(.*?)\s+(\d{4})Z?\s*$/i);
    if (!match) return null;

    const [, spotter, freqStr, dxCall, comment, timeStr] = match;
    const frequency = parseFloat(freqStr) * 1000; // kHz to Hz

    // Detect mode from frequency/comment
    let mode: string | undefined;
    const commentUpper = comment.toUpperCase();
    if (commentUpper.includes('FT8')) mode = 'FT8';
    else if (commentUpper.includes('FT4')) mode = 'FT4';
    else if (commentUpper.includes('CW')) mode = 'CW';
    else if (commentUpper.includes('SSB') || commentUpper.includes('LSB') || commentUpper.includes('USB')) mode = 'SSB';
    else if (commentUpper.includes('RTTY')) mode = 'RTTY';
    else if (commentUpper.includes('PSK')) mode = 'PSK31';
    else {
      // Guess from frequency offset within band
      const kHz = parseFloat(freqStr);
      if (kHz < 30000) {
        // HF: low end = CW, middle = digital, upper = SSB
        const bandBase = this.getBandBase(kHz);
        if (bandBase > 0) {
          const offset = kHz - bandBase;
          if (offset < 50) mode = 'CW';
          else if (offset < 100) mode = 'RTTY';
        }
      }
    }

    const spot: DXSpot = {
      id: `dx-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      spotter: spotter.replace(/:$/, ''),
      spotted: dxCall,
      frequency,
      mode,
      comment: comment.trim(),
      timestamp: Date.now(),
    };

    return spot;
  }

  private getBandBase(kHz: number): number {
    if (kHz >= 1800 && kHz <= 2000) return 1800;
    if (kHz >= 3500 && kHz <= 4000) return 3500;
    if (kHz >= 7000 && kHz <= 7300) return 7000;
    if (kHz >= 10100 && kHz <= 10150) return 10100;
    if (kHz >= 14000 && kHz <= 14350) return 14000;
    if (kHz >= 18068 && kHz <= 18168) return 18068;
    if (kHz >= 21000 && kHz <= 21450) return 21000;
    if (kHz >= 24890 && kHz <= 24990) return 24890;
    if (kHz >= 28000 && kHz <= 29700) return 28000;
    if (kHz >= 50000 && kHz <= 54000) return 50000;
    return 0;
  }

  private checkAlerts(spot: DXSpot) {
    for (const alert of this.alerts) {
      if (!alert.enabled) continue;
      if (alert.conditions.entities?.includes(spot.entity || '')) {
        this.emit('spot_alert', { alert, spot });
      }
      if (alert.conditions.callsignPatterns?.some(p => spot.spotted.includes(p))) {
        this.emit('spot_alert', { alert, spot });
      }
    }
  }

  // ── Demo fallback ──
  private startDemo() {
    if (this.demoInterval) return;
    const spotters = ['G4ABC', 'DL1XYZ', 'W1AW', 'JA1ABC', 'VK2DEF', 'ZL1GHI', 'F5JKL', 'I2MNO'];
    const spotted = ['3B8CF', 'VP8LP', 'ZD7BG', 'A71A', 'JY5HX', 'P29VCX', 'V51WH', 'T32AZ', 'KH1/K7A', 'ZS8Z'];
    const entities = ['Mauritius', 'Falkland Is.', 'St Helena', 'Qatar', 'Jordan', 'Papua New Guinea', 'Namibia', 'Kiribati', 'Baker Howland Is.', 'Prince Edward & Marion Is.'];
    const continents = ['AF', 'SA', 'AF', 'AS', 'AS', 'OC', 'AF', 'OC', 'OC', 'AF'];
    const bands = [1.8, 3.5, 7.0, 10.1, 14.0, 18.068, 21.0, 24.89, 28.0, 50.0];
    const modes = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY'];

    this.demoInterval = setInterval(() => {
      if (!this.config.connected && !this.useLive) {
        // In demo mode, auto-mark as connected
        this.config.connected = true;
      }
      const idx = Math.floor(Math.random() * spotted.length);
      const bandIdx = Math.floor(Math.random() * bands.length);
      const freq = bands[bandIdx] + Math.random() * 0.3;

      const spot: DXSpot = {
        id: `dx-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        spotter: spotters[Math.floor(Math.random() * spotters.length)],
        spotted: spotted[idx],
        frequency: freq * 1e6,
        mode: modes[Math.floor(Math.random() * modes.length)],
        comment: `${Math.floor(-50 - Math.random() * 30)} dB ${Math.floor(15 + Math.random() * 20)} WPM`,
        timestamp: Date.now(),
        entity: entities[idx],
        continent: continents[idx],
        cqZone: Math.floor(Math.random() * 40) + 1,
        ituZone: Math.floor(Math.random() * 75) + 1,
        isRare: Math.random() > 0.7,
      };

      this.spots.unshift(spot);
      if (this.spots.length > 1000) this.spots.length = 1000;
      this.checkAlerts(spot);
      this.emit('spot', spot);
    }, 8000);
  }

  private stopDemo() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
  }
}
