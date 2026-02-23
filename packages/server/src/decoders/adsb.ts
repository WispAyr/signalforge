import { EventEmitter } from 'events';
import * as net from 'net';
import type { ADSBMessage, Aircraft } from '@signalforge/shared';

/**
 * ADS-B Decoder — parses BaseStation (SBS-1) format from dump1090 port 30003
 * Fallback chain: dump1090 → OpenSky Network API → demo mode
 */
export class ADSBDecoder extends EventEmitter {
  private aircraft: Map<string, Aircraft> = new Map();
  private client: net.Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private openSkyTimer: ReturnType<typeof setInterval> | null = null;
  private mode: 'dump1090' | 'opensky' | 'demo' = 'demo';

  constructor(private host: string = '127.0.0.1', private port: number = 30003) {
    super();
  }

  start() {
    this.connect();
    setInterval(() => this.cleanup(), 30000);
  }

  stop() {
    if (this.client) { this.client.destroy(); this.client = null; }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.openSkyTimer) clearInterval(this.openSkyTimer);
    if (this.demoInterval) clearInterval(this.demoInterval);
    this.connected = false;
  }

  private connect() {
    this.client = new net.Socket();
    this.client.setTimeout(5000);

    this.client.connect(this.port, this.host, () => {
      this.connected = true;
      this.mode = 'dump1090';
      console.log(`✈️  ADS-B connected to ${this.host}:${this.port} [LIVE - dump1090]`);
      this.emit('connected');
    });

    let buffer = '';
    this.client.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) this.parseSBS(line.trim());
      }
    });

    this.client.on('error', () => {
      this.connected = false;
    });

    this.client.on('timeout', () => {
      this.client?.destroy();
    });

    this.client.on('close', () => {
      this.connected = false;
      // Try OpenSky before falling back to demo
      this.startOpenSkyFeed();
    });
  }

  private parseSBS(line: string) {
    const parts = line.split(',');
    if (parts[0] !== 'MSG') return;

    const icao = parts[4]?.trim();
    if (!icao) return;

    const msg: ADSBMessage = {
      icao,
      messageType: parts[1],
      timestamp: Date.now(),
    };

    if (parts[10]?.trim()) msg.callsign = parts[10].trim();
    if (parts[11]?.trim()) msg.altitude = parseInt(parts[11]);
    if (parts[12]?.trim()) msg.speed = parseFloat(parts[12]);
    if (parts[13]?.trim()) msg.heading = parseFloat(parts[13]);
    if (parts[14]?.trim() && parts[15]?.trim()) {
      msg.latitude = parseFloat(parts[14]);
      msg.longitude = parseFloat(parts[15]);
    }
    if (parts[16]?.trim()) msg.verticalRate = parseInt(parts[16]);
    if (parts[17]?.trim()) msg.squawk = parts[17].trim();
    if (parts[21]?.trim()) msg.onGround = parts[21].trim() === '-1';

    this.updateAircraft(msg);
    this.emit('message', msg);
  }

  // --- OpenSky Network API fallback ---
  private async startOpenSkyFeed() {
    console.log('✈️  ADS-B: No dump1090, trying OpenSky Network API...');

    // Bounding box ~200km around Ayr (55.46, -4.63)
    const lamin = 53.66, lamax = 57.26, lomin = -7.63, lomax = -1.63;
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OpenSky returned ${res.status}`);
      const data = await res.json() as { states: any[] | null };
      if (!data.states || data.states.length === 0) throw new Error('No aircraft from OpenSky');

      this.mode = 'opensky';
      console.log(`✈️  ADS-B: OpenSky Network connected [LIVE - ${data.states.length} aircraft]`);
      this.processOpenSkyStates(data.states);

      // Poll every 12 seconds (respecting 10s rate limit)
      this.openSkyTimer = setInterval(async () => {
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          const d = await r.json() as { states: any[] | null };
          if (d.states) this.processOpenSkyStates(d.states);
        } catch {
          // Silently retry next interval
        }
      }, 12000);
    } catch (err: any) {
      console.log(`✈️  ADS-B: OpenSky unavailable (${err.message}), falling back to demo mode`);
      this.startDemoMode();
    }
  }

  private processOpenSkyStates(states: any[]) {
    for (const s of states) {
      // OpenSky state vector: [icao24, callsign, origin_country, time_position, last_contact,
      //   longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate,
      //   sensors, geo_altitude, squawk, spi, position_source, ...]
      const icao = (s[0] as string)?.toUpperCase();
      if (!icao) continue;

      const lat = s[6] as number | null;
      const lon = s[5] as number | null;
      if (lat == null || lon == null) continue;

      const msg: ADSBMessage = {
        icao,
        callsign: (s[1] as string)?.trim() || undefined,
        latitude: lat,
        longitude: lon,
        altitude: s[7] != null ? Math.round((s[7] as number) * 3.28084) : undefined, // m→ft
        onGround: s[8] as boolean,
        speed: s[9] != null ? Math.round((s[9] as number) * 1.94384) : undefined, // m/s→knots
        heading: s[10] as number | undefined,
        verticalRate: s[11] != null ? Math.round((s[11] as number) * 196.85) : undefined, // m/s→ft/min
        squawk: s[14] as string | undefined,
        messageType: '3',
        timestamp: Date.now(),
      };

      this.updateAircraft(msg);
      this.emit('message', msg);
    }
  }

  private updateAircraft(msg: ADSBMessage) {
    let ac = this.aircraft.get(msg.icao);
    if (!ac) {
      ac = { icao: msg.icao, lastSeen: Date.now(), messageCount: 0, trail: [] };
      this.aircraft.set(msg.icao, ac);
    }

    ac.lastSeen = msg.timestamp;
    ac.messageCount++;

    if (msg.callsign) ac.callsign = msg.callsign;
    if (msg.altitude !== undefined) ac.altitude = msg.altitude;
    if (msg.speed !== undefined) ac.speed = msg.speed;
    if (msg.heading !== undefined) ac.heading = msg.heading;
    if (msg.latitude !== undefined && msg.longitude !== undefined) {
      ac.latitude = msg.latitude;
      ac.longitude = msg.longitude;
      ac.trail.push({ lat: msg.latitude, lon: msg.longitude, alt: msg.altitude || 0, ts: msg.timestamp });
      if (ac.trail.length > 100) ac.trail.shift();
    }
    if (msg.verticalRate !== undefined) ac.verticalRate = msg.verticalRate;
    if (msg.squawk) ac.squawk = msg.squawk;
    if (msg.onGround !== undefined) ac.onGround = msg.onGround;
  }

  private cleanup() {
    const cutoff = Date.now() - 300000;
    for (const [icao, ac] of this.aircraft) {
      if (ac.lastSeen < cutoff) this.aircraft.delete(icao);
    }
  }

  getAircraft(): Aircraft[] {
    return Array.from(this.aircraft.values()).filter(a => a.latitude !== undefined);
  }

  getMode(): string { return this.mode; }
  isConnected() { return this.connected || this.mode === 'opensky'; }

  // Demo mode generates synthetic aircraft when no dump1090 or OpenSky is available
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private startDemoMode() {
    if (this.demoInterval) return;
    this.mode = 'demo';
    console.log('✈️  ADS-B: No dump1090 or OpenSky, running demo mode');

    const demoAircraft = [
      { icao: 'A0B1C2', callsign: 'BAW123', baseLat: 51.47, baseLon: -0.46, alt: 35000, speed: 450, heading: 135 },
      { icao: 'D3E4F5', callsign: 'RYR456', baseLat: 53.35, baseLon: -6.26, alt: 28000, speed: 420, heading: 220 },
      { icao: '400A1B', callsign: 'EZY789', baseLat: 55.95, baseLon: -3.37, alt: 38000, speed: 480, heading: 45 },
      { icao: '3C6712', callsign: 'SHT101', baseLat: 53.36, baseLon: -2.27, alt: 15000, speed: 350, heading: 180 },
      { icao: '780DEF', callsign: 'LOG202', baseLat: 57.20, baseLon: -5.80, alt: 6000, speed: 200, heading: 90 },
      { icao: 'AB12CD', callsign: 'TOM303', baseLat: 49.00, baseLon: -2.50, alt: 32000, speed: 460, heading: 310 },
    ];

    this.demoInterval = setInterval(() => {
      const t = Date.now() / 1000;
      for (const demo of demoAircraft) {
        const dLat = Math.sin(t * 0.001 + demo.heading) * 0.001;
        const dLon = Math.cos(t * 0.001 + demo.heading) * 0.001;
        const lat = demo.baseLat + dLat * (t % 600);
        const lon = demo.baseLon + dLon * (t % 600);

        const msg: ADSBMessage = {
          icao: demo.icao, callsign: demo.callsign,
          altitude: demo.alt + Math.sin(t * 0.01) * 200,
          speed: demo.speed + Math.sin(t * 0.02) * 10,
          heading: (demo.heading + Math.sin(t * 0.005) * 5 + 360) % 360,
          latitude: lat, longitude: lon,
          verticalRate: Math.round(Math.sin(t * 0.03) * 500),
          messageType: '3', timestamp: Date.now(),
        };
        this.updateAircraft(msg);
        this.emit('message', msg);
      }
    }, 2000);
  }
}
