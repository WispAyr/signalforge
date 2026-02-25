import { db } from '../services/database.js';

/**
 * Persistence service — upserts live data into SQLite with debouncing.
 * Updates existing records by ICAO/MMSI/callsign, increments message_count.
 */
export class PersistenceService {
  private adsbBuffer: Map<string, any> = new Map();
  private aisBuffer: Map<string, any> = new Map();
  private aprsBuffer: Map<string, any> = new Map();
  private flushInterval: ReturnType<typeof setInterval>;
  private cleanupInterval: ReturnType<typeof setInterval>;
  private startTime = Date.now();

  // Prepared statements
  private adsbUpdate = db.prepare(`
    UPDATE adsb_log SET callsign=COALESCE(@callsign, callsign), lat=COALESCE(@lat, lat), lon=COALESCE(@lon, lon),
    altitude=COALESCE(@altitude, altitude), speed=COALESCE(@speed, speed), heading=COALESCE(@heading, heading),
    squawk=COALESCE(@squawk, squawk), last_seen=@now, message_count=message_count+@count WHERE icao=@icao AND id=(SELECT MAX(id) FROM adsb_log WHERE icao=@icao AND first_seen > @cutoff)
  `);
  private adsbInsert = db.prepare(`
    INSERT INTO adsb_log (icao, callsign, lat, lon, altitude, speed, heading, squawk, first_seen, last_seen, message_count)
    VALUES (@icao, @callsign, @lat, @lon, @altitude, @speed, @heading, @squawk, @now, @now, @count)
  `);

  private aisSelect = db.prepare('SELECT id, message_count FROM ais_log WHERE mmsi = ? AND first_seen > ?');
  private aisUpdate = db.prepare(`
    UPDATE ais_log SET name=COALESCE(@name, name), ship_type=COALESCE(@ship_type, ship_type),
    lat=COALESCE(@lat, lat), lon=COALESCE(@lon, lon), speed=COALESCE(@speed, speed),
    course=COALESCE(@course, course), destination=COALESCE(@destination, destination),
    last_seen=@now, message_count=message_count+@count WHERE mmsi=@mmsi AND id=(SELECT MAX(id) FROM ais_log WHERE mmsi=@mmsi AND first_seen > @cutoff)
  `);
  private aisInsert = db.prepare(`
    INSERT INTO ais_log (mmsi, name, ship_type, lat, lon, speed, course, destination, first_seen, last_seen, message_count)
    VALUES (@mmsi, @name, @ship_type, @lat, @lon, @speed, @course, @destination, @now, @now, @count)
  `);

  private aprsSelect = db.prepare('SELECT id FROM aprs_log WHERE callsign = ? AND first_seen > ?');
  private aprsUpdate = db.prepare(`
    UPDATE aprs_log SET lat=COALESCE(@lat, lat), lon=COALESCE(@lon, lon),
    symbol=COALESCE(@symbol, symbol), comment=COALESCE(@comment, comment),
    path=COALESCE(@path, path), last_seen=@now, message_count=message_count+@count
    WHERE callsign=@callsign AND id=(SELECT MAX(id) FROM aprs_log WHERE callsign=@callsign AND first_seen > @cutoff)
  `);
  private aprsInsert = db.prepare(`
    INSERT INTO aprs_log (callsign, lat, lon, symbol, comment, path, first_seen, last_seen, message_count)
    VALUES (@callsign, @lat, @lon, @symbol, @comment, @path, @now, @now, @count)
  `);

  private eventInsert = db.prepare(`
    INSERT INTO event_log (event_type, source, summary, data, created_at) VALUES (?, ?, ?, ?, ?)
  `);

  constructor() {
    // Flush buffers every 10 seconds
    this.flushInterval = setInterval(() => this.flush(), 10000);
    // Cleanup old records every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 3600000);
    console.log('💾 Persistence service started');
  }

  stop() {
    clearInterval(this.flushInterval);
    clearInterval(this.cleanupInterval);
    this.flush(); // final flush
  }

  // ── Ingest methods (buffer incoming data) ──

  recordADSB(msg: any) {
    const key = msg.icao || msg.callsign;
    if (!key) return;
    const existing = this.adsbBuffer.get(key);
    if (existing) {
      existing.count++;
      if (msg.callsign) existing.callsign = msg.callsign;
      if (msg.latitude != null) existing.lat = msg.latitude;
      if (msg.longitude != null) existing.lon = msg.longitude;
      if (msg.altitude != null) existing.altitude = msg.altitude;
      if (msg.speed != null) existing.speed = msg.speed;
      if (msg.heading != null) existing.heading = msg.heading;
      if (msg.squawk) existing.squawk = msg.squawk;
    } else {
      this.adsbBuffer.set(key, {
        icao: msg.icao || key,
        callsign: msg.callsign || null,
        lat: msg.latitude ?? null,
        lon: msg.longitude ?? null,
        altitude: msg.altitude ?? null,
        speed: msg.speed ?? null,
        heading: msg.heading ?? null,
        squawk: msg.squawk || null,
        count: 1,
      });
    }
  }

  recordAIS(msg: any) {
    const key = String(msg.mmsi);
    if (!key || key === 'undefined') return;
    const existing = this.aisBuffer.get(key);
    if (existing) {
      existing.count++;
      if (msg.shipName) existing.name = msg.shipName;
      if (msg.shipTypeName) existing.ship_type = msg.shipTypeName;
      if (msg.latitude != null) existing.lat = msg.latitude;
      if (msg.longitude != null) existing.lon = msg.longitude;
      if (msg.sog != null) existing.speed = msg.sog;
      if (msg.cog != null) existing.course = msg.cog;
      if (msg.destination) existing.destination = msg.destination;
    } else {
      this.aisBuffer.set(key, {
        mmsi: key,
        name: msg.shipName || null,
        ship_type: msg.shipTypeName || null,
        lat: msg.latitude ?? null,
        lon: msg.longitude ?? null,
        speed: msg.sog ?? null,
        course: msg.cog ?? null,
        destination: msg.destination || null,
        count: 1,
      });
    }
  }

  recordAPRS(pkt: any) {
    const key = pkt.source;
    if (!key) return;
    const existing = this.aprsBuffer.get(key);
    if (existing) {
      existing.count++;
      if (pkt.latitude != null) existing.lat = pkt.latitude;
      if (pkt.longitude != null) existing.lon = pkt.longitude;
      if (pkt.symbol) existing.symbol = pkt.symbol;
      if (pkt.comment) existing.comment = pkt.comment;
      if (pkt.path) existing.path = Array.isArray(pkt.path) ? pkt.path.join(',') : pkt.path;
    } else {
      this.aprsBuffer.set(key, {
        callsign: key,
        lat: pkt.latitude ?? null,
        lon: pkt.longitude ?? null,
        symbol: pkt.symbol || null,
        comment: pkt.comment || null,
        path: pkt.path ? (Array.isArray(pkt.path) ? pkt.path.join(',') : pkt.path) : null,
        count: 1,
      });
    }
  }

  recordEvent(eventType: string, source: string, summary: string, data?: any) {
    const now = Math.floor(Date.now() / 1000);
    this.eventInsert.run(eventType, source, summary, data ? JSON.stringify(data) : null, now);
  }

  // ── Flush buffers to DB ──

  /** Replace undefined with null for SQLite binding */
  private sanitize(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = v === undefined ? null : v;
    }
    return result;
  }

  private flush() {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 6 * 3600;

    if (this.adsbBuffer.size > 0) {
      const flushAdsb = db.transaction(() => {
        for (const [, entry] of this.adsbBuffer) {
          const params = this.sanitize({ ...entry, now, cutoff });
          const result = this.adsbUpdate.run(params);
          if (result.changes === 0) {
            this.adsbInsert.run(params);
          }
        }
      });
      try { flushAdsb(); } catch (e) { console.error('💾 ADS-B flush error:', e); }
      this.adsbBuffer.clear();
    }

    if (this.aisBuffer.size > 0) {
      const flushAis = db.transaction(() => {
        for (const [, entry] of this.aisBuffer) {
          const params = this.sanitize({ ...entry, now, cutoff });
          const existing = this.aisSelect.all(entry.mmsi, cutoff) as any[];
          if (existing.length > 0) {
            this.aisUpdate.run(params);
          } else {
            this.aisInsert.run(params);
          }
        }
      });
      try { flushAis(); } catch (e) { console.error('💾 AIS flush error:', e); }
      this.aisBuffer.clear();
    }

    if (this.aprsBuffer.size > 0) {
      const flushAprs = db.transaction(() => {
        for (const [, entry] of this.aprsBuffer) {
          const params = this.sanitize({ ...entry, now, cutoff });
          const existing = this.aprsSelect.all(entry.callsign, cutoff) as any[];
          if (existing.length > 0) {
            this.aprsUpdate.run(params);
          } else {
            this.aprsInsert.run(params);
          }
        }
      });
      try { flushAprs(); } catch (e) { console.error('💾 APRS flush error:', e); }
      this.aprsBuffer.clear();
    }
  }

  // ── Cleanup old records (7 days) ──

  private cleanup() {
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
    db.prepare('DELETE FROM adsb_log WHERE last_seen < ?').run(cutoff);
    db.prepare('DELETE FROM ais_log WHERE last_seen < ?').run(cutoff);
    db.prepare('DELETE FROM aprs_log WHERE last_seen < ?').run(cutoff);
    db.prepare('DELETE FROM event_log WHERE created_at < ?').run(cutoff);
    console.log('💾 Persistence cleanup: removed records older than 7 days');
  }

  // ── Query methods for REST API ──

  getADSBHistory(since?: number, limit = 100): any[] {
    const cutoff = since || 0;
    return db.prepare('SELECT * FROM adsb_log WHERE last_seen > ? ORDER BY last_seen DESC LIMIT ?').all(cutoff, limit);
  }

  getAISHistory(since?: number, limit = 100): any[] {
    const cutoff = since || 0;
    return db.prepare('SELECT * FROM ais_log WHERE last_seen > ? ORDER BY last_seen DESC LIMIT ?').all(cutoff, limit);
  }

  getAPRSHistory(since?: number, limit = 100): any[] {
    const cutoff = since || 0;
    return db.prepare('SELECT * FROM aprs_log WHERE last_seen > ? ORDER BY last_seen DESC LIMIT ?').all(cutoff, limit);
  }

  getEvents(type?: string, since?: number, limit = 100): any[] {
    const cutoff = since || 0;
    if (type) {
      return db.prepare('SELECT * FROM event_log WHERE event_type = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?').all(type, cutoff, limit);
    }
    return db.prepare('SELECT * FROM event_log WHERE created_at > ? ORDER BY created_at DESC LIMIT ?').all(cutoff, limit);
  }

  getStats(): any {
    const adsbCount = (db.prepare('SELECT COUNT(*) as c FROM adsb_log').get() as any).c;
    const aisCount = (db.prepare('SELECT COUNT(*) as c FROM ais_log').get() as any).c;
    const aprsCount = (db.prepare('SELECT COUNT(*) as c FROM aprs_log').get() as any).c;
    const eventCount = (db.prepare('SELECT COUNT(*) as c FROM event_log').get() as any).c;
    const adsbUnique = (db.prepare('SELECT COUNT(DISTINCT icao) as c FROM adsb_log').get() as any).c;
    const aisUnique = (db.prepare('SELECT COUNT(DISTINCT mmsi) as c FROM ais_log').get() as any).c;
    const aprsUnique = (db.prepare('SELECT COUNT(DISTINCT callsign) as c FROM aprs_log').get() as any).c;
    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      records: { adsb: adsbCount, ais: aisCount, aprs: aprsCount, events: eventCount },
      unique: { aircraft: adsbUnique, vessels: aisUnique, stations: aprsUnique },
      timestamp: Date.now(),
    };
  }
}
