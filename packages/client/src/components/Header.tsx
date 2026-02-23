import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../stores/location';
import { LocationPanel } from './LocationPanel';
import type { View } from '../App';
import type { Notification } from '@signalforge/shared';

interface HeaderProps {
  activeView: View;
  onViewChange: (view: View) => void;
}

const views: { id: View; label: string; icon: string; key: string }[] = [
  { id: 'dashboard', label: 'OPS', icon: '⬡', key: '1' },
  { id: 'flow', label: 'FLOW', icon: '◇', key: '2' },
  { id: 'waterfall', label: 'SPECTRUM', icon: '≋', key: '3' },
  { id: 'map', label: 'MAP', icon: '◎', key: '4' },
  { id: 'sdr', label: 'SDR', icon: '📡', key: '5' },
  { id: 'analyzer', label: 'ANALYZER', icon: '📊', key: '6' },
  { id: 'scheduler', label: 'SCHED', icon: '📅', key: '7' },
  { id: 'signals', label: 'SIGNALS', icon: '📻', key: '8' },
  { id: 'settings', label: '⚙', icon: '⚙', key: '9' },
];

export const Header: React.FC<HeaderProps> = ({ activeView, onViewChange }) => {
  const { observer, fetchSettings, loaded } = useLocationStore();
  const [showLocation, setShowLocation] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sdrCount, setSdrCount] = useState(0);
  const [dopplerTracking, setDopplerTracking] = useState(false);

  useEffect(() => {
    if (!loaded) fetchSettings();
  }, [loaded, fetchSettings]);

  // Listen for notifications and status via WS
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'notification') {
          setNotifications(prev => [msg.notification, ...prev].slice(0, 20));
          if ('Notification' in window && window.Notification.permission === 'granted') {
            new window.Notification(msg.notification.title, { body: msg.notification.message, icon: '⚡' });
          }
        }
        if (msg.type === 'sdr_connected') setSdrCount(c => c + 1);
        if (msg.type === 'sdr_disconnected') setSdrCount(c => Math.max(0, c - 1));
        if (msg.type === 'doppler') setDopplerTracking(true);
      } catch { /* ignore binary */ }
    };
    return () => ws.close();
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <>
      <header className="h-12 flex items-center px-4 border-b border-forge-border bg-forge-surface/80 backdrop-blur-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mr-4">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-forge-cyan to-forge-amber flex items-center justify-center">
            <span className="text-forge-bg font-bold text-sm">⚡</span>
          </div>
          <h1 className="font-display font-bold text-lg tracking-wider bg-gradient-to-r from-forge-cyan to-forge-amber bg-clip-text text-transparent">
            SIGNALFORGE
          </h1>
        </div>

        {/* View tabs */}
        <nav className="flex gap-0.5">
          {views.map((view) => (
            <button
              key={view.id}
              onClick={() => onViewChange(view.id)}
              title={`${view.label} (${view.key})`}
              className={`px-2.5 py-1.5 text-[10px] font-mono tracking-wider rounded transition-all ${
                activeView === view.id
                  ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30 glow-cyan'
                  : 'text-forge-text-dim hover:text-forge-text hover:bg-forge-panel/50 border border-transparent'
              }`}
            >
              <span className="mr-0.5">{view.icon}</span>
              {view.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3 text-xs text-forge-text-dim font-mono">
          {/* SDR indicator */}
          {sdrCount > 0 && (
            <span className="flex items-center gap-1.5 text-forge-green">
              <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse" />
              SDR×{sdrCount}
            </span>
          )}

          {/* Doppler indicator */}
          {dopplerTracking && (
            <span className="flex items-center gap-1 text-forge-amber text-[10px]">
              🔄 DOPPLER
            </span>
          )}

          {/* Recording indicator */}
          {recording && (
            <span className="flex items-center gap-1.5 text-forge-red animate-pulse">
              <span className="w-2 h-2 rounded-full bg-forge-red" />
              REC
            </span>
          )}

          {/* Notifications */}
          <button onClick={() => setShowNotifs(!showNotifs)}
            className="relative flex items-center gap-1 px-2 py-1 rounded hover:bg-forge-panel/50 transition-colors">
            <span>🔔</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red text-[8px] flex items-center justify-center text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Status */}
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse-slow" />
            OPERATIONAL
          </span>

          {/* Observer location */}
          <button
            onClick={() => setShowLocation(true)}
            className="flex items-center gap-1.5 hover:text-forge-cyan transition-colors px-2 py-1 rounded hover:bg-forge-panel/50"
            title="Observer Location"
          >
            <span>📍</span>
            <span>{observer.name || `${observer.latitude.toFixed(2)}°, ${observer.longitude.toFixed(2)}°`}</span>
          </button>
        </div>
      </header>

      {showLocation && <LocationPanel onClose={() => setShowLocation(false)} />}

      {/* Notification panel */}
      {showNotifs && (
        <div className="fixed top-12 right-4 z-50 w-80 panel-border rounded-lg bg-forge-surface p-3 max-h-96 overflow-y-auto"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-mono text-forge-cyan tracking-wider">🔔 NOTIFICATIONS</h3>
            <button onClick={() => setShowNotifs(false)} className="text-forge-text-dim hover:text-forge-text">✕</button>
          </div>
          {notifications.length === 0 && (
            <p className="text-[10px] font-mono text-forge-text-dim py-4 text-center">No notifications</p>
          )}
          {notifications.map(n => (
            <div key={n.id} className={`px-3 py-2 rounded mb-1 text-xs font-mono ${n.read ? 'bg-forge-bg/50' : 'bg-forge-cyan/5 border-l-2 border-forge-cyan'}`}>
              <div className="text-forge-text">{n.title}</div>
              <div className="text-forge-text-dim text-[10px]">{n.message}</div>
              <div className="text-[9px] text-forge-text-dim mt-1">{new Date(n.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
