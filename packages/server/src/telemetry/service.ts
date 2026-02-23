// ============================================================================
// SignalForge Telemetry Service
// ============================================================================
import { EventEmitter } from 'events';
import type { TelemetryFrame, TelemetryDefinition, TelemetryValue, TelemetryTimeSeries } from '@signalforge/shared';

// Demo telemetry definitions
const DEMO_DEFINITIONS: TelemetryDefinition[] = [
  {
    id: 'iss-zarya', satelliteName: 'ISS (ZARYA)', noradId: 25544,
    protocol: 'ax25', source: 'custom',
    fields: [
      { key: 'batt_v', name: 'Battery Voltage', offset: 0, length: 2, type: 'uint16', endian: 'big', scale: 0.01, unit: 'V', category: 'power' },
      { key: 'solar_i', name: 'Solar Panel Current', offset: 2, length: 2, type: 'int16', endian: 'big', scale: 0.001, unit: 'A', category: 'power' },
      { key: 'temp_obc', name: 'OBC Temperature', offset: 4, length: 2, type: 'int16', endian: 'big', scale: 0.1, offset_val: -40, unit: '°C', category: 'thermal' },
      { key: 'temp_batt', name: 'Battery Temperature', offset: 6, length: 2, type: 'int16', endian: 'big', scale: 0.1, offset_val: -40, unit: '°C', category: 'thermal' },
      { key: 'rssi', name: 'RSSI', offset: 8, length: 1, type: 'uint8', endian: 'big', scale: -0.5, offset_val: 0, unit: 'dBm', category: 'comms' },
      { key: 'reboot_cnt', name: 'Reboot Count', offset: 9, length: 2, type: 'uint16', endian: 'big', unit: '', category: 'system' },
    ],
  },
];

export class TelemetryService extends EventEmitter {
  private frames: TelemetryFrame[] = [];
  private definitions = new Map<number, TelemetryDefinition>();
  private timeSeries = new Map<string, { timestamp: number; value: number }[]>();
  private maxFrames = 2000;
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    for (const def of DEMO_DEFINITIONS) {
      this.definitions.set(def.noradId, def);
    }
  }

  startDemoTelemetry() {
    if (this.demoInterval) return;
    let tick = 0;
    this.demoInterval = setInterval(() => {
      tick++;
      const frame = this.generateDemoFrame(tick);
      this.addFrame(frame);
    }, 5000);
  }

  stopDemoTelemetry() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
  }

  private generateDemoFrame(tick: number): TelemetryFrame {
    const t = tick * 0.1;
    const values: TelemetryValue[] = [
      { key: 'batt_v', name: 'Battery Voltage', value: +(7.2 + 0.4 * Math.sin(t * 0.3) + (Math.random() - 0.5) * 0.1).toFixed(2), unit: 'V', category: 'power', min: 6.0, max: 8.4, warning: { low: 6.5 }, critical: { low: 6.0 } },
      { key: 'solar_i', name: 'Solar Panel Current', value: +(0.8 + 0.3 * Math.max(0, Math.sin(t * 0.2)) + (Math.random() - 0.5) * 0.05).toFixed(3), unit: 'A', category: 'power', min: 0, max: 1.5 },
      { key: 'temp_obc', name: 'OBC Temperature', value: +(22 + 5 * Math.sin(t * 0.15) + (Math.random() - 0.5) * 2).toFixed(1), unit: '°C', category: 'thermal', min: -20, max: 60, warning: { high: 50 }, critical: { high: 60 } },
      { key: 'temp_batt', name: 'Battery Temperature', value: +(18 + 3 * Math.sin(t * 0.12) + (Math.random() - 0.5) * 1).toFixed(1), unit: '°C', category: 'thermal', min: -10, max: 45, warning: { low: 0, high: 40 } },
      { key: 'rssi', name: 'RSSI', value: +(-85 + 10 * Math.sin(t * 0.4) + (Math.random() - 0.5) * 5).toFixed(0), unit: 'dBm', category: 'comms' },
      { key: 'reboot_cnt', name: 'Reboot Count', value: 3, unit: '', category: 'system' },
    ];

    return {
      id: `tlm-${Date.now()}`,
      satelliteName: 'ISS (ZARYA)',
      noradId: 25544,
      timestamp: Date.now(),
      protocol: 'ax25',
      rawHex: Array.from({ length: 12 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(''),
      parsed: values,
      source: 'demo',
    };
  }

  addFrame(frame: TelemetryFrame) {
    this.frames.push(frame);
    if (this.frames.length > this.maxFrames) this.frames.shift();

    // Update time series
    for (const val of frame.parsed) {
      if (typeof val.value === 'number') {
        const key = `${frame.noradId}:${val.key}`;
        if (!this.timeSeries.has(key)) this.timeSeries.set(key, []);
        const series = this.timeSeries.get(key)!;
        series.push({ timestamp: frame.timestamp, value: val.value });
        if (series.length > 500) series.shift();
      }
    }

    this.emit('frame', frame);
  }

  getFrames(noradId?: number, limit = 50): TelemetryFrame[] {
    let f = this.frames;
    if (noradId) f = f.filter(fr => fr.noradId === noradId);
    return f.slice(-limit);
  }

  getTimeSeries(noradId: number, key: string): TelemetryTimeSeries | null {
    const seriesKey = `${noradId}:${key}`;
    const points = this.timeSeries.get(seriesKey);
    if (!points) return null;
    const def = this.definitions.get(noradId);
    const fieldDef = def?.fields.find(f => f.key === key);
    return { key, name: fieldDef?.name || key, unit: fieldDef?.unit, points };
  }

  getLatestValues(noradId: number): TelemetryValue[] {
    const frames = this.getFrames(noradId, 1);
    return frames[0]?.parsed || [];
  }

  getDefinitions(): TelemetryDefinition[] { return Array.from(this.definitions.values()); }
  addDefinition(def: TelemetryDefinition) { this.definitions.set(def.noradId, def); }
}
