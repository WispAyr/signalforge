import { EventEmitter } from 'events';
import type { APRSPacket, APRSStation } from '@signalforge/shared';

/**
 * APRS Decoder — parses AX.25 APRS packets or generates demo data.
 * Key for RAYNET emergency comms use case.
 */
export class APRSDecoder extends EventEmitter {
  private stations: Map<string, APRSStation> = new Map();
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  start() {
    console.log('📍 APRS decoder started (demo mode)');
    this.startDemoMode();
    setInterval(() => this.cleanup(), 120000);
  }

  stop() {
    if (this.demoInterval) clearInterval(this.demoInterval);
  }

  getStations(): APRSStation[] {
    return Array.from(this.stations.values()).filter(s => s.latitude !== undefined);
  }

  private updateStation(pkt: APRSPacket) {
    let st = this.stations.get(pkt.source);
    if (!st) {
      st = { callsign: pkt.source, lastSeen: Date.now(), packetCount: 0 };
      this.stations.set(pkt.source, st);
    }
    st.lastSeen = pkt.timestamp;
    st.packetCount++;
    st.lastPacket = pkt;
    if (pkt.latitude !== undefined) st.latitude = pkt.latitude;
    if (pkt.longitude !== undefined) st.longitude = pkt.longitude;
    if (pkt.altitude !== undefined) st.altitude = pkt.altitude;
    if (pkt.symbol) st.symbol = pkt.symbol;
    if (pkt.comment) st.comment = pkt.comment;
  }

  private cleanup() {
    const cutoff = Date.now() - 3600000; // 1 hour
    for (const [call, st] of this.stations) {
      if (st.lastSeen < cutoff) this.stations.delete(call);
    }
  }

  private startDemoMode() {
    // Simulated APRS stations around Ayrshire / West Scotland - RAYNET style
    const demoStations = [
      { call: 'GM8ABC-9', lat: 55.458, lon: -4.630, sym: '>', comment: 'RAYNET Ayr Control', type: 'position' },
      { call: 'GM4XYZ-1', lat: 55.470, lon: -4.615, sym: '#', comment: 'Digipeater WIDE1-1', type: 'position' },
      { call: 'MM0TEST-7', lat: 55.445, lon: -4.650, sym: '[', comment: 'RAYNET Mobile 1', type: 'position' },
      { call: 'GM6DEF-5', lat: 55.480, lon: -4.590, sym: '-', comment: 'Home QTH Prestwick', type: 'position' },
      { call: 'GM0GHI-13', lat: 55.510, lon: -4.490, sym: '_', comment: 'WX Station Kilmarnock', type: 'weather' },
      { call: 'GM3JKL-9', lat: 55.430, lon: -4.700, sym: '>', comment: 'RAYNET Mobile 2', type: 'position' },
      { call: 'MM7MNO-2', lat: 55.500, lon: -4.550, sym: '#', comment: 'iGate Troon', type: 'position' },
      { call: 'GM1PQR-14', lat: 55.465, lon: -4.625, sym: '\\', comment: 'Emergency Ops', type: 'position' },
    ];

    this.demoInterval = setInterval(() => {
      const t = Date.now() / 1000;
      // Randomly pick 1-2 stations to update
      const count = Math.floor(Math.random() * 2) + 1;
      for (let n = 0; n < count; n++) {
        const demo = demoStations[Math.floor(Math.random() * demoStations.length)];
        const drift = demo.call.includes('-9') || demo.call.includes('-7') ? 0.002 : 0.0002; // mobiles move more

        const pkt: APRSPacket = {
          source: demo.call,
          destination: 'APRS',
          path: ['WIDE1-1', 'WIDE2-1'],
          dataType: demo.type,
          latitude: demo.lat + Math.sin(t * 0.001 + demo.lat * 100) * drift,
          longitude: demo.lon + Math.cos(t * 0.001 + demo.lon * 100) * drift,
          symbol: demo.sym,
          comment: demo.comment,
          timestamp: Date.now(),
        };

        // Add weather data for weather stations
        if (demo.type === 'weather') {
          pkt.temperature = 8 + Math.sin(t * 0.0001) * 5;
          pkt.humidity = 70 + Math.sin(t * 0.0002) * 15;
          pkt.pressure = 1013 + Math.sin(t * 0.00005) * 10;
          pkt.windSpeed = 15 + Math.random() * 10;
          pkt.windDirection = (270 + Math.sin(t * 0.001) * 30 + 360) % 360;
        }

        // Add speed/course for mobiles
        if (demo.call.includes('-9') || demo.call.includes('-7')) {
          pkt.speed = 30 + Math.random() * 40;
          pkt.course = (Math.random() * 360);
        }

        this.updateStation(pkt);
        this.emit('message', pkt);
      }
    }, 10000 + Math.random() * 20000);
  }
}
