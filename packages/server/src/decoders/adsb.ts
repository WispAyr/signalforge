import { EventEmitter } from 'events';
import * as net from 'net';
import type { ADSBMessage, Aircraft } from '@signalforge/shared';

/**
 * ADS-B Decoder — parses BaseStation (SBS-1) format from dump1090 port 30003
 * Format: MSG,type,sessionId,aircraftId,icao,flightId,dateGen,timeGen,dateLog,timeLog,callsign,alt,speed,heading,lat,lon,vertRate,squawk,alert,emergency,spi,onGround
 */
export class ADSBDecoder extends EventEmitter {
  private aircraft: Map<string, Aircraft> = new Map();
  private client: net.Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(private host: string = '127.0.0.1', private port: number = 30003) {
    super();
  }

  start() {
    this.connect();
    // Cleanup stale aircraft every 30s
    setInterval(() => this.cleanup(), 30000);
  }

  stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.connected = false;
  }

  private connect() {
    this.client = new net.Socket();
    this.client.connect(this.port, this.host, () => {
      this.connected = true;
      console.log(`✈️  ADS-B connected to ${this.host}:${this.port}`);
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

    this.client.on('close', () => {
      this.connected = false;
      // Generate demo data instead
      this.startDemoMode();
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
    const cutoff = Date.now() - 300000; // 5 min
    for (const [icao, ac] of this.aircraft) {
      if (ac.lastSeen < cutoff) this.aircraft.delete(icao);
    }
  }

  getAircraft(): Aircraft[] {
    return Array.from(this.aircraft.values()).filter(a => a.latitude !== undefined);
  }

  isConnected() { return this.connected; }

  // Demo mode generates synthetic aircraft when no dump1090 is available
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private startDemoMode() {
    if (this.demoInterval) return;
    console.log('✈️  ADS-B: No dump1090 found, running demo mode');

    const demoAircraft = [
      { icao: 'A0B1C2', callsign: 'BAW123', baseLat: 51.47, baseLon: -0.46, alt: 35000, speed: 450, heading: 135 },  // London Heathrow area
      { icao: 'D3E4F5', callsign: 'RYR456', baseLat: 53.35, baseLon: -6.26, alt: 28000, speed: 420, heading: 220 }, // Dublin
      { icao: '400A1B', callsign: 'EZY789', baseLat: 55.95, baseLon: -3.37, alt: 38000, speed: 480, heading: 45 },  // Edinburgh
      { icao: '3C6712', callsign: 'SHT101', baseLat: 53.36, baseLon: -2.27, alt: 15000, speed: 350, heading: 180 }, // Manchester
      { icao: '780DEF', callsign: 'LOG202', baseLat: 57.20, baseLon: -5.80, alt: 6000, speed: 200, heading: 90 },   // Highlands
      { icao: 'AB12CD', callsign: 'TOM303', baseLat: 49.00, baseLon: -2.50, alt: 32000, speed: 460, heading: 310 }, // Channel Islands
    ];

    this.demoInterval = setInterval(() => {
      const t = Date.now() / 1000;
      for (const demo of demoAircraft) {
        const dLat = Math.sin(t * 0.001 + demo.heading) * 0.001;
        const dLon = Math.cos(t * 0.001 + demo.heading) * 0.001;
        const lat = demo.baseLat + dLat * (t % 600);
        const lon = demo.baseLon + dLon * (t % 600);

        const msg: ADSBMessage = {
          icao: demo.icao,
          callsign: demo.callsign,
          altitude: demo.alt + Math.sin(t * 0.01) * 200,
          speed: demo.speed + Math.sin(t * 0.02) * 10,
          heading: (demo.heading + Math.sin(t * 0.005) * 5 + 360) % 360,
          latitude: lat,
          longitude: lon,
          verticalRate: Math.round(Math.sin(t * 0.03) * 500),
          messageType: '3',
          timestamp: Date.now(),
        };

        this.updateAircraft(msg);
        this.emit('message', msg);
      }
    }, 2000);
  }
}
