import { EventEmitter } from 'events';
import { db } from '../services/database.js';
import type { LogEntry, LogbookStats, ADIFField } from '@signalforge/shared';

function rowToEntry(row: any): LogEntry {
  return {
    id: row.id,
    callsign: row.callsign,
    frequency: row.frequency,
    band: row.band,
    mode: row.mode,
    rstSent: row.rst_sent,
    rstReceived: row.rst_received,
    dateTimeOn: row.date_time_on,
    dateTimeOff: row.date_time_off || undefined,
    name: row.name || undefined,
    qth: row.qth || undefined,
    gridSquare: row.grid_square || undefined,
    power: row.power || undefined,
    notes: row.notes || undefined,
    qslSent: row.qsl_sent || 'N',
    qslReceived: row.qsl_received || 'N',
    qslVia: row.qsl_via || undefined,
    eqsl: !!row.eqsl,
    lotw: !!row.lotw,
    operator: row.operator || undefined,
    myCallsign: row.my_callsign || undefined,
    myGrid: row.my_grid || undefined,
    contestId: row.contest_id || undefined,
    serialSent: row.serial_sent || undefined,
    serialReceived: row.serial_received || undefined,
    recordingId: row.recording_id || undefined,
    waterfallId: row.waterfall_id || undefined,
    tags: JSON.parse(row.tags || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class LogbookService extends EventEmitter {
  private insertStmt = db.prepare(`
    INSERT INTO logbook (id, callsign, frequency, band, mode, rst_sent, rst_received,
      date_time_on, date_time_off, name, qth, grid_square, power, notes,
      qsl_sent, qsl_received, qsl_via, eqsl, lotw, operator, my_callsign, my_grid,
      contest_id, serial_sent, serial_received, recording_id, waterfall_id, tags,
      created_at, updated_at)
    VALUES (@id, @callsign, @frequency, @band, @mode, @rst_sent, @rst_received,
      @date_time_on, @date_time_off, @name, @qth, @grid_square, @power, @notes,
      @qsl_sent, @qsl_received, @qsl_via, @eqsl, @lotw, @operator, @my_callsign, @my_grid,
      @contest_id, @serial_sent, @serial_received, @recording_id, @waterfall_id, @tags,
      @created_at, @updated_at)
  `);

  addEntry(entry: Omit<LogEntry, 'id' | 'createdAt' | 'updatedAt'>): LogEntry {
    const now = Date.now();
    const id = `log-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const row = {
      id,
      callsign: entry.callsign,
      frequency: entry.frequency,
      band: entry.band,
      mode: entry.mode,
      rst_sent: entry.rstSent || '59',
      rst_received: entry.rstReceived || '59',
      date_time_on: entry.dateTimeOn || now,
      date_time_off: entry.dateTimeOff || null,
      name: entry.name || null,
      qth: entry.qth || null,
      grid_square: entry.gridSquare || null,
      power: entry.power || null,
      notes: entry.notes || null,
      qsl_sent: entry.qslSent || 'N',
      qsl_received: entry.qslReceived || 'N',
      qsl_via: entry.qslVia || null,
      eqsl: entry.eqsl ? 1 : 0,
      lotw: entry.lotw ? 1 : 0,
      operator: entry.operator || null,
      my_callsign: entry.myCallsign || null,
      my_grid: entry.myGrid || null,
      contest_id: entry.contestId || null,
      serial_sent: entry.serialSent || null,
      serial_received: entry.serialReceived || null,
      recording_id: entry.recordingId || null,
      waterfall_id: entry.waterfallId || null,
      tags: JSON.stringify(entry.tags || []),
      created_at: now,
      updated_at: now,
    };
    this.insertStmt.run(row);
    const e = rowToEntry({ ...row, created_at: now, updated_at: now });
    this.emit('entry_added', e);
    return e;
  }

  updateEntry(id: string, updates: Partial<LogEntry>): LogEntry | null {
    const existing = db.prepare('SELECT * FROM logbook WHERE id = ?').get(id) as any;
    if (!existing) return null;
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    const fieldMap: Record<string, string> = {
      callsign: 'callsign', frequency: 'frequency', band: 'band', mode: 'mode',
      rstSent: 'rst_sent', rstReceived: 'rst_received', dateTimeOn: 'date_time_on',
      dateTimeOff: 'date_time_off', name: 'name', qth: 'qth', gridSquare: 'grid_square',
      power: 'power', notes: 'notes', qslSent: 'qsl_sent', qslReceived: 'qsl_received',
      qslVia: 'qsl_via', operator: 'operator', myCallsign: 'my_callsign', myGrid: 'my_grid',
      contestId: 'contest_id', serialSent: 'serial_sent', serialReceived: 'serial_received',
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if ((updates as any)[key] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push((updates as any)[key]);
      }
    }
    if (updates.eqsl !== undefined) { sets.push('eqsl = ?'); vals.push(updates.eqsl ? 1 : 0); }
    if (updates.lotw !== undefined) { sets.push('lotw = ?'); vals.push(updates.lotw ? 1 : 0); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }
    vals.push(id);
    db.prepare(`UPDATE logbook SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const updated = db.prepare('SELECT * FROM logbook WHERE id = ?').get(id) as any;
    const entry = rowToEntry(updated);
    this.emit('entry_updated', entry);
    return entry;
  }

  deleteEntry(id: string): boolean {
    const result = db.prepare('DELETE FROM logbook WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getEntries(opts?: { callsign?: string; band?: string; mode?: string; startDate?: number; endDate?: number; search?: string; limit?: number; offset?: number }): LogEntry[] {
    let sql = 'SELECT * FROM logbook WHERE 1=1';
    const params: any[] = [];
    if (opts?.callsign) { sql += ' AND callsign LIKE ?'; params.push(`%${opts.callsign}%`); }
    if (opts?.band) { sql += ' AND band = ?'; params.push(opts.band); }
    if (opts?.mode) { sql += ' AND mode = ?'; params.push(opts.mode); }
    if (opts?.startDate) { sql += ' AND date_time_on >= ?'; params.push(opts.startDate); }
    if (opts?.endDate) { sql += ' AND date_time_on <= ?'; params.push(opts.endDate); }
    if (opts?.search) {
      sql += ' AND (callsign LIKE ? OR notes LIKE ? OR name LIKE ?)';
      const s = `%${opts.search}%`;
      params.push(s, s, s);
    }
    sql += ' ORDER BY date_time_on DESC LIMIT ? OFFSET ?';
    params.push(opts?.limit || 100, opts?.offset || 0);
    return (db.prepare(sql).all(...params) as any[]).map(rowToEntry);
  }

  getEntry(id: string): LogEntry | undefined {
    const row = db.prepare('SELECT * FROM logbook WHERE id = ?').get(id) as any;
    return row ? rowToEntry(row) : undefined;
  }

  getStats(): LogbookStats {
    const total = (db.prepare('SELECT COUNT(*) as c FROM logbook').get() as any).c;
    const uniqueCallsigns = (db.prepare('SELECT COUNT(DISTINCT callsign) as c FROM logbook').get() as any).c;
    const bandRows = db.prepare('SELECT band, COUNT(*) as c FROM logbook GROUP BY band').all() as any[];
    const modeRows = db.prepare('SELECT mode, COUNT(*) as c FROM logbook GROUP BY mode').all() as any[];
    const recent = (db.prepare('SELECT * FROM logbook ORDER BY date_time_on DESC LIMIT 10').all() as any[]).map(rowToEntry);
    const bandBreakdown: Record<string, number> = {};
    for (const r of bandRows) bandBreakdown[r.band] = r.c;
    const modeBreakdown: Record<string, number> = {};
    for (const r of modeRows) modeBreakdown[r.mode] = r.c;
    return { totalContacts: total, uniqueCallsigns, uniqueCountries: 0, bandBreakdown, modeBreakdown, recentContacts: recent };
  }

  exportADIF(): string {
    const entries = (db.prepare('SELECT * FROM logbook ORDER BY date_time_on').all() as any[]).map(rowToEntry);
    let adif = `<ADIF_VER:5>3.1.4\n<PROGRAMID:11>SignalForge\n<PROGRAMVERSION:5>0.6.0\n<EOH>\n\n`;
    for (const e of entries) {
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
    const insertMany = db.transaction(() => {
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
    });
    insertMany();
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
