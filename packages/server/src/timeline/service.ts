// ============================================================================
// SignalForge Timeline Service
// ============================================================================
import { EventEmitter } from 'events';
import type { TimelineEvent, TimelineFilter, TimelineEventType } from '@signalforge/shared';

export class TimelineService extends EventEmitter {
  private events: TimelineEvent[] = [];
  private maxEvents = 5000;

  addEvent(event: Omit<TimelineEvent, 'id'>): TimelineEvent {
    const entry: TimelineEvent = { ...event, id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}` };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.emit('event', entry);
    return entry;
  }

  getEvents(filter?: TimelineFilter, limit = 200, offset = 0): TimelineEvent[] {
    let results = this.events;

    if (filter) {
      if (filter.types?.length) results = results.filter(e => filter.types!.includes(e.type));
      if (filter.sources?.length) results = results.filter(e => filter.sources!.includes(e.source || ''));
      if (filter.search) {
        const q = filter.search.toLowerCase();
        results = results.filter(e => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
      }
      if (filter.frequencyRange) {
        results = results.filter(e => e.frequency && e.frequency >= filter.frequencyRange!.min && e.frequency <= filter.frequencyRange!.max);
      }
      if (filter.timeRange) {
        results = results.filter(e => e.timestamp >= filter.timeRange!.start && e.timestamp <= filter.timeRange!.end);
      }
      if (filter.userId) results = results.filter(e => e.userId === filter.userId);
      if (filter.tags?.length) results = results.filter(e => e.tags?.some(t => filter.tags!.includes(t)));
    }

    return results.slice(-(offset + limit)).slice(0, limit).reverse();
  }

  getEventCount(filter?: TimelineFilter): number {
    return this.getEvents(filter, this.maxEvents).length;
  }

  exportHTML(filter?: TimelineFilter, title = 'SignalForge Timeline Report'): string {
    const events = this.getEvents(filter, 1000);
    return `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>
body { font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e8; padding: 2rem; }
h1 { color: #00e5ff; border-bottom: 2px solid #00e5ff; padding-bottom: 0.5rem; }
.event { padding: 0.5rem; border-left: 3px solid #2a2a4a; margin: 0.5rem 0; }
.event .time { color: #6a6a8a; font-size: 0.8rem; }
.event .title { color: #00e5ff; }
.event .desc { color: #e0e0e8; font-size: 0.9rem; }
.event .freq { color: #ffab00; }
.stat { display: inline-block; padding: 0.5rem 1rem; background: #12121a; border: 1px solid #2a2a4a; margin: 0.25rem; }
</style></head><body>
<h1>⚡ ${title}</h1>
<p>Generated: ${new Date().toISOString()} · Events: ${events.length}</p>
<div>${events.map(e => `
<div class="event" style="border-color: ${e.color}">
  <span class="time">${new Date(e.timestamp).toLocaleString()}</span>
  <span>${e.icon}</span>
  <span class="title">${e.title}</span>
  ${e.frequency ? `<span class="freq"> · ${(e.frequency / 1e6).toFixed(3)} MHz</span>` : ''}
  <div class="desc">${e.description}</div>
</div>`).join('')}
</div></body></html>`;
  }

  exportJSON(filter?: TimelineFilter): string {
    return JSON.stringify(this.getEvents(filter, 5000), null, 2);
  }
}
