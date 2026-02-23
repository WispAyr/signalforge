// ============================================================================
// SignalForge — Utility Meter Reading Service
// ============================================================================
import { EventEmitter } from 'events';
import type { MeterDevice, MeterReading, MeterType, MeterConfig, MeterStats } from '@signalforge/shared';

export class MeterService extends EventEmitter {
  private meters = new Map<string, MeterDevice>();
  private config: MeterConfig = { enabled: false, source: 'rtl_433', host: 'localhost', port: 1433, meterIds: [] };
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getMeters(): MeterDevice[] { return Array.from(this.meters.values()); }
  getMeter(id: string): MeterDevice | undefined { return this.meters.get(id); }
  getConfig(): MeterConfig { return this.config; }
  updateConfig(cfg: Partial<MeterConfig>): MeterConfig { Object.assign(this.config, cfg); return this.config; }

  getStats(): MeterStats {
    const byType: Record<MeterType, number> = { electric: 0, gas: 0, water: 0 };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let readingsToday = 0;
    for (const m of this.meters.values()) {
      byType[m.type] = (byType[m.type] || 0) + 1;
      readingsToday += m.readings.filter(r => r.timestamp >= today.getTime()).length;
    }
    return { totalMeters: this.meters.size, readingsToday, byType };
  }

  processReading(meterId: string, type: MeterType, reading: MeterReading, protocol = 'AMR') {
    let meter = this.meters.get(meterId);
    if (!meter) {
      meter = { id: meterId, meterId, type, protocol, firstSeen: Date.now(), lastSeen: Date.now(), readings: [], lastReading: null };
      this.meters.set(meterId, meter);
    }
    meter.lastSeen = Date.now();
    meter.lastReading = reading;
    meter.readings.push(reading);
    if (meter.readings.length > 1000) meter.readings = meter.readings.slice(-1000);
    this.emit('reading', { meter, reading });
  }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    const demoMeters = [
      { id: 'E-12345678', type: 'electric' as const, base: 45678, unit: 'kWh', rate: 0.5 },
      { id: 'G-87654321', type: 'gas' as const, base: 12345, unit: 'ft³', rate: 0.1 },
      { id: 'W-11223344', type: 'water' as const, base: 567, unit: 'gal', rate: 0.3 },
    ];
    let tick = 0;
    this.demoInterval = setInterval(() => {
      tick++;
      const dm = demoMeters[tick % demoMeters.length];
      const reading: MeterReading = {
        timestamp: Date.now(), consumption: dm.base + tick * dm.rate,
        unit: dm.unit, rate: dm.rate * (0.8 + Math.random() * 0.4),
        rssi: -40 - Math.random() * 40, raw: {},
      };
      this.processReading(dm.id, dm.type, reading);
    }, 10000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
