import React, { useState, useEffect } from 'react';
import type { CommunityFlowgraph, CommunityPlugin, FlowgraphCategory } from '@signalforge/shared';

const CATEGORIES: Array<{ id: FlowgraphCategory | 'all'; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: '📋' },
  { id: 'satellite', label: 'Satellite', icon: '🛰️' },
  { id: 'aviation', label: 'Aviation', icon: '✈️' },
  { id: 'amateur', label: 'Amateur', icon: '📻' },
  { id: 'iot', label: 'IoT', icon: '📶' },
  { id: 'sigint', label: 'SIGINT', icon: '🕵️' },
  { id: 'marine', label: 'Marine', icon: '🚢' },
  { id: 'weather', label: 'Weather', icon: '🌦️' },
];

export const CommunityView: React.FC = () => {
  const [flowgraphs, setFlowgraphs] = useState<CommunityFlowgraph[]>([]);
  const [plugins, setPlugins] = useState<CommunityPlugin[]>([]);
  const [category, setCategory] = useState<FlowgraphCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'flowgraphs' | 'plugins' | 'observations'>('flowgraphs');
  const [observations, setObservations] = useState<any[]>([]);
  const [newObs, setNewObs] = useState({ text: '', frequency: '', mode: '', author: '' });

  useEffect(() => {
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    if (search) params.set('search', search);
    fetch(`/api/community/flowgraphs?${params}`).then(r => r.json()).then(setFlowgraphs).catch(() => {});
    fetch('/api/community/plugins').then(r => r.json()).then(setPlugins).catch(() => {});
    fetch('/api/community/observations').then(r => r.json()).then(setObservations).catch(() => {});
  }, [category, search]);

  const renderStars = (rating: number) => {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  };

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">🌐 Community Hub</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          {(['flowgraphs', 'plugins', 'observations'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-mono ${tab === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-500 border border-forge-border'}`}>
              {t === 'flowgraphs' ? '📊 Flowgraphs' : t === 'plugins' ? '🔌 Plugins' : '📡 Observations'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 p-3 flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-1">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono mb-2" />
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono flex items-center gap-2 ${category === cat.id ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:bg-forge-surface'}`}>
              <span>{cat.icon}</span> {cat.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'flowgraphs' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {flowgraphs.map(fg => (
                <div key={fg.id} className="bg-forge-surface border border-forge-border rounded p-3 hover:border-cyan-500/30 transition-colors">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <h3 className="text-sm font-mono text-white font-bold">{fg.name}</h3>
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{fg.description}</p>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30">
                      {fg.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs font-mono">
                    <span className="text-amber-400">{renderStars(fg.rating)}</span>
                    <span className="text-gray-500">({fg.ratingCount})</span>
                    <span className="text-gray-500">⬇ {fg.downloads}</span>
                    <div className="flex-1" />
                    <span className="text-gray-500">{fg.author}{fg.authorCallsign ? ` (${fg.authorCallsign})` : ''}</span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    {fg.tags.map(tag => (
                      <span key={tag} className="px-1 py-0.5 rounded text-[9px] font-mono bg-forge-bg text-gray-500 border border-forge-border">{tag}</span>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="px-2 py-1 rounded text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
                      📥 Import
                    </button>
                    <button className="px-2 py-1 rounded text-xs font-mono bg-forge-bg text-gray-400 border border-forge-border hover:text-white">
                      👁 Preview
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'plugins' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {plugins.map(pl => (
                <div key={pl.id} className="bg-forge-surface border border-forge-border rounded p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <h3 className="text-sm font-mono text-white font-bold">{pl.name}</h3>
                      <p className="text-xs text-gray-400 mt-1">{pl.description}</p>
                    </div>
                    <span className="text-xs text-gray-500 font-mono">v{pl.version}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs font-mono">
                    <span className="text-amber-400">{renderStars(pl.rating)}</span>
                    <span className="text-gray-500">⬇ {pl.downloads}</span>
                    <span className="text-gray-500">by {pl.author}</span>
                    <div className="flex-1" />
                    <button className={`px-2 py-0.5 rounded text-xs font-mono ${pl.installed ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'}`}>
                      {pl.installed ? '✓ Installed' : '📥 Install'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'observations' && (
            <div className="space-y-3">
              {/* New observation form */}
              <div className="bg-forge-surface border border-forge-border rounded p-3 space-y-2">
                <h3 className="text-xs font-mono text-cyan-400 font-bold">📡 Post an Observation</h3>
                <textarea value={newObs.text} onChange={e => setNewObs({ ...newObs, text: e.target.value })}
                  placeholder="What did you hear/see? Describe the signal..."
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono resize-none h-16" />
                <div className="flex gap-2">
                  <input type="text" value={newObs.frequency} onChange={e => setNewObs({ ...newObs, frequency: e.target.value })}
                    placeholder="Freq (MHz)" className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-white font-mono" />
                  <input type="text" value={newObs.mode} onChange={e => setNewObs({ ...newObs, mode: e.target.value })}
                    placeholder="Mode" className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-white font-mono" />
                  <input type="text" value={newObs.author} onChange={e => setNewObs({ ...newObs, author: e.target.value })}
                    placeholder="Your callsign" className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-white font-mono" />
                  <button onClick={() => {
                    if (!newObs.text) return;
                    fetch('/api/community/observations', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text: newObs.text, frequency: parseFloat(newObs.frequency) || undefined, mode: newObs.mode || undefined, author: newObs.author || 'Anonymous' }),
                    }).then(r => r.json()).then(obs => {
                      setObservations([obs, ...observations]);
                      setNewObs({ text: '', frequency: '', mode: '', author: newObs.author });
                    }).catch(() => {});
                  }} className="px-3 py-1 rounded text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
                    Post
                  </button>
                </div>
              </div>
              {/* Observations feed */}
              {observations.map((obs: any) => (
                <div key={obs.id} className="bg-forge-surface border border-forge-border rounded p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="text-sm text-white font-mono">{obs.text}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs font-mono text-gray-500">
                        {obs.frequency && <span>📻 {obs.frequency} MHz</span>}
                        {obs.mode && <span>📊 {obs.mode}</span>}
                        <span>by {obs.author}</span>
                        <span>{new Date(obs.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => {
                      fetch(`/api/community/observations/${obs.id}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    }} className="px-2 py-0.5 rounded text-xs font-mono text-gray-400 border border-forge-border hover:text-red-400">
                      ❤️ {obs.likes || 0}
                    </button>
                    <button onClick={() => {
                      fetch(`/api/community/observations/${obs.id}/bookmark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    }} className="px-2 py-0.5 rounded text-xs font-mono text-gray-400 border border-forge-border hover:text-yellow-400">
                      🔖 {obs.bookmarks || 0}
                    </button>
                  </div>
                </div>
              ))}
              {observations.length === 0 && (
                <div className="text-center text-gray-500 text-sm font-mono py-8">No observations yet. Be the first to post!</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
