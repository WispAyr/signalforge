import { EventEmitter } from 'events';
import * as net from 'net';
import type { APRSPacket, APRSStation } from '@signalforge/shared';

const APRS_HOST = 'rotate.aprs2.net';
const APRS_PORT = 14580;
const APRS_LOGIN = 'user SFORG-1 pass -1 vers SignalForge 0.10 filter r/55.46/-4.63/500';
const MAX_STATIONS = 500;
const EXPIRE_MS = 2 * 3600000; // 2 hours
const RECONNECT_DELAY = 30000;

/**
 * APRS Decoder — connects to APRS-IS for real positions, falls back to demo.
 */
export class APRSDecoder extends EventEmitter {
  private stations: Map<string, APRSStation> = new Map();
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private socket: net.Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = '';
  private connected = false;
  private useLive = false;

  start() {
    console.log('📍 APRS decoder starting — attempting APRS-IS connection...');
    this.connectLive();
    setInterval(() => this.cleanup(), 120000);
  }

  stop() {
    if (this.demoInterval) clearInterval(this.demoInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }

  getStations(): APRSStation[] {
    return Array.from(this.stations.values()).filter(s => s.latitude !== undefined);
  }

  isLive(): boolean { return this.useLive; }

  // ── APRS-IS TCP connection ──
  private connectLive() {
    if (this.socket) { this.socket.destroy(); this.socket = null; }

    const sock = new net.Socket();
    this.socket = sock;
    this.buffer = '';

    sock.setTimeout(90000); // 90s keepalive timeout

    sock.connect(APRS_PORT, APRS_HOST, () => {
      console.log(`📍 APRS-IS connected to ${APRS_HOST}:${APRS_PORT}`);
      sock.write(APRS_LOGIN + '\r\n');
      this.connected = true;
      this.useLive = true;
      // Stop demo if running
      if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    });

    sock.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf-8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        try {
          const pkt = this.parseLine(trimmed);
          if (pkt) {
            this.updateStation(pkt);
            this.emit('message', pkt);
          }
        } catch { /* skip unparseable */ }
      }
    });

    sock.on('timeout', () => {
      console.log('📍 APRS-IS socket timeout — reconnecting');
      sock.destroy();
    });

    sock.on('error', (err) => {
      console.log(`📍 APRS-IS error: ${err.message}`);
    });

    sock.on('close', () => {
      console.log('📍 APRS-IS disconnected');
      this.connected = false;
      this.socket = null;
      // Fall back to demo
      if (!this.demoInterval) {
        console.log('📍 Falling back to demo APRS data');
        this.useLive = false;
        this.startDemoMode();
      }
      // Schedule reconnect
      this.reconnectTimer = setTimeout(() => this.connectLive(), RECONNECT_DELAY);
    });
  }

  // ── Parse APRS packet from raw line ──
  private parseLine(line: string): APRSPacket | null {
    // Format: CALL>DEST,PATH:payload
    const headerEnd = line.indexOf(':');
    if (headerEnd < 0) return null;

    const header = line.substring(0, headerEnd);
    const payload = line.substring(headerEnd + 1);
    if (!payload) return null;

    const gtIdx = header.indexOf('>');
    if (gtIdx < 0) return null;

    const source = header.substring(0, gtIdx).trim();
    const rest = header.substring(gtIdx + 1);
    const pathParts = rest.split(',');
    const destination = pathParts[0] || '';
    const path = pathParts.slice(1);

    const pkt: APRSPacket = {
      source,
      destination,
      path,
      dataType: 'unknown',
      timestamp: Date.now(),
    };

    const dataTypeId = payload.charAt(0);

    // Position reports
    if (dataTypeId === '!' || dataTypeId === '=' || dataTypeId === '/' || dataTypeId === '@') {
      pkt.dataType = 'position';
      this.parsePosition(payload, pkt);
    } else if (dataTypeId === ';') {
      pkt.dataType = 'object';
      this.parseObject(payload, pkt);
    } else if (dataTypeId === ')') {
      pkt.dataType = 'item';
    } else if (dataTypeId === ':') {
      pkt.dataType = 'message';
      this.parseMessage(payload, pkt);
    } else if (dataTypeId === 'T') {
      pkt.dataType = 'telemetry';
    } else if (dataTypeId === '_') {
      pkt.dataType = 'weather';
      // Positionless weather
    } else if (dataTypeId === '`' || dataTypeId === '\'') {
      pkt.dataType = 'position';
      this.parseMicE(payload, destination, pkt);
    }

    return pkt;
  }

  // ── Uncompressed position: !DDMM.MMN/DDDMM.MMW... ──
  private parsePosition(payload: string, pkt: APRSPacket) {
    const dtChar = payload.charAt(0);
    let offset = 1;

    // Timestamp for / and @ formats
    if (dtChar === '/' || dtChar === '@') {
      offset = 8; // skip 7-char timestamp + data type char
    }

    const rest = payload.substring(offset);

    // Check for compressed format (starts with /A-Z etc)
    if (rest.length >= 13 && /^[\/\\A-Za-z0-9]/.test(rest.charAt(0))) {
      // Check if it's uncompressed (digit at position 0-3 for lat degrees)
      if (/^\d{4}\./.test(rest)) {
        // Uncompressed: DDMM.MMN/DDDMM.MMW
        this.parseUncompressedPos(rest, pkt);
      } else if (rest.length >= 13) {
        // Try compressed
        this.parseCompressedPos(rest, pkt);
      }
    }
  }

  private parseUncompressedPos(data: string, pkt: APRSPacket) {
    // DDMM.MMN/DDDMM.MMW[symbol]...
    const latMatch = data.match(/^(\d{2})(\d{2}\.\d{2})([NS])/);
    if (!latMatch) return;

    const symTable = data.charAt(8);
    const lonStr = data.substring(9);
    const lonMatch = lonStr.match(/^(\d{3})(\d{2}\.\d{2})([EW])/);
    if (!lonMatch) return;

    const symCode = data.charAt(18);

    let lat = parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60;
    if (latMatch[3] === 'S') lat = -lat;

    let lon = parseInt(lonMatch[1]) + parseFloat(lonMatch[2]) / 60;
    if (lonMatch[3] === 'W') lon = -lon;

    pkt.latitude = lat;
    pkt.longitude = lon;
    pkt.symbol = symTable + symCode;

    // Parse extension (CSE/SPD) and comment after position
    const after = data.substring(19);
    this.parseExtensionAndComment(after, pkt);
  }

  private parseCompressedPos(data: string, pkt: APRSPacket) {
    // Compressed: symTable + 4 lat + 4 lon + symCode + cs + compType
    const symTable = data.charAt(0);
    const latChars = data.substring(1, 5);
    const lonChars = data.substring(5, 9);
    const symCode = data.charAt(9);

    // Decode base-91
    let latVal = 0, lonVal = 0;
    for (let i = 0; i < 4; i++) {
      latVal = latVal * 91 + (latChars.charCodeAt(i) - 33);
      lonVal = lonVal * 91 + (lonChars.charCodeAt(i) - 33);
    }

    pkt.latitude = 90 - (latVal / 380926);
    pkt.longitude = -180 + (lonVal / 190463);
    pkt.symbol = symTable + symCode;

    // cs byte for course/speed
    if (data.length > 12) {
      const cs = data.charCodeAt(10) - 33;
      const se = data.charCodeAt(11) - 33;
      const compType = data.charCodeAt(12) - 33;

      if (cs >= 0 && cs <= 89) {
        pkt.course = cs * 4;
        pkt.speed = (Math.pow(1.08, se) - 1) * 1.852; // knots to km/h
      } else if (cs === 90) {
        // Altitude
        pkt.altitude = Math.pow(1.002, (cs * 91 + se)) * 0.3048;
      }
    }

    const comment = data.substring(13).trim();
    if (comment) pkt.comment = comment;

    // Check for altitude in comment /A=NNNNNN
    const altMatch = comment.match(/\/A=(\d{6})/);
    if (altMatch) pkt.altitude = parseInt(altMatch[1]) * 0.3048;
  }

  private parseExtensionAndComment(data: string, pkt: APRSPacket) {
    // CSE/SPD: 3 digits / 3 digits  
    const cseMatch = data.match(/^(\d{3})\/(\d{3})/);
    if (cseMatch) {
      pkt.course = parseInt(cseMatch[1]);
      pkt.speed = parseInt(cseMatch[2]) * 1.852; // knots to km/h
      data = data.substring(7);
    }

    // Altitude /A=NNNNNN
    const altMatch = data.match(/\/A=(\d{6})/);
    if (altMatch) {
      pkt.altitude = parseInt(altMatch[1]) * 0.3048; // feet to meters
    }

    const comment = data.replace(/\/A=\d{6}/, '').trim();
    if (comment) pkt.comment = comment;
  }

  private parseObject(payload: string, pkt: APRSPacket) {
    // ;OBJNAME  *DDMM.MMN/DDDMM.MMW...
    const name = payload.substring(1, 10).trim();
    pkt.source = name;
    const alive = payload.charAt(10); // * or _
    const posData = payload.substring(18); // skip timestamp
    if (/^\d{4}\./.test(posData)) {
      this.parseUncompressedPos(posData, pkt);
    }
  }

  private parseMessage(payload: string, pkt: APRSPacket) {
    // :ADDRESSEE:message text{id
    const addrEnd = payload.indexOf(':', 1);
    if (addrEnd < 0) return;
    pkt.messageAddressee = payload.substring(1, addrEnd).trim();
    pkt.messageText = payload.substring(addrEnd + 1);
  }

  // ── Mic-E position decoding ──
  private parseMicE(payload: string, destination: string, pkt: APRSPacket) {
    if (destination.length < 6) return;

    // Decode latitude from destination
    const dChars = destination.substring(0, 6);
    let latDeg = 0, latMin = 0, latMinFrac = 0;
    const latDigits: number[] = [];
    let isNorth = false, isWest = false;
    const lonOffset = [0, 0, 0]; // 100's flag from first 3 chars

    for (let i = 0; i < 6; i++) {
      const c = dChars.charCodeAt(i);
      let digit = 0;
      if (c >= 0x30 && c <= 0x39) { digit = c - 0x30; }
      else if (c >= 0x41 && c <= 0x4A) { digit = c - 0x41; } // A-J = 0-9
      else if (c >= 0x50 && c <= 0x59) { digit = c - 0x50; } // P-Y = 0-9
      else if (c === 0x4B) { digit = 0; } // K = space
      else if (c === 0x4C) { digit = 0; } // L = space
      else if (c === 0x5A) { digit = 0; } // Z = space
      latDigits.push(digit);

      // North/South from char 4 (0-indexed 3)
      if (i === 3) isNorth = c >= 0x50;
      // Lon offset from char 5 (0-indexed 4)
      if (i === 4) lonOffset[0] = c >= 0x50 ? 100 : 0;
      // E/W from char 6 (0-indexed 5)
      if (i === 5) isWest = c >= 0x50;
    }

    latDeg = latDigits[0] * 10 + latDigits[1];
    latMin = latDigits[2] * 10 + latDigits[3];
    latMinFrac = latDigits[4] * 10 + latDigits[5];

    let lat = latDeg + (latMin + latMinFrac / 100) / 60;
    if (!isNorth) lat = -lat;
    pkt.latitude = lat;

    // Decode longitude from payload
    if (payload.length < 9) return;
    const d28 = payload.charCodeAt(1) - 28;
    const m28 = payload.charCodeAt(2) - 28;
    const h28 = payload.charCodeAt(3) - 28;

    let lonDeg = d28 + lonOffset[0];
    if (lonDeg >= 180 && lonDeg <= 189) lonDeg -= 80;
    else if (lonDeg >= 190 && lonDeg <= 199) lonDeg -= 190;

    let lonMin = m28;
    if (lonMin >= 60) lonMin -= 60;
    const lonMinFrac = h28;

    let lon = lonDeg + (lonMin + lonMinFrac / 100) / 60;
    if (isWest) lon = -lon;
    pkt.longitude = lon;

    // Speed/course from bytes 4-6
    if (payload.length >= 7) {
      const sp28 = payload.charCodeAt(4) - 28;
      const dc28 = payload.charCodeAt(5) - 28;
      const se28 = payload.charCodeAt(6) - 28;

      const speed = sp28 * 10 + Math.floor(dc28 / 10);
      const course = (dc28 % 10) * 100 + se28;

      pkt.speed = (speed >= 800 ? speed - 800 : speed) * 1.852;
      pkt.course = course >= 400 ? course - 400 : course;
    }

    // Symbol from bytes 7-8
    if (payload.length >= 9) {
      pkt.symbol = payload.charAt(8) + payload.charAt(7);
    }

    // Comment is the rest
    if (payload.length > 9) {
      const comment = payload.substring(9).trim();
      if (comment) pkt.comment = comment;
      const altMatch = comment.match(/\/A=(\d{6})/);
      if (altMatch) pkt.altitude = parseInt(altMatch[1]) * 0.3048;
    }
  }

  // ── Station management ──
  private updateStation(pkt: APRSPacket) {
    let st = this.stations.get(pkt.source);
    if (!st) {
      // Enforce max stations
      if (this.stations.size >= MAX_STATIONS) {
        // Remove oldest
        let oldest: string | null = null, oldestTime = Infinity;
        for (const [k, v] of this.stations) {
          if (v.lastSeen < oldestTime) { oldest = k; oldestTime = v.lastSeen; }
        }
        if (oldest) this.stations.delete(oldest);
      }
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
    const cutoff = Date.now() - EXPIRE_MS;
    for (const [call, st] of this.stations) {
      if (st.lastSeen < cutoff) this.stations.delete(call);
    }
  }

  // ── Demo fallback ──
  private startDemoMode() {
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
      const count = Math.floor(Math.random() * 2) + 1;
      for (let n = 0; n < count; n++) {
        const demo = demoStations[Math.floor(Math.random() * demoStations.length)];
        const drift = demo.call.includes('-9') || demo.call.includes('-7') ? 0.002 : 0.0002;

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

        if (demo.type === 'weather') {
          pkt.temperature = 8 + Math.sin(t * 0.0001) * 5;
          pkt.humidity = 70 + Math.sin(t * 0.0002) * 15;
          pkt.pressure = 1013 + Math.sin(t * 0.00005) * 10;
          pkt.windSpeed = 15 + Math.random() * 10;
          pkt.windDirection = (270 + Math.sin(t * 0.001) * 30 + 360) % 360;
        }

        if (demo.call.includes('-9') || demo.call.includes('-7')) {
          pkt.speed = 30 + Math.random() * 40;
          pkt.course = Math.random() * 360;
        }

        this.updateStation(pkt);
        this.emit('message', pkt);
      }
    }, 10000 + Math.random() * 20000);
  }
}
