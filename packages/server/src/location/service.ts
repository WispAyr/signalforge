import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import type { ObserverLocation, LocationSettings, LocationSource, GPSConfig, StarlinkConfig } from '@signalforge/shared';
import { DEFAULT_LOCATION_SETTINGS } from '@signalforge/shared';

const SETTINGS_FILE = path.join(process.cwd(), 'data', 'location-settings.json');

/**
 * Location Service — manages observer position from multiple sources.
 * Sources: manual, browser (client-side), hardware GPS (NMEA/gpsd), Starlink dish.
 */
export class LocationService extends EventEmitter {
  private settings: LocationSettings;
  private gpsdClient: net.Socket | null = null;
  private starlinkTimer: ReturnType<typeof setInterval> | null = null;
  private serialParser: NMEAParser | null = null;

  constructor() {
    super();
    this.settings = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private load(): LocationSettings {
    try {
      const dir = path.dirname(SETTINGS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        return { ...DEFAULT_LOCATION_SETTINGS, ...data };
      }
    } catch (err) {
      console.error('⚠️ Failed to load location settings:', err);
    }
    return { ...DEFAULT_LOCATION_SETTINGS };
  }

  private save() {
    try {
      const dir = path.dirname(SETTINGS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      console.error('⚠️ Failed to save location settings:', err);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  getSettings(): LocationSettings {
    return { ...this.settings };
  }

  getObserver(): ObserverLocation {
    return { ...this.settings.observer };
  }

  /** Set observer location from any source */
  setLocation(loc: Partial<ObserverLocation> & { latitude: number; longitude: number }) {
    this.settings.observer = {
      ...this.settings.observer,
      ...loc,
      lastUpdated: new Date().toISOString(),
    };
    this.save();
    this.emit('location', this.settings.observer);
    console.log(`📍 Observer location updated: ${this.settings.observer.name || ''} ${loc.latitude.toFixed(4)}°, ${loc.longitude.toFixed(4)}° (${loc.source || this.settings.source})`);
  }

  /** Set the active location source and configure it */
  setSource(source: LocationSource, config?: { gps?: Partial<GPSConfig>; starlink?: Partial<StarlinkConfig> }) {
    this.settings.source = source;

    if (config?.gps) {
      this.settings.gps = { ...this.settings.gps, ...config.gps };
    }
    if (config?.starlink) {
      this.settings.starlink = { ...this.settings.starlink, ...config.starlink };
    }

    this.save();

    // Stop existing sources
    this.stopGPS();
    this.stopStarlink();

    // Start requested source
    if (source === 'gps' || source === 'auto') {
      this.startGPS();
    }
    if (source === 'starlink' || source === 'auto') {
      this.startStarlink();
    }

    this.emit('source_changed', source);
  }

  /** Update full settings object */
  updateSettings(partial: Partial<LocationSettings>) {
    if (partial.observer) this.setLocation(partial.observer);
    if (partial.source !== undefined || partial.gps || partial.starlink) {
      this.setSource(partial.source || this.settings.source, { gps: partial.gps, starlink: partial.starlink });
    }
  }

  // ── GPS Hardware (NMEA via gpsd or serial) ───────────────────────────

  startGPS() {
    const cfg = this.settings.gps;
    if (!cfg.enabled && this.settings.source !== 'auto') return;

    if (cfg.type === 'gpsd') {
      this.connectGPSD(cfg.gpsdHost || '127.0.0.1', cfg.gpsdPort || 2947);
    } else if (cfg.type === 'serial') {
      this.connectSerial(cfg.serialPort || '/dev/ttyUSB0', cfg.serialBaud || 9600);
    }
  }

  private connectGPSD(host: string, port: number) {
    this.gpsdClient = new net.Socket();

    this.gpsdClient.connect(port, host, () => {
      console.log(`🛰️ GPS: Connected to gpsd at ${host}:${port}`);
      // Request JSON streaming mode
      this.gpsdClient?.write('?WATCH={"enable":true,"json":true}\n');
    });

    let buffer = '';
    this.gpsdClient.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.class === 'TPV' && msg.lat !== undefined && msg.lon !== undefined) {
            this.setLocation({
              latitude: msg.lat,
              longitude: msg.lon,
              altitude: msg.altMSL || msg.alt || 0,
              source: 'gps',
              accuracy: msg.epx ? Math.sqrt(msg.epx * msg.epx + msg.epy * msg.epy) : undefined,
              name: `GPS ${msg.lat.toFixed(4)}°, ${msg.lon.toFixed(4)}°`,
            });
          }
        } catch { /* not JSON line */ }
      }
    });

    this.gpsdClient.on('error', (err) => {
      console.log(`🛰️ GPS: gpsd connection failed (${err.message})`);
    });

    this.gpsdClient.on('close', () => {
      console.log('🛰️ GPS: gpsd disconnected');
      this.gpsdClient = null;
    });
  }

  private connectSerial(port: string, baud: number) {
    // Use net socket for simplicity — in production use serialport package
    // For now, try to read NMEA from a TCP-forwarded serial port or file
    console.log(`🛰️ GPS: Serial ${port} @ ${baud} baud (stub — install serialport package for hardware GPS)`);
    this.serialParser = new NMEAParser((lat, lon, alt) => {
      this.setLocation({
        latitude: lat,
        longitude: lon,
        altitude: alt,
        source: 'gps',
        name: `GPS ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`,
      });
    });
  }

  stopGPS() {
    if (this.gpsdClient) {
      this.gpsdClient.destroy();
      this.gpsdClient = null;
    }
    this.serialParser = null;
  }

  // ── Starlink GPS ─────────────────────────────────────────────────────

  startStarlink() {
    const cfg = this.settings.starlink;
    if (!cfg.enabled && this.settings.source !== 'auto') return;

    console.log(`🛰️ Starlink: Polling ${cfg.host} every ${cfg.pollIntervalMs}ms`);
    this.pollStarlink();
    this.starlinkTimer = setInterval(() => this.pollStarlink(), cfg.pollIntervalMs);
  }

  private async pollStarlink() {
    const host = this.settings.starlink.host;
    try {
      // Starlink exposes location via the debug/status API
      // Try the HTTP status endpoint first (newer firmware)
      const response = await fetchWithTimeout(`http://${host}/api/location`, 5000);
      if (response) {
        const data = JSON.parse(response);
        if (data.latitude && data.longitude) {
          this.setLocation({
            latitude: data.latitude,
            longitude: data.longitude,
            altitude: data.altitude || data.alt || 0,
            source: 'starlink',
            name: 'Starlink Dish',
          });
          return;
        }
      }
    } catch { /* HTTP endpoint not available */ }

    try {
      // Try the gRPC-web status page (older firmware pattern)
      // The dish status page at 192.168.100.1 sometimes exposes location in device info
      const response = await fetchWithTimeout(`http://${host}/api/v1/device/status`, 5000);
      if (response) {
        const data = JSON.parse(response);
        // Look for GPS data in various possible locations
        const gps = data?.dishGetStatus?.gpsStats || data?.gpsStats || data?.deviceInfo?.gps;
        if (gps?.latitude && gps?.longitude) {
          this.setLocation({
            latitude: gps.latitude,
            longitude: gps.longitude,
            altitude: gps.altitude || 0,
            source: 'starlink',
            name: 'Starlink Dish',
          });
          return;
        }
      }
    } catch { /* gRPC endpoint not available */ }

    // Note: Full Starlink gRPC requires grpc-js + protobuf definitions from spacex.api.device
    // For now, the HTTP endpoints above cover common setups
    // To add full gRPC: npm install @grpc/grpc-js google-protobuf
    // Then import the SpaceX protobufs from https://github.com/sparky8512/starlink-grpc-tools
  }

  stopStarlink() {
    if (this.starlinkTimer) {
      clearInterval(this.starlinkTimer);
      this.starlinkTimer = null;
    }
  }

  // ── Startup ──────────────────────────────────────────────────────────

  start() {
    const src = this.settings.source;
    console.log(`📍 Location service started (source: ${src}, ${this.settings.observer.latitude.toFixed(4)}°N ${Math.abs(this.settings.observer.longitude).toFixed(4)}°W — ${this.settings.observer.name || 'unnamed'})`);

    if (src === 'gps' || src === 'auto') this.startGPS();
    if (src === 'starlink' || src === 'auto') this.startStarlink();
  }

  stop() {
    this.stopGPS();
    this.stopStarlink();
  }
}

// ── NMEA Parser (minimal GGA/RMC) ─────────────────────────────────────

class NMEAParser {
  constructor(private onFix: (lat: number, lon: number, alt: number) => void) {}

  parse(sentence: string) {
    if (!sentence.startsWith('$')) return;
    const parts = sentence.split(',');

    if (parts[0] === '$GPGGA' || parts[0] === '$GNGGA') {
      const lat = this.parseNMEACoord(parts[2], parts[3]);
      const lon = this.parseNMEACoord(parts[4], parts[5]);
      const alt = parseFloat(parts[9]) || 0;
      if (lat !== null && lon !== null) {
        this.onFix(lat, lon, alt);
      }
    } else if (parts[0] === '$GPRMC' || parts[0] === '$GNRMC') {
      if (parts[2] === 'A') { // Active fix
        const lat = this.parseNMEACoord(parts[3], parts[4]);
        const lon = this.parseNMEACoord(parts[5], parts[6]);
        if (lat !== null && lon !== null) {
          this.onFix(lat, lon, 0);
        }
      }
    }
  }

  private parseNMEACoord(value: string, dir: string): number | null {
    if (!value || !dir) return null;
    const num = parseFloat(value);
    const degrees = Math.floor(num / 100);
    const minutes = num - degrees * 100;
    let result = degrees + minutes / 60;
    if (dir === 'S' || dir === 'W') result = -result;
    return result;
  }
}

// ── Utility ────────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
