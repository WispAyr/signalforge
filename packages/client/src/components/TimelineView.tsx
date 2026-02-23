import React, { useState, useEffect } from 'react';
import type { TimelineEvent, TimelineEventType } from '@signalforge/shared';

const EVENT_TYPE_CONFIG: Record<TimelineEventType, { icon: string; color: string; label: string }> = {
  observation: { icon: '📡', color: '#00e5ff', label: 'Observations' },
  recording: { icon: '⏺', color: '#ff1744', label: 'Recordings' },
  decode: { icon: '📟', color: '#aa00ff', label: 'Decoded' },
  alert: { icon: '⚠️', color: '#ffab00', label: 'Alerts' },
  scan_hit: { icon: '📻', color: '#ffab00', label: 'Scan Hits' },
  classification: { icon: '🧠', color: '#748ffc', label: 'Classifications' },
  satellite_pass: { icon: '🛰️', color: '#20c997', label: 'Sat Passes' },
  chat: { icon: '💬', color: '#6a6a8a', label: 'Chat' },
  system: { icon: '⚙', color: '#6a6a8a', label: 'System' },
};

export const TimelineView: React.FC = () => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filter, setFilter] = useState<TimelineEventType[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadEvents = async () => {
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (filter.length) params.set('types', filter.join(','));
    if (search) params.set('search', search);
    const data = await fetch(`/api/timeline?${params}`).then(r => r.json()).catch(() => []);
    setEvents(data);
    setLoading(false);
  };

  useEffect(() => { loadEvents(); }, [filter, search]);

  // Live updates
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        // Timeline events come through various channels; reload periodically
      } catch { /* ignore */ }
    };
    const interval = setInterval(loadEvents, 10000);
    return () => { ws.close(); clearInterval(interval); };
  }, [filter, search]);

  const toggleFilter = (type: TimelineEventType) => {
    setFilter(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const exportTimeline = async (format: 'html' | 'json') => {
    const resp = await fetch(`/api/timeline/export/${format}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signalforge-timeline.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-forge-border">
        <h2 className="text-sm font-display font-bold text-forge-cyan tracking-wider">📜 TIMELINE</h2>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search events..."
          className="ml-4 w-48 px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text focus:border-forge-cyan focus:outline-none"
        />
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => exportTimeline('html')} className="px-2 py-1 text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan border border-forge-border rounded">
            📄 HTML
          </button>
          <button onClick={() => exportTimeline('json')} className="px-2 py-1 text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan border border-forge-border rounded">
            📋 JSON
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-forge-border/50 flex-wrap">
        {(Object.entries(EVENT_TYPE_CONFIG) as [TimelineEventType, typeof EVENT_TYPE_CONFIG[TimelineEventType]][]).map(([type, cfg]) => (
          <button
            key={type}
            onClick={() => toggleFilter(type)}
            className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-colors ${
              filter.length === 0 || filter.includes(type)
                ? 'border-current/30 bg-current/10'
                : 'border-forge-border text-forge-text-dim opacity-40'
            }`}
            style={{ color: cfg.color }}
          >
            {cfg.icon} {cfg.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-sm font-mono text-forge-text-dim">Loading timeline...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-sm font-mono text-forge-text-dim">No events found</div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-forge-border" />

            {events.map((event, i) => {
              const config = EVENT_TYPE_CONFIG[event.type] || { icon: '•', color: '#6a6a8a' };
              const showDate = i === 0 || new Date(event.timestamp).toDateString() !== new Date(events[i - 1]?.timestamp).toDateString();

              return (
                <React.Fragment key={event.id}>
                  {showDate && (
                    <div className="ml-10 mt-4 mb-2 text-[10px] font-mono text-forge-text-dim tracking-wider">
                      {new Date(event.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  )}
                  <div className="flex items-start gap-3 mb-1.5 relative">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm z-10 shrink-0" style={{ backgroundColor: `${config.color}22`, border: `1px solid ${config.color}44` }}>
                      {event.icon || config.icon}
                    </div>
                    <div className="flex-1 py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: config.color }}>{event.title}</span>
                        {event.frequency && (
                          <span className="text-[9px] font-mono text-forge-amber">{(event.frequency / 1e6).toFixed(3)} MHz</span>
                        )}
                        {event.nickname && (
                          <span className="text-[9px] font-mono text-forge-text-dim">by {event.nickname}</span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-forge-text-dim">{event.description}</div>
                      <div className="text-[9px] font-mono text-forge-text-dim mt-0.5">
                        {new Date(event.timestamp).toLocaleTimeString()}
                        {event.source && <span> · {event.source}</span>}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
