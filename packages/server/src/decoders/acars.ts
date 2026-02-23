import { EventEmitter } from 'events';
import type { ACARSMessage } from '@signalforge/shared';
import WebSocket from 'ws';

/**
 * ACARS Decoder — Fallback chain: local acarsdec → Airframes.io WebSocket → demo mode
 * Airframes.io is a free community ACARS aggregator with no auth needed.
 */
export class ACARSDecoder extends EventEmitter {
  private messages: ACARSMessage[] = [];
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxMessages = 500;
  private mode: 'local' | 'airframes' | 'demo' = 'demo';
  private stopped = false;

  start() {
    this.stopped = false;
    this.startAirframesFeed();
  }

  stop() {
    this.stopped = true;
    if (this.demoInterval) clearInterval(this.demoInterval);
    if (this.ws) { this.ws.close(); this.ws = null; }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  getMessages(limit = 50): ACARSMessage[] {
    return this.messages.slice(-limit);
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getMode(): string { return this.mode; }

  private addMessage(msg: ACARSMessage) {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) this.messages.shift();
    this.emit('message', msg);
  }

  // --- Airframes.io WebSocket feed ---
  private startAirframesFeed() {
    console.log('📡 ACARS: Connecting to Airframes.io WebSocket...');

    try {
      this.ws = new WebSocket('wss://feed.airframes.io/messages');
    } catch (err: any) {
      console.log(`📡 ACARS: WebSocket creation failed (${err.message}), falling back to demo`);
      this.startDemoMode();
      return;
    }

    this.ws.on('open', () => {
      this.mode = 'airframes';
      console.log('📡 ACARS: Airframes.io connected [LIVE]');
    });

    this.ws.on('message', (data: Buffer | string) => {
      try {
        const raw = JSON.parse(data.toString());
        const msg = this.mapAirframesMessage(raw);
        if (msg) this.addMessage(msg);
      } catch {
        // Skip malformed messages
      }
    });

    this.ws.on('error', (err) => {
      console.log(`📡 ACARS: Airframes.io error: ${err.message}`);
    });

    this.ws.on('close', () => {
      if (this.stopped) return;
      if (this.mode === 'airframes') {
        // Was connected, try reconnecting
        console.log('📡 ACARS: Airframes.io disconnected, reconnecting in 5s...');
        this.reconnectTimer = setTimeout(() => this.startAirframesFeed(), 5000);
      } else {
        // Never connected, fall back to demo
        console.log('📡 ACARS: Airframes.io unavailable, falling back to demo mode');
        this.startDemoMode();
      }
    });

    // If not connected within 10s, fall back
    setTimeout(() => {
      if (this.mode !== 'airframes' && this.mode !== 'demo') {
        console.log('📡 ACARS: Airframes.io connection timeout, falling back to demo');
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.startDemoMode();
      }
    }, 10000);
  }

  private mapAirframesMessage(raw: any): ACARSMessage | null {
    // Airframes.io message format varies but typically includes:
    // text, tail, flight, label, block_id, ack, mode, freq, level, station, etc.
    const text = raw.text || raw.message || raw.msg_text || '';
    if (!text && !raw.label) return null;

    return {
      mode: raw.mode || raw.source?.type || '2',
      label: raw.label || raw.msg_label || '??',
      blockId: raw.block_id || raw.blockId || '?',
      ack: raw.ack || raw.msg_ack || '?',
      registration: raw.tail || raw.registration || undefined,
      flightNumber: raw.flight || raw.flightNumber || undefined,
      messageText: text,
      frequency: raw.freq || raw.frequency || undefined,
      timestamp: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
      signalLevel: raw.level || raw.signal || raw.signalLevel || undefined,
    };
  }

  // Demo mode
  private startDemoMode() {
    if (this.demoInterval) return;
    this.mode = 'demo';
    console.log('📡 ACARS: No live feed available, running demo mode');

    const labels = ['H1', 'SA', '5Z', 'QA', 'Q0', 'B6', '_d', 'SQ', '80', 'RA'];
    const airlines = ['BAW', 'RYR', 'EZY', 'SHT', 'LOG', 'TOM', 'DLH', 'AFR'];
    const regs = ['G-EUPP', 'G-EUPJ', 'EI-DWJ', 'G-EZBI', 'G-LGNA', 'G-TAWG', 'D-AIBL', 'F-GKXS'];
    const texts = [
      'POSRPT LAT 55.46 LON -4.63 ALT 35012 SPD 445',
      'WXRPT OVC025 BKN040 VIS 9999 WIND 270/15 TEMP -42',
      '/MEDLINK REQUEST MEDICAL ADVICE',
      'ETA EGPF 1342Z GATE 24',
      'FUEL QTY 12400KG EST LANDING 8200KG',
      'OOOI OUT 1215Z OFF 1228Z ON 1355Z IN 1402Z',
      'FREE TEXT TEST MESSAGE',
      'CREW SKED UPDATE NEXT FLT BA456 LHR 1500Z',
      'MAINT REQ FAULT CODE 29-11 ENGINE 1 OIL TEMP',
      'SELCAL CHECK ABCD',
      'NOTAM EGPF RWY 23 CLSD UNTIL 1800Z',
      'PDC BA123 CLRD TO EGLL VIA CPT SQK 4523 INIT CLB FL060',
    ];

    this.demoInterval = setInterval(() => {
      const airline = airlines[Math.floor(Math.random() * airlines.length)];
      const flightNum = `${airline}${Math.floor(Math.random() * 900 + 100)}`;
      const msg: ACARSMessage = {
        mode: '2',
        label: labels[Math.floor(Math.random() * labels.length)],
        blockId: String.fromCharCode(65 + Math.floor(Math.random() * 26)),
        ack: Math.random() > 0.7 ? 'NAK' : String.fromCharCode(48 + Math.floor(Math.random() * 10)),
        registration: regs[Math.floor(Math.random() * regs.length)],
        flightNumber: flightNum,
        messageText: texts[Math.floor(Math.random() * texts.length)],
        frequency: [131.550, 131.725, 131.825, 136.900, 136.750][Math.floor(Math.random() * 5)],
        timestamp: Date.now(),
        signalLevel: -Math.random() * 30 - 5,
      };
      this.addMessage(msg);
    }, 8000 + Math.random() * 15000);
  }
}
