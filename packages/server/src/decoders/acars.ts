import { EventEmitter } from 'events';
import type { ACARSMessage } from '@signalforge/shared';

/**
 * ACARS Decoder — parses acarsdec JSON output or generates demo messages.
 * In production, connects to acarsdec output via UDP/TCP.
 */
export class ACARSDecoder extends EventEmitter {
  private messages: ACARSMessage[] = [];
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private maxMessages = 500;

  start() {
    console.log('📡 ACARS decoder started (demo mode)');
    this.startDemoMode();
  }

  stop() {
    if (this.demoInterval) clearInterval(this.demoInterval);
  }

  getMessages(limit = 50): ACARSMessage[] {
    return this.messages.slice(-limit);
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  private addMessage(msg: ACARSMessage) {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) this.messages.shift();
    this.emit('message', msg);
  }

  private startDemoMode() {
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
