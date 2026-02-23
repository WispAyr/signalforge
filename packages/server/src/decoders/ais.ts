import { EventEmitter } from 'events';
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

export class AISDecoder extends EventEmitter {
  private vessels: Map<string, Vessel> = new Map();
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  start() {
    console.log('🚢 AIS decoder started (demo mode)');
    this.startDemoMode();
    setInterval(() => this.cleanup(), 60000);
  }

  stop() {
    if (this.demoInterval) clearInterval(this.demoInterval);
  }

  getVessels(): Vessel[] {
    return Array.from(this.vessels.values()).filter(v => v.latitude !== undefined);
  }

  private updateVessel(msg: AISMessage) {
    let v = this.vessels.get(msg.mmsi);
    if (!v) {
      v = { mmsi: msg.mmsi, lastSeen: Date.now(), messageCount: 0, trail: [] };
      this.vessels.set(msg.mmsi, v);
    }
    v.lastSeen = msg.timestamp;
    v.messageCount++;

    if (msg.shipName) v.shipName = msg.shipName;
    if (msg.callSign) v.callSign = msg.callSign;
    if (msg.shipType !== undefined) { v.shipType = msg.shipType; v.shipTypeName = SHIP_TYPES[msg.shipType] || 'Unknown'; }
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
    const cutoff = Date.now() - 600000;
    for (const [mmsi, v] of this.vessels) {
      if (v.lastSeen < cutoff) this.vessels.delete(mmsi);
    }
  }

  private startDemoMode() {
    const demoVessels = [
      { mmsi: '235099472', name: 'CALEDONIAN ISLES', type: 60, baseLat: 55.68, baseLon: -5.05, sog: 14, cog: 225, dest: 'BRODICK' },     // Firth of Clyde
      { mmsi: '235006700', name: 'ISLE OF ARRAN', type: 60, baseLat: 55.75, baseLon: -5.15, sog: 12, cog: 180, dest: 'ARDROSSAN' },   // North Clyde
      { mmsi: '311045600', name: 'ATLANTIC STAR', type: 70, baseLat: 54.60, baseLon: -5.90, sog: 8, cog: 315, dest: 'BELFAST' },      // Belfast Lough
      { mmsi: '244670581', name: 'STENA SUPERFAST', type: 60, baseLat: 54.80, baseLon: -5.50, sog: 18, cog: 270, dest: 'BELFAST' },   // North Channel
      { mmsi: '235082528', name: 'CLYDE FISHER', type: 30, baseLat: 56.00, baseLon: -5.50, sog: 5, cog: 90, dest: 'FISHING' },        // Oban area
      { mmsi: '232003411', name: 'OCEAN SPIRIT', type: 37, baseLat: 55.95, baseLon: -4.77, sog: 6, cog: 45, dest: 'GREENOCK' },       // Upper Clyde
      { mmsi: '235501234', name: 'CLYDE PILOT', type: 50, baseLat: 55.85, baseLon: -4.90, sog: 10, cog: 160, dest: 'GREENOCK' },      // Greenock
      { mmsi: '235090001', name: 'RNLI TROON', type: 51, baseLat: 55.55, baseLon: -4.66, sog: 22, cog: 200, dest: 'SAR OPS' },        // Troon
    ];

    this.demoInterval = setInterval(() => {
      const t = Date.now() / 1000;
      for (const demo of demoVessels) {
        const driftLat = Math.sin(t * 0.0005 + parseFloat(demo.mmsi.slice(-3)) * 0.01) * 0.005;
        const driftLon = Math.cos(t * 0.0005 + parseFloat(demo.mmsi.slice(-3)) * 0.01) * 0.008;

        const msg: AISMessage = {
          mmsi: demo.mmsi,
          messageType: 1,
          shipName: demo.name,
          shipType: demo.type,
          shipTypeName: SHIP_TYPES[demo.type],
          latitude: demo.baseLat + driftLat,
          longitude: demo.baseLon + driftLon,
          cog: (demo.cog + Math.sin(t * 0.002) * 10 + 360) % 360,
          sog: demo.sog + Math.sin(t * 0.003) * 2,
          heading: Math.round((demo.cog + Math.sin(t * 0.002) * 10 + 360) % 360),
          navStatus: demo.sog > 1 ? 0 : 5,
          navStatusName: demo.sog > 1 ? 'Under way using engine' : 'Moored',
          destination: demo.dest,
          timestamp: Date.now(),
        };

        this.updateVessel(msg);
        this.emit('message', msg);
      }
    }, 5000);
  }
}
