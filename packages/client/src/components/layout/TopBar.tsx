import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../../stores/location';
import { useUIStore } from '../../stores/ui';
import { useTheme } from '../ThemeProvider';
import { LocationPanel } from '../LocationPanel';
import { VIEW_MAP } from './navigation';
import { Tooltip } from '../ui/Tooltip';
import type { View } from '../../App';
import type { Notification } from '@signalforge/shared';

interface TopBarProps {
  activeView: View;
  onToggleChat?: () => void;
  showChat?: boolean;
}

const THEME_CYCLE = ['default', 'tactical', 'lcars', 'classic'];

export const TopBar: React.FC<TopBarProps> = ({ activeView, onToggleChat, showChat }) => {
  const { observer, fetchSettings, loaded } = useLocationStore();
  const { setCommandPaletteOpen, activeSection } = useUIStore();
  const { themeId, setTheme } = useTheme();
  const [showLocation, setShowLocation] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [sdrCount, setSdrCount] = useState(0);
  const [dopplerTracking, setDopplerTracking] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => { if (!loaded) fetchSettings(); }, [loaded, fetchSettings]);

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'notification') {
          setNotifications((prev) => [msg.notification, ...prev].slice(0, 20));
          if ('Notification' in window && window.Notification.permission === 'granted') {
            new window.Notification(msg.notification.title, { body: msg.notification.message });
          }
        }
        if (msg.type === 'sdr_connected') setSdrCount((c) => c + 1);
        if (msg.type === 'sdr_disconnected') setSdrCount((c) => Math.max(0, c - 1));
        if (msg.type === 'doppler') setDopplerTracking(true);
      } catch { /* binary frame */ }
    };
    return () => ws.close();
  }, []);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeId);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const entry = VIEW_MAP[activeView];

  return (
    <>
      <header className="h-12 flex items-center px-4 border-b border-forge-border bg-forge-surface/80 backdrop-blur-sm z-50 relative" role="banner">
        {/* Logo */}
        <div className="flex items-center gap-3 mr-4">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-forge-cyan to-forge-amber flex items-center justify-center">
            <span className="text-forge-bg font-bold text-sm">⚡</span>
          </div>
          <h1 className="font-display font-bold text-lg tracking-wider bg-gradient-to-r from-forge-cyan to-forge-amber bg-clip-text text-transparent hidden sm:block">
            SIGNALFORGE
          </h1>
        </div>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[10px] font-mono text-forge-text-dim" aria-label="Breadcrumb">
          {entry && (
            <>
              <span>{entry.section.icon}</span>
              <span className="tracking-wider uppercase">{entry.section.label}</span>
              <span className="text-forge-border">›</span>
              <span className="text-forge-cyan tracking-wider uppercase">{entry.item.label}</span>
            </>
          )}
        </nav>

        {/* Search trigger */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="ml-4 flex items-center gap-2 px-3 py-1.5 rounded-md border border-forge-border/50 hover:border-forge-cyan/30 transition-colors text-forge-text-dim hover:text-forge-text"
          aria-label="Search (Ctrl+K)"
        >
          <span className="text-xs">🔍</span>
          <span className="text-[10px] font-mono hidden md:inline">Search...</span>
          <kbd className="text-[9px] bg-forge-panel px-1 py-0.5 rounded hidden md:inline">⌘K</kbd>
        </button>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2 text-xs text-forge-text-dim font-mono">
          {sdrCount > 0 && (
            <span className="flex items-center gap-1.5 text-forge-green">
              <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse" />
              SDR×{sdrCount}
            </span>
          )}
          {dopplerTracking && <span className="text-forge-amber text-[10px]">🔄 DOPPLER</span>}
          {recording && (
            <span className="flex items-center gap-1.5 text-forge-red animate-pulse">
              <span className="w-2 h-2 rounded-full bg-forge-red" />REC
            </span>
          )}

          {/* Theme toggle */}
          <Tooltip content={`Theme: ${themeId}`}>
            <button onClick={cycleTheme} className="px-2 py-1 rounded hover:bg-forge-panel/50 transition-colors" aria-label="Cycle theme">
              🎨
            </button>
          </Tooltip>

          {/* Chat */}
          {onToggleChat && (
            <button onClick={onToggleChat}
              className={`px-2 py-1 rounded transition-colors ${showChat ? 'text-forge-cyan bg-forge-cyan/10' : 'hover:bg-forge-panel/50'}`}
              aria-label="Toggle chat">💬</button>
          )}

          {/* Notifications */}
          <button onClick={() => setShowNotifs(!showNotifs)}
            className="relative px-2 py-1 rounded hover:bg-forge-panel/50 transition-colors" aria-label="Notifications">
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red text-[8px] flex items-center justify-center text-white">{unreadCount}</span>
            )}
          </button>

          {/* Status */}
          <span className="hidden lg:flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse-slow" />
            <span className="text-[10px]">OK</span>
          </span>

          {/* Location */}
          <button onClick={() => setShowLocation(true)}
            className="flex items-center gap-1 hover:text-forge-cyan transition-colors px-2 py-1 rounded hover:bg-forge-panel/50"
            aria-label="Observer location">
            📍 <span className="hidden md:inline text-[10px]">{observer.name || `${observer.latitude.toFixed(2)}°`}</span>
          </button>
        </div>
      </header>

      {showLocation && <LocationPanel onClose={() => setShowLocation(false)} />}

      {/* Notification panel */}
      {showNotifs && (
        <div className="fixed top-12 right-4 z-50 w-80 panel-border rounded-lg bg-forge-surface p-3 max-h-96 overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-mono text-forge-cyan tracking-wider">🔔 NOTIFICATIONS</h3>
            <button onClick={() => setShowNotifs(false)} className="text-forge-text-dim hover:text-forge-text">✕</button>
          </div>
          {notifications.length === 0 && <p className="text-[10px] font-mono text-forge-text-dim py-4 text-center">No notifications</p>}
          {notifications.map((n) => (
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
