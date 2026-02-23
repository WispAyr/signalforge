import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { AISMessage, Vessel } from '@signalforge/shared';

const NAV_STATUSES: Record<number, string> = {
  0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
  3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored',
  6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
  15: 'Not defined',
};

const SHIP_TYPES: Record<number, string> = {
  30: 'Fishing', 31: 'Towing', 32: 'Towing (large)', 33: 'Dredging',
  34: 'Diving ops', 35: 'Military ops', 36: 'Sailing', 37: 'Pleasure craft',
  40: 'High speed craft', 50: 'Pilot vessel', 51: 'SAR vessel', 52: 'Tug',
  53: 'Port tender', 55: 'Law enforcement', 58: 'Medical transport',
  60: 'Passenger', 70: 'Cargo', 80: 'Tanker', 90: 'Other',
};

// AISStream.io API key
const AISSTREAM_API_KEY = 'b08eefa8987f4606684a685b3b81d755c5072f47';

// Bounding boxes: [SW corner, NE corner] as [lon, lat]
// UK/Ireland + North Sea + English Channel + Bay of Biscay approaches
const BOUNDING_BOXES = [
  [[49, -12], [62, 3]],    // UK, Ireland, North Sea, Norwegian approaches
  [[43, -6], [49, 0]],     // Bay of Biscay / Brittany approaches
];

/**
 * AIS Decoder — Priority chain:
 * 1. AISStream.io WebSocket (global, real-time, UK/European waters)
 * 2. Digitraffic API (Finnish waters, supplementary)
 * 3. Demo mode (fallback)
 */
export class AISDecoder extends EventEmitter {
  private vessels: Map<string, Vessel> = new Map();
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private digitrafficTimer: ReturnType<typeof setInterval> | null = null;
  private vesselMetadata: Map<string, any> = new Map();
  private aisStreamWs: WebSocket | null = null;
  private aisStreamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private mode: 'aisstream' | 'digitraffic' | 'demo' = 'demo';
  private messageCount = 0;

  start() {
    this.startAISStream();
    // Also start Digitraffic as supplementary (Finnish/Baltic waters)
    this.startDigitrafficFeed();
    setInterval(() => this.cleanup(), 60000);
  }

  stop() {
    if (this.demoInterval) clearInterval(this.demoInterval);
    if (this.digitrafficTimer) clearInterval(this.digitrafficTimer);
    if (this.aisStreamReconnectTimer) clearTimeout(this.aisStreamReconnectTimer);
    if (this.aisStreamWs) { try { this.aisStreamWs.close(); } catch {} }
  }

  getVessels(): Vessel[] {
    return Array.from(this.vessels.values()).filter(v => v.latitude !== undefined);
  }

  getMode(): string { return this.mode; }

  private updateVessel(msg: AISMessage) { if (this.vessels.size > 5000 && !this.vessels.has(msg.mmsi)) return; // cap at 5000
    let v = this.vessels.get(msg.mmsi);
    if (!v) {
      v = { mmsi: msg.mmsi, lastSeen: Date.now(), messageCount: 0, trail: [] };
      this.vessels.set(msg.mmsi, v);
    }
    v.lastSeen = msg.timestamp;
    v.messageCount++;

    if (msg.shipName) v.shipName = msg.shipName;
    if (msg.callSign) v.callSign = msg.callSign;
    if (msg.shipType !== undefined) { v.shipType = msg.shipType; v.shipTypeName = SHIP_TYPES[msg.shipType] || SHIP_TYPES[Math.floor(msg.shipType / 10) * 10] || 'Unknown'; }
    if (msg.latitude !== undefined && msg.longitude !== undefined) {
      v.latitude = msg.latitude;
      v.longitude = msg.longitude;
      v.trail.push({ lat: msg.latitude, lon: msg.longitude, ts: msg.timestamp });
      if (v.trail.length > 100) v.trail.shift();
    }
    if (msg.cog !== undefined) v.cog = msg.cog;
    if (msg.sog !== undefined) v.sog = msg.sog;
    if (msg.heading !== undefined) v.heading = msg.heading;
    if (msg.navStatus !== undefined) { v.navStatus = msg.navStatus; v.navStatusName = NAV_STATUSES[msg.navStatus]; }
    if (msg.destination) v.destination = msg.destination;
  }

  private cleanup() {
    const cutoff = Date.now() - 600000; // 10 min stale
    for (const [mmsi, v] of this.vessels) {
      if (v.lastSeen < cutoff) this.vessels.delete(mmsi);
    }
  }

  // ── AISStream.io WebSocket (PRIMARY) ──────────────────────────────────
  private startAISStream() {
    if (!AISSTREAM_API_KEY) {
      console.log('🚢 AIS: No AISStream API key, skipping');
      return;
    }

    console.log('🚢 AIS: Connecting to AISStream.io WebSocket...');

    try {
      this.aisStreamWs = new WebSocket('wss://stream.aisstream.io/v0/stream');

      this.aisStreamWs.on('open', () => {
        console.log('🚢 AIS: AISStream.io connected, subscribing to UK/European waters...');
        this.aisStreamWs!.send(JSON.stringify({
          Apikey: AISSTREAM_API_KEY,
          BoundingBoxes: BOUNDING_BOXES,
          FiltersShipMMSI: [],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardSearchAndRescueAircraftReport'],
        }));
        this.mode = 'aisstream';
      });

      this.aisStreamWs.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.processAISStreamMessage(msg);
        } catch {}
      });

      this.aisStreamWs.on('close', () => {
        console.log('🚢 AIS: AISStream.io disconnected, reconnecting in 10s...');
        this.scheduleAISStreamReconnect();
      });

      this.aisStreamWs.on('error', (err) => {
        console.error('🚢 AIS: AISStream.io error:', err.message);
        this.scheduleAISStreamReconnect();
      });

    } catch (err: any) {
      console.error('🚢 AIS: AISStream.io connection failed:', err.message);
      this.scheduleAISStreamReconnect();
    }
  }

  private scheduleAISStreamReconnect() {
    if (this.aisStreamReconnectTimer) return;
    this.aisStreamReconnectTimer = setTimeout(() => {
      this.aisStreamReconnectTimer = null;
      if (this.aisStreamWs) { try { this.aisStreamWs.close(); } catch {} }
      this.aisStreamWs = null;
      this.startAISStream();
    }, 10000);
  }

  private processAISStreamMessage(msg: any) {
    const meta = msg.MetaData;
    if (!meta) return;

    const mmsi = String(meta.MMSI);
    const lat = meta.latitude;
    const lon = meta.longitude;
    const shipName = meta.ShipName?.trim();

    // Position reports (message types 1, 2, 3, 18, 19)
    const posReport = msg.Message?.PositionReport;
    const staticData = msg.Message?.ShipStaticData;

    const aisMsg: AISMessage = {
      mmsi,
      messageType: posReport ? 1 : 5,
      timestamp: Date.now(),
    };

    if (lat && lon && lat !== 0 && lon !== 0) {
      aisMsg.latitude = lat;
      aisMsg.longitude = lon;
    }

    if (shipName && shipName !== '') aisMsg.shipName = shipName;

    if (posReport) {
      if (posReport.Cog !== undefined && posReport.Cog !== 3600) aisMsg.cog = posReport.Cog / 10;
      if (posReport.Sog !== undefined) aisMsg.sog = posReport.Sog / 10;
      if (posReport.TrueHeading !== undefined && posReport.TrueHeading !== 511) aisMsg.heading = posReport.TrueHeading;
      if (posReport.NavigationalStatus !== undefined) {
        aisMsg.navStatus = posReport.NavigationalStatus;
        aisMsg.navStatusName = NAV_STATUSES[posReport.NavigationalStatus];
      }
    }

    if (staticData) {
      if (staticData.Type !== undefined) {
        aisMsg.shipType = staticData.Type;
        aisMsg.shipTypeName = SHIP_TYPES[staticData.Type] || SHIP_TYPES[Math.floor(staticData.Type / 10) * 10] || 'Unknown';
      }
      if (staticData.CallSign) aisMsg.callSign = staticData.CallSign.trim();
      if (staticData.Destination) aisMsg.destination = staticData.Destination.trim();
      if (staticData.ImoNumber) aisMsg.imo = staticData.ImoNumber;
    }

    this.updateVessel(aisMsg);
    this.emit('message', aisMsg);
    this.messageCount++;

    if (this.messageCount % 500 === 0) {
      console.log(`🚢 AIS: ${this.messageCount} messages received, ${this.vessels.size} vessels tracked`);
    }
  }

  // ── Digitraffic (SUPPLEMENTARY — Finnish/Baltic waters) ───────────────
  private async startDigitrafficFeed() {
    try {
      await this.fetchVesselMetadata();
      await this.fetchDigitrafficPositions();
      console.log(`🚢 AIS: Digitraffic supplementary feed active [${this.vessels.size} vessels]`);

      this.digitrafficTimer = setInterval(async () => {
        try { await this.fetchDigitrafficPositions(); } catch {}
      }, 60000); // Every 60s (supplementary, not primary)

      setInterval(async () => {
        try { await this.fetchVesselMetadata(); } catch {}
      }, 300000);

    } catch (err: any) {
      console.log(`🚢 AIS: Digitraffic unavailable (${err.message}), AISStream is primary`);
    }
  }

  private async fetchVesselMetadata() {
    const res = await fetch('https://meri.digitraffic.fi/api/ais/v1/vessels', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    if (!res.ok) throw new Error(`Vessels API ${res.status}`);
    const vessels = await res.json() as any[];
    for (const v of vessels) {
      this.vesselMetadata.set(String(v.mmsi), v);
    }
  }

  private async fetchDigitrafficPositions() {
    const res = await fetch('https://meri.digitraffic.fi/api/ais/v1/locations', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    if (!res.ok) throw new Error(`Locations API ${res.status}`);
    const data = await res.json() as { features: any[] };

    let dtCount = 0; for (const f of data.features) { if (dtCount >= 500) break; dtCount++;
      const props = f.properties;
      const coords = f.geometry?.coordinates;
      if (!coords || coords[0] === 0) continue;

      const mmsi = String(f.mmsi || props.mmsi);
      const meta = this.vesselMetadata.get(mmsi);

      const msg: AISMessage = {
        mmsi,
        messageType: 1,
        latitude: coords[1],
        longitude: coords[0],
        cog: props.cog !== undefined ? props.cog / 10 : undefined,
        sog: props.sog !== undefined ? props.sog / 10 : undefined,
        heading: props.heading !== 511 ? props.heading : undefined,
        navStatus: props.navStat,
        navStatusName: NAV_STATUSES[props.navStat],
        timestamp: Date.now(),
      };

      if (meta) {
        msg.shipName = meta.name;
        msg.callSign = meta.callSign;
        msg.shipType = meta.shipType;
        msg.shipTypeName = SHIP_TYPES[meta.shipType] || SHIP_TYPES[Math.floor(meta.shipType / 10) * 10] || 'Unknown';
        msg.destination = meta.destination;
        msg.imo = meta.imo || undefined;
      }

      this.updateVessel(msg);
      this.emit('message', msg);
    }
  }

  // Demo mode (only if everything else fails)
  private startDemoMode() {
    if (this.demoInterval) return;
    this.mode = 'demo';
    console.log('🚢 AIS: No live feed available, running demo mode');

    const demoVessels = [
      { mmsi: '235099472', name: 'CALEDONIAN ISLES', type: 60, baseLat: 55.68, baseLon: -5.05, sog: 14, cog: 225, dest: 'BRODICK' },
      { mmsi: '235006700', name: 'ISLE OF ARRAN', type: 60, baseLat: 55.75, baseLon: -5.15, sog: 12, cog: 180, dest: 'ARDROSSAN' },
      { mmsi: '311045600', name: 'ATLANTIC STAR', type: 70, baseLat: 54.60, baseLon: -5.90, sog: 8, cog: 315, dest: 'BELFAST' },
      { mmsi: '244670581', name: 'STENA SUPERFAST', type: 60, baseLat: 54.80, baseLon: -5.50, sog: 18, cog: 270, dest: 'BELFAST' },
    ];

    this.demoInterval = setInterval(() => {
      const t = Date.now() / 1000;
      for (const demo of demoVessels) {
        const driftLat = Math.sin(t * 0.0005 + parseFloat(demo.mmsi.slice(-3)) * 0.01) * 0.005;
        const driftLon = Math.cos(t * 0.0005 + parseFloat(demo.mmsi.slice(-3)) * 0.01) * 0.008;
        const msg: AISMessage = {
          mmsi: demo.mmsi, messageType: 1, shipName: demo.name, shipType: demo.type,
          shipTypeName: SHIP_TYPES[demo.type],
          latitude: demo.baseLat + driftLat, longitude: demo.baseLon + driftLon,
          cog: (demo.cog + Math.sin(t * 0.002) * 10 + 360) % 360,
          sog: demo.sog + Math.sin(t * 0.003) * 2,
          heading: Math.round((demo.cog + Math.sin(t * 0.002) * 10 + 360) % 360),
          navStatus: demo.sog > 1 ? 0 : 5,
          navStatusName: demo.sog > 1 ? 'Under way using engine' : 'Moored',
          destination: demo.dest, timestamp: Date.now(),
        };
        this.updateVessel(msg);
        this.emit('message', msg);
      }
    }, 5000);
  }
}
