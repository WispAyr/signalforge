import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PagerMessage, PagerStats } from '@signalforge/shared';

interface EnrichedMessage extends PagerMessage {
  content_clean?: string;
  content_raw?: string;
  duplicate_group_id?: string | null;
  capcode_label?: string;
  capcode_category?: string;
}

interface KeywordAlert {
  id: number;
  keyword: string;
  category: string;
  priority: string;
  enabled: number;
}

interface HourlyStat {
  hour_bucket: string;
  frequency: number;
  protocol: string;
  message_count: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Emergency Services': 'text-red-400 bg-red-500/20',
  'NHS/Health': 'text-green-400 bg-green-500/20',
  'Utilities/Commercial': 'text-blue-400 bg-blue-500/20',
  'Test/Admin': 'text-gray-400 bg-gray-500/20',
  'General': 'text-purple-400 bg-purple-500/20',
};

const ALERT_KEYWORDS_DEFAULT = ['FIRE', 'CARDIAC', 'RTC', 'AMBULANCE', 'COLLAPSE', 'FLOOD', 'EXPLOSION', 'HAZMAT'];

export const PagerView: React.FC = () => {
  const [messages, setMessages] = useState<EnrichedMessage[]>([]);
  const [stats, setStats] = useState<PagerStats | null>(null);
  const [dbStats, setDbStats] = useState<any>(null);
  const [filter, setFilter] = useState<string>('all');
  const [freqFilter, setFreqFilter] = useState<string>('all');
  const [capcodeFilter, setCapcodeFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sinceFilter, setSinceFilter] = useState<string>('');
  const [alertKeywords, setAlertKeywords] = useState<string[]>(ALERT_KEYWORDS_DEFAULT);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef<number>(0);

  const fetchData = async () => {
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (freqFilter !== 'all') params.set('freq', String(parseFloat(freqFilter) * 1e6));
      if (capcodeFilter) params.set('capcode', capcodeFilter);
      if (search) params.set('search', search);
      if (sinceFilter) params.set('since', String(new Date(sinceFilter).getTime()));

      const [mRes, sRes, dsRes, aRes] = await Promise.all([
        fetch(`/api/pager/messages?${params}`),
        fetch('/api/pager/stats'),
        fetch('/api/pager/stats/db'),
        fetch('/api/pager/keyword-alerts'),
      ]);
      setMessages(await mRes.json());
      setStats(await sRes.json());
      setDbStats(await dsRes.json());
      const alerts: KeywordAlert[] = await aRes.json();
      setAlertKeywords(alerts.filter(a => a.enabled).map(a => a.keyword));
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, [freqFilter, capcodeFilter, search, sinceFilter]);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'pager_message') {
          setMessages(prev => [msg.message, ...prev].slice(0, 500));
        }
        if (msg.type === 'pager_alert') {
          // Flash the message
          const alertMsg = msg.alert?.message;
          if (alertMsg?.id) {
            setFlashIds(prev => new Set([...prev, alertMsg.id]));
            setTimeout(() => setFlashIds(prev => { const n = new Set(prev); n.delete(alertMsg.id); return n; }), 3000);
          }
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  // Persist scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => { scrollPosRef.current = el.scrollTop; };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    if (scrollRef.current && scrollPosRef.current > 0) {
      scrollRef.current.scrollTop = scrollPosRef.current;
    }
  }, [messages]);

  const activeFreqs = [...new Set(messages.map(m => m.frequency).filter(Boolean))].sort() as number[];
  const fmtFreq = (hz: number) => (hz / 1e6).toFixed(3);

  const filtered = messages
    .filter(m => filter === 'all' || m.protocol === filter)
    .filter(m => freqFilter === 'all' || (m.frequency && fmtFreq(m.frequency) === freqFilter))
    .filter(m => !capcodeFilter || String(m.capcode).includes(capcodeFilter))
    .filter(m => !search || (m.content_clean || m.content).toLowerCase().includes(search.toLowerCase()) || String(m.capcode).includes(search));

  // Group by duplicate_group_id
  const grouped: { leader: EnrichedMessage; duplicates: EnrichedMessage[] }[] = [];
  const seenGroups = new Set<string>();
  for (const msg of filtered) {
    const gid = msg.duplicate_group_id;
    if (gid && seenGroups.has(gid)) {
      const group = grouped.find(g => (g.leader.duplicate_group_id || g.leader.id) === gid || g.leader.id === gid);
      if (group) group.duplicates.push(msg);
      continue;
    }
    if (gid) seenGroups.add(gid);
    grouped.push({ leader: msg, duplicates: [] });
  }

  const hasAlertKeyword = (text: string) => {
    const upper = text.toUpperCase();
    return alertKeywords.filter(k => upper.includes(k));
  };

  const highlightKeywords = (text: string) => {
    const matches = hasAlertKeyword(text);
    if (matches.length === 0) return <span>{text}</span>;
    // Simple highlight: wrap matched keywords
    let result = text;
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    for (const kw of matches) {
      const idx = remaining.toUpperCase().indexOf(kw);
      if (idx >= 0) {
        if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
        parts.push(<span key={key++} className="bg-red-500/30 text-red-300 font-bold px-0.5 rounded">{remaining.slice(idx, idx + kw.length)}</span>);
        remaining = remaining.slice(idx + kw.length);
      }
    }
    if (remaining) parts.push(<span key={key++}>{remaining}</span>);
    return <>{parts}</>;
  };

  const catColor = (cat?: string) => CATEGORY_COLORS[cat || ''] || 'text-forge-text-dim bg-forge-panel';

  const toggleGroup = (gid: string) => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      n.has(gid) ? n.delete(gid) : n.add(gid);
      return n;
    });
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📟 PAGER DECODER</h2>
        <div className="flex gap-1 ml-4">
          {['all', 'POCSAG', 'FLEX'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-mono rounded ${filter === f ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {f}
            </button>
          ))}
        </div>
        {activeFreqs.length > 1 && (
          <div className="flex gap-1 ml-2">
            {['all', ...activeFreqs.map(f => fmtFreq(f))].map(f => (
              <button key={f} onClick={() => setFreqFilter(f)}
                className={`px-2 py-1 text-[10px] font-mono rounded ${freqFilter === f ? 'bg-forge-amber/15 text-forge-amber border border-forge-amber/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
                {f === 'all' ? 'All Freq' : f}
              </button>
            ))}
          </div>
        )}
        <input value={capcodeFilter} onChange={e => setCapcodeFilter(e.target.value)} placeholder="Capcode..."
          className="px-2 py-1 text-xs font-mono bg-forge-bg border border-forge-border rounded w-28" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search text..."
          className="px-3 py-1 text-xs font-mono bg-forge-bg border border-forge-border rounded w-48" />
        <input type="datetime-local" value={sinceFilter} onChange={e => setSinceFilter(e.target.value)}
          className="px-2 py-1 text-xs font-mono bg-forge-bg border border-forge-border rounded" />
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-3 text-xs font-mono text-forge-text-dim flex-wrap">
        {stats && (
          <>
            <span>Total: <span className="text-forge-cyan">{stats.totalMessages}</span></span>
            <span className="text-red-400">POCSAG: {stats.pocsagMessages}</span>
            <span className="text-purple-400">FLEX: {stats.flexMessages}</span>
            <span>Capcodes: <span className="text-forge-amber">{stats.uniqueCapcodes}</span></span>
            <span>📊 {stats.messagesPerHour}/hr</span>
          </>
        )}
        {dbStats && (
          <>
            <span>DB Total: <span className="text-forge-cyan">{dbStats.total}</span></span>
            {dbStats.busiest_hour && <span>🔥 Busiest: {dbStats.busiest_hour}</span>}
            {dbStats.by_frequency?.[0] && <span>📡 Top: {fmtFreq(dbStats.by_frequency[0].frequency)} ({dbStats.by_frequency[0].count})</span>}
          </>
        )}
      </div>

      {/* Messages table */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
            <tr>
              <th className="text-left p-2">Time</th>
              <th className="text-left p-2">Freq</th>
              <th className="text-left p-2">Proto</th>
              <th className="text-left p-2">Capcode</th>
              <th className="text-left p-2">Baud</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Content</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ leader, duplicates }) => {
              const gid = leader.duplicate_group_id || leader.id;
              const dupCount = duplicates.length;
              const isExpanded = expandedGroups.has(gid);
              const isFlashing = flashIds.has(leader.id);
              const alertMatches = hasAlertKeyword(leader.content_clean || leader.content || '');
              const content = leader.content_clean || leader.content || '';
              const cat = leader.capcode_category;
              const label = leader.capcode_label;

              return (
                <React.Fragment key={leader.id}>
                  <tr className={`border-t border-forge-border/30 hover:bg-forge-panel/50 ${isFlashing ? 'animate-pulse bg-red-500/20' : ''} ${alertMatches.length > 0 ? 'border-l-2 border-l-red-500' : ''}`}>
                    <td className="p-2 text-forge-text-dim whitespace-nowrap">{new Date(leader.timestamp).toLocaleTimeString()}</td>
                    <td className="p-2 text-forge-amber whitespace-nowrap">{leader.frequency ? fmtFreq(leader.frequency) : '—'}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${leader.protocol === 'POCSAG' ? 'bg-red-500/20 text-red-400' : 'bg-purple-500/20 text-purple-400'}`}>
                        {leader.protocol}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className="text-forge-amber">{leader.capcode}</span>
                      {label && <span className="ml-1 text-forge-text-dim text-[9px]">({label})</span>}
                      {cat && <span className={`ml-1 px-1 py-0.5 rounded text-[9px] ${catColor(cat)}`}>{cat}</span>}
                    </td>
                    <td className="p-2 text-forge-text-dim">{leader.baudRate}</td>
                    <td className="p-2 text-forge-text-dim">{leader.messageType}</td>
                    <td className="p-2 text-forge-text max-w-lg truncate">
                      {dupCount > 0 && (
                        <button onClick={() => toggleGroup(gid)} className="mr-2 px-1.5 py-0.5 rounded text-[9px] bg-forge-cyan/20 text-forge-cyan hover:bg-forge-cyan/30">
                          {isExpanded ? '▼' : '▶'} ×{dupCount + 1}
                        </button>
                      )}
                      {highlightKeywords(content)}
                    </td>
                  </tr>
                  {isExpanded && duplicates.map(dup => (
                    <tr key={dup.id} className="border-t border-forge-border/10 bg-forge-panel/30 opacity-60">
                      <td className="p-2 pl-6 text-forge-text-dim whitespace-nowrap">{new Date(dup.timestamp).toLocaleTimeString()}</td>
                      <td className="p-2 text-forge-amber whitespace-nowrap">{dup.frequency ? fmtFreq(dup.frequency) : '—'}</td>
                      <td className="p-2"><span className="text-[10px] text-forge-text-dim">↳ dup</span></td>
                      <td className="p-2 text-forge-amber">{dup.capcode}</td>
                      <td className="p-2 text-forge-text-dim">{dup.baudRate}</td>
                      <td className="p-2 text-forge-text-dim">{dup.messageType}</td>
                      <td className="p-2 text-forge-text-dim max-w-lg truncate">{dup.content_clean || dup.content}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
