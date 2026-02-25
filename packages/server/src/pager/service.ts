// ============================================================================
// SignalForge — POCSAG/FLEX Pager Decoder Service (Upgraded with SQLite)
// ============================================================================
import { EventEmitter } from 'events';
import type { PagerMessage, PagerFilter, PagerAlert, PagerConfig, PagerStats, PagerProtocol } from '@signalforge/shared';
import { PagerDatabase, cleanContent, classifyCapcode } from './db.js';
import { FrequencyDiscovery } from './discovery.js';

const COVERED_FREQS_MHZ = [153.025, 153.075, 153.275, 153.350, 153.375, 153.425];

export class PagerService extends EventEmitter {
  private messages: PagerMessage[] = [];
  private filters: PagerFilter[] = [];
  private alerts: PagerAlert[] = [];
  private config: PagerConfig = {
    enabled: false, source: 'multimon-ng', host: 'localhost', port: 1433,
    pocsagEnabled: true, flexEnabled: true, baudRates: [512, 1200, 2400],
  };
  private demoInterval: ReturnType<typeof setInterval> | null = null;
  private db: PagerDatabase;
  private freqDiscovery: FrequencyDiscovery;

  constructor() {
    super();
    this.db = new PagerDatabase();
    this.freqDiscovery = new FrequencyDiscovery(COVERED_FREQS_MHZ);
    console.log('📟 Pager SQLite database initialized');
  }

  getMessages(limit = 100, protocol?: PagerProtocol): PagerMessage[] {
    let msgs = this.messages;
    if (protocol) msgs = msgs.filter(m => m.protocol === protocol);
    return msgs.slice(0, limit);
  }

  // New: DB-backed message query
  getMessagesFromDb(opts: { limit?: number; offset?: number; freq?: number; capcode?: number; search?: string; since?: number }) {
    return this.db.getMessages(opts);
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

  // New: DB-backed stats
  getDbStats() { return this.db.getStats(); }
  getHourlyStats() { return this.db.getHourlyStats(); }

  // New: Capcode operations
  getCapcodes() { return this.db.getCapcodes(); }
  updateCapcode(capcode: number, updates: { label?: string; category?: string; notes?: string }) {
    this.db.updateCapcode(capcode, updates);
  }

  // New: Keyword alert operations
  getKeywordAlerts() { return this.db.getAlerts(); }
  addKeywordAlert(keyword: string, category: string, priority: string) { return this.db.addAlert(keyword, category, priority); }
  deleteKeywordAlert(id: number) { this.db.deleteAlert(id); }

  // New: Frequency discovery
  getDiscoveredFrequencies() { return this.freqDiscovery.getDiscovered(); }
  processFFT(data: any) { this.freqDiscovery.processFFT(data); }

  processMessage(data: { protocol: PagerProtocol; capcode: number; address: number; function: number; content: string; baudRate?: number; phase?: string; frequency?: number; channel?: string }) {
    const contentClean = cleanContent(data.content);
    const isEmpty = !contentClean || contentClean.trim().length === 0;

    const msg: PagerMessage = {
      id: `pg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      protocol: data.protocol, timestamp: Date.now(), capcode: data.capcode,
      address: data.address, function: data.function,
      messageType: /^\d+$/.test(contentClean) ? 'numeric' : contentClean ? 'alpha' : 'tone',
      content: contentClean || data.content, // Use cleaned content for display
      baudRate: data.baudRate || 1200,
      phase: data.phase, frequency: data.frequency,
    };

    // Deduplication
    let duplicateGroupId: string | null = null;
    if (!isEmpty) {
      duplicateGroupId = this.db.findDuplicate(contentClean);
    }

    // Write to SQLite
    try {
      this.db.insertMessage({
        id: msg.id,
        timestamp: msg.timestamp,
        frequency: data.frequency || null,
        protocol: data.protocol,
        baud_rate: data.baudRate || 1200,
        capcode: data.capcode,
        function: data.function,
        content_raw: data.content,
        content_clean: contentClean,
        type: msg.messageType,
        duplicate_group_id: duplicateGroupId,
        is_empty: isEmpty ? 1 : 0,
      });

      // Update capcode DB
      this.db.upsertCapcode(data.capcode);

      // Update hourly stats
      this.db.incrementHourlyStat(data.frequency || null, data.protocol);
    } catch (e) {
      console.error('📟 DB write error:', e);
    }

    // In-memory store (keep for backward compat)
    this.messages.unshift(msg);
    if (this.messages.length > 5000) this.messages = this.messages.slice(0, 5000);

    // Don't broadcast empty messages
    if (isEmpty) return;

    // Enrich message with capcode info and duplicate data for client
    const capcodeInfo = this.db.getCapcodeLabel(data.capcode);
    const enriched = {
      ...msg,
      content_clean: contentClean,
      content_raw: data.content,
      duplicate_group_id: duplicateGroupId,
      capcode_label: capcodeInfo?.label || '',
      capcode_category: capcodeInfo?.category || classifyCapcode(data.capcode),
    };

    this.emit('message', enriched);

    // Check keyword alerts
    const matchedAlerts = this.db.checkAlerts(contentClean);
    if (matchedAlerts.length > 0) {
      const alertEvent = {
        message: enriched,
        matched_keywords: matchedAlerts.map(a => a.keyword),
        priority: matchedAlerts.some(a => a.priority === 'high') ? 'high' : 'medium',
      };
      this.emit('keyword_alert', alertEvent);
    }

    // Check filters (legacy)
    for (const f of this.filters) {
      const capcodeMatch = f.capcodes.length === 0 || f.capcodes.includes(msg.capcode);
      const keywordMatch = f.keywords.length === 0 || f.keywords.some(k => contentClean.toLowerCase().includes(k.toLowerCase()));
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
      { protocol: 'POCSAG' as const, capcode: 1234000, content: 'FIRE ALARM: Building 7, Floor 3 - Smoke detected', baudRate: 1200, frequency: 153350000 },
      { protocol: 'POCSAG' as const, capcode: 1234001, content: 'AMBULANCE REQ: 42 High Street, chest pain, male 65', baudRate: 1200, frequency: 153025000 },
      { protocol: 'FLEX' as const, capcode: 2048576, content: 'Weather Alert: Heavy rain warning SW England', baudRate: 1600, frequency: 153275000 },
      { protocol: 'POCSAG' as const, capcode: 1234002, content: '07700900123', baudRate: 512, frequency: 153075000 },
      { protocol: 'FLEX' as const, capcode: 2048577, content: 'HOSPITAL PAGE: Dr. Smith to A&E immediately', baudRate: 3200, frequency: 153375000 },
      { protocol: 'POCSAG' as const, capcode: 1234003, content: 'RTC M4 J18-19, 3 vehicles, injuries reported', baudRate: 1200, frequency: 153425000 },
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
