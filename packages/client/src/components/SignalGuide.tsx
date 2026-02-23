import React, { useState, useEffect } from 'react';
import type { SignalEntry, Bookmark, SignalCategory } from '@signalforge/shared';

const CATEGORIES: { id: SignalCategory | 'all'; label: string; icon: string; color: string }[] = [
  { id: 'all', label: 'All', icon: '📡', color: '#00e5ff' },
  { id: 'broadcast', label: 'Broadcast', icon: '📻', color: '#ff1744' },
  { id: 'aviation', label: 'Aviation', icon: '✈️', color: '#00e676' },
  { id: 'maritime', label: 'Maritime', icon: '🚢', color: '#ffab00' },
  { id: 'amateur', label: 'Amateur', icon: '📍', color: '#aa00ff' },
  { id: 'satellite', label: 'Satellite', icon: '🛰️', color: '#00b8d4' },
  { id: 'weather', label: 'Weather', icon: '🌦️', color: '#4fc3f7' },
  { id: 'iot', label: 'IoT', icon: '📡', color: '#69f0ae' },
  { id: 'emergency', label: 'Emergency', icon: '🚨', color: '#ff1744' },
  { id: 'pmr', label: 'PMR', icon: '📻', color: '#ffab00' },
  { id: 'utility', label: 'Utility', icon: '⚡', color: '#b0bec5' },
];

const formatFreq = (hz: number): string => {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
};

export const SignalGuide: React.FC = () => {
  const [signals, setSignals] = useState<SignalEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SignalCategory | 'all'>('all');
  const [selectedSignal, setSelectedSignal] = useState<SignalEntry | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [tuneFreq, setTuneFreq] = useState('');
  const [identifyResults, setIdentifyResults] = useState<SignalEntry[]>([]);

  useEffect(() => {
    fetchSignals();
    fetchBookmarks();
  }, [searchQuery, activeCategory]);

  const fetchSignals = async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (activeCategory !== 'all') params.set('category', activeCategory);
      const res = await fetch(`/api/signals?${params}`);
      setSignals(await res.json());
    } catch { /* ignore */ }
  };

  const fetchBookmarks = async () => {
    try {
      const res = await fetch('/api/bookmarks');
      setBookmarks(await res.json());
    } catch { /* ignore */ }
  };

  const addBookmark = async (signal: SignalEntry) => {
    try {
      await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: signal.name, frequency: signal.frequency, mode: signal.mode, category: signal.category }),
      });
      fetchBookmarks();
    } catch { /* ignore */ }
  };

  const removeBookmark = async (id: string) => {
    try {
      await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
      fetchBookmarks();
    } catch { /* ignore */ }
  };

  const identifyFrequency = async () => {
    const freq = parseFloat(tuneFreq) * 1e6;
    if (isNaN(freq)) return;
    try {
      const res = await fetch(`/api/signals/identify?freq=${freq}`);
      setIdentifyResults(await res.json());
    } catch { /* ignore */ }
  };

  const isBookmarked = (freq: number) => bookmarks.some(b => b.frequency === freq);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Category sidebar */}
      <div className="w-48 border-r border-forge-border bg-forge-surface/50 overflow-y-auto p-3 space-y-1">
        <h3 className="text-[10px] font-mono tracking-wider text-forge-text-dim mb-2">CATEGORIES</h3>
        {CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-all ${
              activeCategory === cat.id
                ? 'bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20'
                : 'text-forge-text-dim hover:text-forge-text hover:bg-forge-panel/50 border border-transparent'
            }`}>
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
        <div className="border-t border-forge-border mt-3 pt-3">
          <button onClick={() => setShowBookmarks(!showBookmarks)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-all ${
              showBookmarks ? 'bg-forge-amber/10 text-forge-amber border border-forge-amber/20' : 'text-forge-text-dim hover:text-forge-text border border-transparent'
            }`}>
            <span>⭐</span>
            <span>Bookmarks ({bookmarks.length})</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search & identify bar */}
        <div className="p-3 border-b border-forge-border flex gap-3">
          <input type="text" placeholder="Search signals..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text placeholder-forge-text-dim focus:border-forge-cyan/50 focus:outline-none" />

          <div className="flex gap-1 items-center">
            <input type="text" placeholder="Freq (MHz)" value={tuneFreq}
              onChange={e => setTuneFreq(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && identifyFrequency()}
              className="w-28 bg-forge-bg border border-forge-border rounded px-2 py-2 text-xs font-mono text-forge-text focus:border-forge-amber/50 focus:outline-none" />
            <button onClick={identifyFrequency}
              className="px-3 py-2 rounded border border-forge-amber/30 text-xs font-mono text-forge-amber hover:bg-forge-amber/10">
              🔍 ID
            </button>
          </div>
        </div>

        {/* Identify results */}
        {identifyResults.length > 0 && (
          <div className="p-3 bg-forge-amber/5 border-b border-forge-amber/20">
            <div className="text-[10px] font-mono text-forge-amber mb-1">SIGNALS NEAR {tuneFreq} MHz:</div>
            {identifyResults.map(s => (
              <div key={s.id} className="flex items-center gap-3 py-1">
                <span className="text-xs font-mono text-forge-amber">{formatFreq(s.frequency)}</span>
                <span className="text-xs font-mono text-forge-text">{s.name}</span>
                <span className="text-[10px] font-mono text-forge-text-dim">{s.mode}</span>
              </div>
            ))}
          </div>
        )}

        {/* Bookmarks panel */}
        {showBookmarks && (
          <div className="p-3 bg-forge-amber/5 border-b border-forge-amber/20">
            <div className="text-[10px] font-mono text-forge-amber tracking-wider mb-2">⭐ BOOKMARKS</div>
            {bookmarks.length === 0 && <p className="text-[10px] font-mono text-forge-text-dim">No bookmarks yet</p>}
            {bookmarks.map(bm => (
              <div key={bm.id} className="flex items-center gap-3 py-1 group">
                <span className="text-xs font-mono text-forge-amber">{formatFreq(bm.frequency)}</span>
                <span className="text-xs font-mono text-forge-text">{bm.name}</span>
                <span className="text-[10px] font-mono text-forge-text-dim">{bm.mode}</span>
                <button onClick={() => removeBookmark(bm.id)}
                  className="ml-auto text-[10px] text-forge-red/50 hover:text-forge-red opacity-0 group-hover:opacity-100 transition-all">✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Signal list */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface">
              <tr className="text-[10px] text-forge-text-dim tracking-wider border-b border-forge-border">
                <th className="text-left px-3 py-2">FREQUENCY</th>
                <th className="text-left px-3 py-2">NAME</th>
                <th className="text-left px-3 py-2">MODE</th>
                <th className="text-left px-3 py-2">CATEGORY</th>
                <th className="text-left px-3 py-2">DESCRIPTION</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {signals.map(s => (
                <tr key={s.id}
                  onClick={() => setSelectedSignal(selectedSignal?.id === s.id ? null : s)}
                  className={`border-b border-forge-border/30 cursor-pointer transition-all ${
                    selectedSignal?.id === s.id ? 'bg-forge-cyan/5' : 'hover:bg-forge-panel/30'
                  }`}>
                  <td className="px-3 py-2 text-forge-cyan whitespace-nowrap">{formatFreq(s.frequency)}</td>
                  <td className="px-3 py-2 text-forge-text">{s.name}</td>
                  <td className="px-3 py-2 text-forge-amber">{s.mode}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-forge-panel border border-forge-border"
                      style={{ color: CATEGORIES.find(c => c.id === s.category)?.color }}>
                      {s.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-forge-text-dim truncate max-w-xs">{s.description}</td>
                  <td className="px-3 py-2">
                    <button onClick={e => { e.stopPropagation(); isBookmarked(s.frequency) ? undefined : addBookmark(s); }}
                      className={`text-sm ${isBookmarked(s.frequency) ? 'text-forge-amber' : 'text-forge-text-dim hover:text-forge-amber'}`}>
                      {isBookmarked(s.frequency) ? '⭐' : '☆'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected signal detail */}
        {selectedSignal && (
          <div className="p-4 border-t border-forge-border bg-forge-surface/80">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-mono text-forge-cyan">{selectedSignal.name}</h4>
                <p className="text-xs font-mono text-forge-text-dim mt-1">{selectedSignal.description}</p>
              </div>
              <div className="text-right">
                <div className="text-lg font-display text-forge-amber">{formatFreq(selectedSignal.frequency)}</div>
                <div className="text-[10px] font-mono text-forge-text-dim">{selectedSignal.mode} · {selectedSignal.bandwidth ? formatFreq(selectedSignal.bandwidth) + ' BW' : ''}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
