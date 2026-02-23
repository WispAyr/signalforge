// ============================================================================
// SignalForge — POCSAG/FLEX Pager Decoder Service (Enhanced)
// ============================================================================
import { EventEmitter } from 'events';
import type { PagerMessage, PagerFilter, PagerAlert, PagerConfig, PagerStats, PagerProtocol } from '@signalforge/shared';

export class PagerService extends EventEmitter {
  private messages: PagerMessage[] = [];
  private filters: PagerFilter[] = [];
  private alerts: PagerAlert[] = [];
  private config: PagerConfig = {
    enabled: false, source: 'multimon-ng', host: 'localhost', port: 1433,
    pocsagEnabled: true, flexEnabled: true, baudRates: [512, 1200, 2400],
  };
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getMessages(limit = 100, protocol?: PagerProtocol): PagerMessage[] {
    let msgs = this.messages;
    if (protocol) msgs = msgs.filter(m => m.protocol === protocol);
    return msgs.slice(0, limit);
  }

  getFilters(): PagerFilter[] { return this.filters; }
  addFilter(f: Omit<PagerFilter, 'id'>): PagerFilter {
    const filter: PagerFilter = { ...f, id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
    this.filters.push(filter);
    return filter;
  }
  removeFilter(id: string) { this.filters = this.filters.filter(f => f.id !== id); }

  getAlerts(limit = 100): PagerAlert[] { return this.alerts.slice(0, limit); }
  acknowledgeAlert(id: string): boolean {
    const a = this.alerts.find(a => a.id === id);
    if (a) { a.acknowledged = true; return true; }
    return false;
  }

  getConfig(): PagerConfig { return this.config; }
  updateConfig(cfg: Partial<PagerConfig>): PagerConfig {
    Object.assign(this.config, cfg);
    return this.config;
  }

  getStats(): PagerStats {
    const capcodes = new Set(this.messages.map(m => m.capcode));
    const oneHourAgo = Date.now() - 3600000;
    const recentCount = this.messages.filter(m => m.timestamp > oneHourAgo).length;
    return {
      totalMessages: this.messages.length,
      pocsagMessages: this.messages.filter(m => m.protocol === 'POCSAG').length,
      flexMessages: this.messages.filter(m => m.protocol === 'FLEX').length,
      uniqueCapcodes: capcodes.size,
      messagesPerHour: recentCount,
    };
  }

  processMessage(data: { protocol: PagerProtocol; capcode: number; address: number; function: number; content: string; baudRate?: number; phase?: string }) {
    const msg: PagerMessage = {
      id: `pg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      protocol: data.protocol, timestamp: Date.now(), capcode: data.capcode,
      address: data.address, function: data.function,
      messageType: /^\d+$/.test(data.content) ? 'numeric' : data.content ? 'alpha' : 'tone',
      content: data.content, baudRate: data.baudRate || 1200,
      phase: data.phase,
    };
    this.messages.unshift(msg);
    if (this.messages.length > 5000) this.messages = this.messages.slice(0, 5000);

    this.emit('message', msg);

    // Check filters
    for (const f of this.filters) {
      const capcodeMatch = f.capcodes.length === 0 || f.capcodes.includes(msg.capcode);
      const keywordMatch = f.keywords.length === 0 || f.keywords.some(k => msg.content.toLowerCase().includes(k.toLowerCase()));
      if (capcodeMatch && keywordMatch && f.alertEnabled) {
        const alert: PagerAlert = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          filterId: f.id, filterName: f.name, message: msg, timestamp: Date.now(), acknowledged: false,
        };
        this.alerts.unshift(alert);
        if (this.alerts.length > 500) this.alerts = this.alerts.slice(0, 500);
        this.emit('alert', alert);
      }
    }
  }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    const demoMessages = [
      { protocol: 'POCSAG' as const, capcode: 1234000, content: 'FIRE ALARM: Building 7, Floor 3 - Smoke detected', baudRate: 1200 },
      { protocol: 'POCSAG' as const, capcode: 1234001, content: 'AMBULANCE REQ: 42 High Street, chest pain, male 65', baudRate: 1200 },
      { protocol: 'FLEX' as const, capcode: 2048576, content: 'Weather Alert: Heavy rain warning SW England', baudRate: 1600 },
      { protocol: 'POCSAG' as const, capcode: 1234002, content: '07700900123', baudRate: 512 },
      { protocol: 'FLEX' as const, capcode: 2048577, content: 'HOSPITAL PAGE: Dr. Smith to A&E immediately', baudRate: 3200 },
      { protocol: 'POCSAG' as const, capcode: 1234003, content: 'RTC M4 J18-19, 3 vehicles, injuries reported', baudRate: 1200 },
    ];
    this.demoInterval = setInterval(() => {
      const demo = demoMessages[Math.floor(Math.random() * demoMessages.length)];
      this.processMessage({ ...demo, address: demo.capcode, function: Math.floor(Math.random() * 4) });
    }, 8000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
