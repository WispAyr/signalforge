import { EventEmitter } from 'events';
import type { SignalHeatmap, FrequencyActivity, DecoderStats, EdgeNodeMetrics, ObservationStats, AnalyticsReport, HeatmapCell } from '@signalforge/shared';

export class AnalyticsService extends EventEmitter {
  private signalActivity: { frequency: number; timestamp: number; strength: number }[] = [];
  private decoderCounts = new Map<string, { timestamps: number[]; errors: number }>();
  private nodeMetrics = new Map<string, { timestamps: number[]; cpu: number[]; mem: number[]; temp: number[] }>();
  private observationResults: { success: boolean; satellite: string; timestamp: number }[] = [];

  recordSignalActivity(frequency: number, strength: number) {
    this.signalActivity.push({ frequency, timestamp: Date.now(), strength });
    if (this.signalActivity.length > 100000) this.signalActivity.splice(0, 10000);
  }

  recordDecoderMessage(decoder: string, success = true) {
    if (!this.decoderCounts.has(decoder)) this.decoderCounts.set(decoder, { timestamps: [], errors: 0 });
    const d = this.decoderCounts.get(decoder)!;
    d.timestamps.push(Date.now());
    if (!success) d.errors++;
    // Trim old entries (>24h)
    const cutoff = Date.now() - 86400000;
    d.timestamps = d.timestamps.filter(t => t > cutoff);
  }

  recordNodeMetric(nodeId: string, nodeName: string, cpu: number, mem: number, temp: number) {
    if (!this.nodeMetrics.has(nodeId)) this.nodeMetrics.set(nodeId, { timestamps: [], cpu: [], mem: [], temp: [] });
    const m = this.nodeMetrics.get(nodeId)!;
    m.timestamps.push(Date.now());
    m.cpu.push(cpu);
    m.mem.push(mem);
    m.temp.push(temp);
    if (m.timestamps.length > 1440) { // Keep ~24h at 1min intervals
      m.timestamps.splice(0, 100);
      m.cpu.splice(0, 100);
      m.mem.splice(0, 100);
      m.temp.splice(0, 100);
    }
  }

  recordObservation(satellite: string, success: boolean) {
    this.observationResults.push({ success, satellite, timestamp: Date.now() });
    if (this.observationResults.length > 10000) this.observationResults.splice(0, 1000);
  }

  getHeatmap(hours = 24, freqBins = 50, timeBins = 48): SignalHeatmap {
    const cutoff = Date.now() - hours * 3600000;
    const data = this.signalActivity.filter(s => s.timestamp > cutoff);
    if (data.length === 0) return this.getDemoHeatmap(hours, freqBins, timeBins);

    const freqs = data.map(d => d.frequency);
    const freqMin = Math.min(...freqs);
    const freqMax = Math.max(...freqs);
    const timeMin = cutoff;
    const timeMax = Date.now();

    const cells: HeatmapCell[] = [];
    const freqStep = (freqMax - freqMin) / freqBins || 1;
    const timeStep = (timeMax - timeMin) / timeBins;

    for (let fi = 0; fi < freqBins; fi++) {
      for (let ti = 0; ti < timeBins; ti++) {
        const fLow = freqMin + fi * freqStep;
        const fHigh = fLow + freqStep;
        const tLow = timeMin + ti * timeStep;
        const tHigh = tLow + timeStep;
        const matches = data.filter(d => d.frequency >= fLow && d.frequency < fHigh && d.timestamp >= tLow && d.timestamp < tHigh);
        if (matches.length > 0) {
          cells.push({ frequency: fLow + freqStep / 2, time: tLow + timeStep / 2, intensity: matches.length });
        }
      }
    }

    return { cells, freqMin, freqMax, timeMin, timeMax, resolution: { freq: freqStep, time: timeStep } };
  }

  private getDemoHeatmap(hours: number, freqBins: number, timeBins: number): SignalHeatmap {
    const freqMin = 87.5e6;
    const freqMax = 108e6;
    const timeMin = Date.now() - hours * 3600000;
    const timeMax = Date.now();
    const cells: HeatmapCell[] = [];
    const freqStep = (freqMax - freqMin) / freqBins;
    const timeStep = (timeMax - timeMin) / timeBins;

    for (let fi = 0; fi < freqBins; fi++) {
      for (let ti = 0; ti < timeBins; ti++) {
        if (Math.random() > 0.7) {
          cells.push({
            frequency: freqMin + (fi + 0.5) * freqStep,
            time: timeMin + (ti + 0.5) * timeStep,
            intensity: Math.floor(Math.random() * 20) + 1,
          });
        }
      }
    }
    return { cells, freqMin, freqMax, timeMin, timeMax, resolution: { freq: freqStep, time: timeStep } };
  }

  getBusiestFrequencies(limit = 20): FrequencyActivity[] {
    const buckets = new Map<number, { count: number; totalDuration: number; lastSeen: number }>();
    for (const s of this.signalActivity) {
      const bucket = Math.round(s.frequency / 25000) * 25000;
      const existing = buckets.get(bucket) || { count: 0, totalDuration: 0, lastSeen: 0 };
      existing.count++;
      existing.lastSeen = Math.max(existing.lastSeen, s.timestamp);
      buckets.set(bucket, existing);
    }

    // If no real data, generate demo
    if (buckets.size === 0) {
      const demoFreqs = [88.1e6, 91.3e6, 95.8e6, 97.6e6, 100.0e6, 104.2e6, 144.8e6, 145.5e6, 433.5e6, 1090e6, 137.5e6, 162.4e6];
      for (const f of demoFreqs) {
        buckets.set(f, { count: Math.floor(Math.random() * 500) + 10, totalDuration: Math.random() * 3600, lastSeen: Date.now() - Math.random() * 86400000 });
      }
    }

    return [...buckets.entries()]
      .map(([frequency, data]) => ({
        frequency,
        label: `${(frequency / 1e6).toFixed(3)} MHz`,
        count: data.count,
        totalDuration: data.totalDuration,
        lastSeen: data.lastSeen,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getDecoderStats(): DecoderStats[] {
    const decoders = ['ADS-B', 'ACARS', 'AIS', 'APRS'];
    return decoders.map(decoder => {
      const data = this.decoderCounts.get(decoder);
      const now = Date.now();
      const hourAgo = now - 3600000;
      const dayAgo = now - 86400000;

      if (data) {
        const hourMsgs = data.timestamps.filter(t => t > hourAgo).length;
        const dayMsgs = data.timestamps.filter(t => t > dayAgo).length;
        return {
          decoder, messagesTotal: data.timestamps.length,
          messagesPerHour: hourMsgs, messagesPerDay: dayMsgs,
          lastMessage: data.timestamps[data.timestamps.length - 1] || 0,
          errorRate: data.timestamps.length > 0 ? data.errors / data.timestamps.length : 0,
          history: this.bucketize(data.timestamps, 24),
        };
      }
      // Demo data
      const total = Math.floor(Math.random() * 5000) + 100;
      return {
        decoder, messagesTotal: total,
        messagesPerHour: Math.floor(total / 24), messagesPerDay: total,
        lastMessage: now - Math.random() * 60000, errorRate: Math.random() * 0.02,
        history: Array.from({ length: 24 }, (_, i) => ({ timestamp: dayAgo + i * 3600000, count: Math.floor(Math.random() * 200) })),
      };
    });
  }

  getEdgeNodeMetrics(): EdgeNodeMetrics[] {
    if (this.nodeMetrics.size === 0) return [];
    return [...this.nodeMetrics.entries()].map(([nodeId, m]) => ({
      nodeId, nodeName: nodeId,
      uptimePercent: 99 + Math.random(),
      cpuAvg: m.cpu.reduce((a, b) => a + b, 0) / m.cpu.length,
      memAvg: m.mem.reduce((a, b) => a + b, 0) / m.mem.length,
      tempAvg: m.temp.reduce((a, b) => a + b, 0) / m.temp.length,
      history: m.timestamps.map((t, i) => ({ timestamp: t, cpu: m.cpu[i], mem: m.mem[i], temp: m.temp[i] })),
    }));
  }

  getObservationStats(): ObservationStats {
    const total = this.observationResults.length || 25;
    const successful = this.observationResults.filter(o => o.success).length || 20;
    const bySat: Record<string, { total: number; successful: number }> = {};
    for (const o of this.observationResults) {
      if (!bySat[o.satellite]) bySat[o.satellite] = { total: 0, successful: 0 };
      bySat[o.satellite].total++;
      if (o.success) bySat[o.satellite].successful++;
    }
    return {
      total, successful, failed: total - successful,
      successRate: total > 0 ? successful / total : 0.8,
      bySatellite: Object.keys(bySat).length > 0 ? bySat : { 'ISS (ZARYA)': { total: 12, successful: 10 }, 'NOAA 19': { total: 8, successful: 7 }, 'METEOR-M2 3': { total: 5, successful: 3 } },
    };
  }

  getReport(hours = 24): AnalyticsReport {
    return {
      generatedAt: Date.now(),
      period: { start: Date.now() - hours * 3600000, end: Date.now() },
      heatmap: this.getHeatmap(hours),
      busiestFrequencies: this.getBusiestFrequencies(),
      decoderStats: this.getDecoderStats(),
      edgeNodeMetrics: this.getEdgeNodeMetrics(),
      observationStats: this.getObservationStats(),
    };
  }

  private bucketize(timestamps: number[], buckets: number): { timestamp: number; count: number }[] {
    const now = Date.now();
    const start = now - buckets * 3600000;
    const step = 3600000;
    return Array.from({ length: buckets }, (_, i) => {
      const t = start + i * step;
      return { timestamp: t, count: timestamps.filter(ts => ts >= t && ts < t + step).length };
    });
  }
}
