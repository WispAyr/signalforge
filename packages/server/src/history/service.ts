import EventEmitter from 'events';
import type { SignalHistoryEntry, HistoryQuery, HistoryConfig, HistoryStats } from '@signalforge/shared';

export class HistoryService extends EventEmitter {
  private entries: SignalHistoryEntry[] = [];
  private config: HistoryConfig = {
    enabled: true,
    retentionDays: 30,
    recordSignals: true,
    recordDecodes: true,
    recordEvents: true,
    maxStorageMb: 500,
  };

  constructor() {
    super();
    // Generate some demo history
    this.generateDemoHistory();
    // Cleanup old entries periodically
    setInterval(() => this.cleanup(), 3600000);
  }

  private generateDemoHistory() {
    const now = Date.now();
    const entries: SignalHistoryEntry[] = [];
    const sources = ['local', 'edge-node-1', 'edge-node-2'];
    const signals = [
      { freq: 145800000, mode: 'FM', decoder: 'aprs', data: 'M0ABC>APRS: Position report' },
      { freq: 1090000000, mode: 'PULSE', decoder: 'adsb', data: 'BAW256 FL380 HDG270' },
      { freq: 137912500, mode: 'FM', decoder: 'apt', data: 'NOAA-18 APT image frame' },
      { freq: 433920000, mode: 'OOK', decoder: 'rtl433', data: 'Oregon Scientific THN132N: 21.3°C' },
      { freq: 156800000, mode: 'FM', decoder: 'ais', data: 'MMSI 235012345 Vessel SPIRIT OF KENT' },
      { freq: 438500000, mode: 'DMR', decoder: 'dmr', data: 'TG 2350 Slot 1: M0XYZ' },
      { freq: 161975000, mode: 'FM', decoder: 'ais', data: 'MMSI 211234567 Container MAERSK BERGEN' },
    ];

    for (let i = 0; i < 500; i++) {
      const sig = signals[Math.floor(Math.random() * signals.length)];
      entries.push({
        id: `hist-${i}`,
        frequencyHz: sig.freq + Math.floor(Math.random() * 1000 - 500),
        mode: sig.mode,
        signalStrengthDbm: -40 - Math.random() * 60,
        decoderType: sig.decoder,
        decodedData: sig.data,
        timestamp: now - Math.random() * 86400000 * 7,
        source: sources[Math.floor(Math.random() * sources.length)],
      });
    }
    this.entries = entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  record(entry: Omit<SignalHistoryEntry, 'id'>): SignalHistoryEntry {
    if (!this.config.enabled) return { ...entry, id: 'disabled' };
    const full: SignalHistoryEntry = { ...entry, id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
    this.entries.unshift(full);
    this.emit('recorded', full);
    return full;
  }

  query(q: HistoryQuery): SignalHistoryEntry[] {
    let results = this.entries.filter(e => e.timestamp >= q.startTime && e.timestamp <= q.endTime);
    if (q.frequencyHz) results = results.filter(e => Math.abs(e.frequencyHz - q.frequencyHz!) < 5000);
    if (q.frequencyRangeHz) results = results.filter(e => e.frequencyHz >= q.frequencyRangeHz![0] && e.frequencyHz <= q.frequencyRangeHz![1]);
    if (q.mode) results = results.filter(e => e.mode === q.mode);
    if (q.decoderType) results = results.filter(e => e.decoderType === q.decoderType);
    if (q.offset) results = results.slice(q.offset);
    return results.slice(0, q.limit || 100);
  }

  getStats(): HistoryStats {
    const byDecoder: Record<string, number> = {};
    this.entries.forEach(e => { if (e.decoderType) byDecoder[e.decoderType] = (byDecoder[e.decoderType] || 0) + 1; });
    return {
      totalEntries: this.entries.length,
      oldestEntry: this.entries.length ? this.entries[this.entries.length - 1].timestamp : 0,
      newestEntry: this.entries.length ? this.entries[0].timestamp : 0,
      storageSizeMb: Math.round(JSON.stringify(this.entries).length / 1024 / 1024 * 100) / 100,
      entriesByDecoder: byDecoder,
    };
  }

  getConfig(): HistoryConfig { return { ...this.config }; }
  updateConfig(partial: Partial<HistoryConfig>): HistoryConfig { Object.assign(this.config, partial); return this.config; }

  private cleanup() {
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    this.entries = this.entries.filter(e => e.timestamp > cutoff);
  }
}
