import { EventEmitter } from 'events';
import type { LogEntry, LogbookStats, ADIFField } from '@signalforge/shared';

export class LogbookService extends EventEmitter {
  private entries: LogEntry[] = [];

  addEntry(entry: Omit<LogEntry, 'id' | 'createdAt' | 'updatedAt'>): LogEntry {
    const e: LogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tags: entry.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.entries.unshift(e);
    this.emit('entry_added', e);
    return e;
  }

  updateEntry(id: string, updates: Partial<LogEntry>): LogEntry | null {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return null;
    Object.assign(entry, updates, { updatedAt: Date.now() });
    this.emit('entry_updated', entry);
    return entry;
  }

  deleteEntry(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  getEntries(opts?: { callsign?: string; band?: string; mode?: string; startDate?: number; endDate?: number; search?: string; limit?: number; offset?: number }): LogEntry[] {
    let result = this.entries;
    if (opts?.callsign) result = result.filter(e => e.callsign.toUpperCase().includes(opts.callsign!.toUpperCase()));
    if (opts?.band) result = result.filter(e => e.band === opts.band);
    if (opts?.mode) result = result.filter(e => e.mode === opts.mode);
    if (opts?.startDate) result = result.filter(e => e.dateTimeOn >= opts.startDate!);
    if (opts?.endDate) result = result.filter(e => e.dateTimeOn <= opts.endDate!);
    if (opts?.search) {
      const s = opts.search.toLowerCase();
      result = result.filter(e => e.callsign.toLowerCase().includes(s) || e.notes?.toLowerCase().includes(s) || e.name?.toLowerCase().includes(s));
    }
    const offset = opts?.offset || 0;
    const limit = opts?.limit || 100;
    return result.slice(offset, offset + limit);
  }

  getEntry(id: string): LogEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  getStats(): LogbookStats {
    const callsigns = new Set(this.entries.map(e => e.callsign));
    const bandBreakdown: Record<string, number> = {};
    const modeBreakdown: Record<string, number> = {};
    for (const e of this.entries) {
      bandBreakdown[e.band] = (bandBreakdown[e.band] || 0) + 1;
      modeBreakdown[e.mode] = (modeBreakdown[e.mode] || 0) + 1;
    }
    return {
      totalContacts: this.entries.length,
      uniqueCallsigns: callsigns.size,
      uniqueCountries: 0, // Would need DXCC lookup
      bandBreakdown,
      modeBreakdown,
      recentContacts: this.entries.slice(0, 10),
    };
  }

  exportADIF(): string {
    let adif = `<ADIF_VER:5>3.1.4\n<PROGRAMID:11>SignalForge\n<PROGRAMVERSION:5>0.6.0\n<EOH>\n\n`;
    for (const e of this.entries) {
      const dt = new Date(e.dateTimeOn);
      const date = dt.toISOString().slice(0, 10).replace(/-/g, '');
      const time = dt.toISOString().slice(11, 15).replace(':', '');
      adif += this.adifField('CALL', e.callsign);
      adif += this.adifField('QSO_DATE', date);
      adif += this.adifField('TIME_ON', time);
      adif += this.adifField('BAND', e.band);
      adif += this.adifField('MODE', e.mode);
      adif += this.adifField('FREQ', (e.frequency / 1e6).toFixed(6));
      adif += this.adifField('RST_SENT', e.rstSent);
      adif += this.adifField('RST_RCVD', e.rstReceived);
      if (e.name) adif += this.adifField('NAME', e.name);
      if (e.qth) adif += this.adifField('QTH', e.qth);
      if (e.gridSquare) adif += this.adifField('GRIDSQUARE', e.gridSquare);
      if (e.power) adif += this.adifField('TX_PWR', String(e.power));
      if (e.notes) adif += this.adifField('COMMENT', e.notes);
      adif += this.adifField('QSL_SENT', e.qslSent);
      adif += this.adifField('QSL_RCVD', e.qslReceived);
      if (e.myCallsign) adif += this.adifField('STATION_CALLSIGN', e.myCallsign);
      if (e.myGrid) adif += this.adifField('MY_GRIDSQUARE', e.myGrid);
      adif += '<EOR>\n\n';
    }
    return adif;
  }

  importADIF(adifContent: string): number {
    const records = adifContent.split(/<EOR>/gi);
    let imported = 0;
    for (const record of records) {
      if (!record.trim() || record.includes('<EOH>')) continue;
      const fields = this.parseADIFRecord(record);
      if (!fields.CALL) continue;

      const freq = fields.FREQ ? parseFloat(fields.FREQ) * 1e6 : 14200000;
      this.addEntry({
        callsign: fields.CALL,
        frequency: freq,
        band: fields.BAND || this.freqToBand(freq),
        mode: fields.MODE || 'SSB',
        rstSent: fields.RST_SENT || '59',
        rstReceived: fields.RST_RCVD || '59',
        dateTimeOn: fields.QSO_DATE ? this.parseADIFDate(fields.QSO_DATE, fields.TIME_ON) : Date.now(),
        name: fields.NAME,
        qth: fields.QTH,
        gridSquare: fields.GRIDSQUARE,
        power: fields.TX_PWR ? parseFloat(fields.TX_PWR) : undefined,
        notes: fields.COMMENT,
        qslSent: (fields.QSL_SENT as LogEntry['qslSent']) || 'N',
        qslReceived: (fields.QSL_RCVD as LogEntry['qslReceived']) || 'N',
        myCallsign: fields.STATION_CALLSIGN,
        myGrid: fields.MY_GRIDSQUARE,
        tags: [],
      });
      imported++;
    }
    return imported;
  }

  private adifField(name: string, value: string): string {
    return `<${name}:${value.length}>${value}\n`;
  }

  private parseADIFRecord(record: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const re = /<(\w+):(\d+)(?::(\w+))?>/gi;
    let match;
    while ((match = re.exec(record)) !== null) {
      const name = match[1].toUpperCase();
      const len = parseInt(match[2]);
      const startIdx = match.index + match[0].length;
      fields[name] = record.substring(startIdx, startIdx + len).trim();
    }
    return fields;
  }

  private parseADIFDate(date: string, time?: string): number {
    const y = parseInt(date.slice(0, 4));
    const m = parseInt(date.slice(4, 6)) - 1;
    const d = parseInt(date.slice(6, 8));
    const h = time ? parseInt(time.slice(0, 2)) : 0;
    const min = time ? parseInt(time.slice(2, 4)) : 0;
    return new Date(y, m, d, h, min).getTime();
  }

  private freqToBand(freq: number): string {
    const mhz = freq / 1e6;
    if (mhz < 2) return '160m';
    if (mhz < 4) return '80m';
    if (mhz < 8) return '40m';
    if (mhz < 11) return '30m';
    if (mhz < 15) return '20m';
    if (mhz < 19) return '17m';
    if (mhz < 22) return '15m';
    if (mhz < 25) return '12m';
    if (mhz < 30) return '10m';
    if (mhz < 55) return '6m';
    if (mhz < 148) return '2m';
    if (mhz < 450) return '70cm';
    return 'unknown';
  }
}
