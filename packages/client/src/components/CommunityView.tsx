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
  const [tab, setTab] = useState<'flowgraphs' | 'plugins'>('flowgraphs');

  useEffect(() => {
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    if (search) params.set('search', search);
    fetch(`/api/community/flowgraphs?${params}`).then(r => r.json()).then(setFlowgraphs).catch(() => {});
    fetch('/api/community/plugins').then(r => r.json()).then(setPlugins).catch(() => {});
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
          {(['flowgraphs', 'plugins'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-mono ${tab === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-500 border border-forge-border'}`}>
              {t === 'flowgraphs' ? '📊 Flowgraphs' : '🔌 Plugins'}
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
          {tab === 'flowgraphs' ? (
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
          ) : (
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
        </div>
      </div>
    </div>
  );
};
