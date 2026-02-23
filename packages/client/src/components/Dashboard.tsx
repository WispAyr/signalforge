import React, { useState, useEffect } from 'react';
import type { DashboardStats, ActivityFeedItem, FlowPreset } from '@signalforge/shared';
import { useLocationStore } from '../stores/location';

type View = 'dashboard' | 'flow' | 'waterfall' | 'map' | 'split';

interface DashboardProps {
  onNavigate: (view: View) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const { observer } = useLocationStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityFeedItem[]>([]);
  const [presets, setPresets] = useState<FlowPreset[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, actRes, presetsRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/activity?limit=20'),
          fetch('/api/presets'),
        ]);
        setStats(await statsRes.json());
        setActivity(await actRes.json());
        setPresets(await presetsRes.json());
      } catch { /* ignore */ }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const statCards = stats ? [
    { label: 'SATELLITES', value: stats.satellitesTracked.toLocaleString(), icon: '🛰️', color: '#00e5ff', sub: 'tracked' },
    { label: 'AIRCRAFT', value: stats.aircraftSeen.toString(), icon: '✈️', color: '#00e676', sub: 'visible' },
    { label: 'VESSELS', value: stats.vesselsSeen.toString(), icon: '🚢', color: '#ffab00', sub: 'on scope' },
    { label: 'APRS', value: stats.aprsStations.toString(), icon: '📍', color: '#ff1744', sub: 'stations' },
    { label: 'DECODERS', value: stats.activeDecoders.toString(), icon: '🔓', color: '#aa00ff', sub: 'active' },
    { label: 'ACARS', value: stats.acarsMessages.toString(), icon: '📡', color: '#00b8d4', sub: 'messages' },
  ] : [];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl tracking-wider text-forge-cyan">OPERATIONS CENTER</h2>
          <p className="text-xs font-mono text-forge-text-dim mt-1">
            {observer.name || 'Unknown'} — {observer.latitude.toFixed(4)}°{observer.latitude >= 0 ? 'N' : 'S'}, {Math.abs(observer.longitude).toFixed(4)}°{observer.longitude >= 0 ? 'E' : 'W'} — {new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse-slow" />
            <span className="text-forge-green">ALL SYSTEMS OPERATIONAL</span>
          </div>
          {stats && (
            <p className="text-[10px] font-mono text-forge-text-dim mt-1">
              Uptime: {Math.floor(stats.uptime / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m
            </p>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-6 gap-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="panel-border rounded-lg p-4 hover:border-opacity-40 transition-all group cursor-pointer"
            style={{ borderColor: card.color + '30' }}
            onClick={() => card.label === 'SATELLITES' || card.label === 'AIRCRAFT' || card.label === 'VESSELS' || card.label === 'APRS' ? onNavigate('map') : undefined}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-wider text-forge-text-dim">{card.label}</span>
              <span className="text-lg">{card.icon}</span>
            </div>
            <div className="text-2xl font-display font-bold" style={{ color: card.color }}>
              {card.value}
            </div>
            <div className="text-[10px] font-mono text-forge-text-dim mt-1">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Quick Launch */}
        <div className="panel-border rounded-lg p-4">
          <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">⚡ QUICK LAUNCH</h3>
          <div className="space-y-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onNavigate('flow')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded border border-forge-border hover:border-forge-cyan/30 hover:bg-forge-cyan/5 transition-all text-left group"
              >
                <span className="text-xl">{preset.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-forge-text group-hover:text-forge-cyan transition-colors">{preset.name}</div>
                  <div className="text-[10px] text-forge-text-dim truncate">{preset.description}</div>
                </div>
                <span className="text-forge-text-dim text-xs opacity-0 group-hover:opacity-100 transition-opacity">▶</span>
              </button>
            ))}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="panel-border rounded-lg p-4 col-span-2">
          <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">📋 ACTIVITY FEED</h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {activity.length === 0 && (
              <p className="text-xs text-forge-text-dim font-mono py-4 text-center">Waiting for activity...</p>
            )}
            {activity.map((item) => (
              <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-forge-panel/50 transition-colors">
                <span className="text-sm flex-shrink-0">{item.icon}</span>
                <span className="text-xs font-mono text-forge-text flex-shrink-0">{item.title}</span>
                <span className="text-[10px] font-mono text-forge-text-dim truncate flex-1">{item.detail}</span>
                <span className="text-[9px] font-mono text-forge-text-dim flex-shrink-0">
                  {new Date(item.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* View shortcuts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { view: 'map' as View, label: 'GLOBAL MAP', desc: 'Satellites, aircraft, vessels, APRS stations', icon: '🌍', color: '#00e5ff' },
          { view: 'waterfall' as View, label: 'SPECTRUM ANALYZER', desc: 'Waterfall & spectrum display', icon: '≋', color: '#ffab00' },
          { view: 'flow' as View, label: 'FLOW EDITOR', desc: 'Signal processing flowgraphs', icon: '◇', color: '#00e676' },
        ].map((item) => (
          <button
            key={item.view}
            onClick={() => onNavigate(item.view)}
            className="panel-border rounded-lg p-5 text-left hover:border-forge-cyan/30 transition-all group"
          >
            <div className="text-3xl mb-2">{item.icon}</div>
            <h3 className="font-display text-sm tracking-wider group-hover:text-forge-cyan transition-colors" style={{ color: item.color }}>
              {item.label}
            </h3>
            <p className="text-[10px] font-mono text-forge-text-dim mt-1">{item.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
