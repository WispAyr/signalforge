import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../stores/location';
import { LocationPanel } from './LocationPanel';

type View = 'dashboard' | 'flow' | 'waterfall' | 'map' | 'split';

interface HeaderProps {
  activeView: View;
  onViewChange: (view: View) => void;
}

const views: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'OPS', icon: '⬡' },
  { id: 'flow', label: 'FLOW', icon: '◇' },
  { id: 'waterfall', label: 'SPECTRUM', icon: '≋' },
  { id: 'map', label: 'MAP', icon: '◎' },
  { id: 'split', label: 'SPLIT', icon: '⊞' },
];

export const Header: React.FC<HeaderProps> = ({ activeView, onViewChange }) => {
  const { observer, fetchSettings, loaded } = useLocationStore();
  const [showLocation, setShowLocation] = useState(false);

  useEffect(() => {
    if (!loaded) fetchSettings();
  }, [loaded, fetchSettings]);

  return (
    <>
      <header className="h-12 flex items-center px-4 border-b border-forge-border bg-forge-surface/80 backdrop-blur-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mr-8">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-forge-cyan to-forge-amber flex items-center justify-center">
            <span className="text-forge-bg font-bold text-sm">⚡</span>
          </div>
          <h1 className="font-display font-bold text-lg tracking-wider bg-gradient-to-r from-forge-cyan to-forge-amber bg-clip-text text-transparent">
            SIGNALFORGE
          </h1>
        </div>

        {/* View tabs */}
        <nav className="flex gap-1">
          {views.map((view) => (
            <button
              key={view.id}
              onClick={() => onViewChange(view.id)}
              className={`px-4 py-1.5 text-xs font-mono tracking-wider rounded transition-all ${
                activeView === view.id
                  ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30 glow-cyan'
                  : 'text-forge-text-dim hover:text-forge-text hover:bg-forge-panel/50 border border-transparent'
              }`}
            >
              <span className="mr-1.5">{view.icon}</span>
              {view.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-4 text-xs text-forge-text-dim font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse-slow" />
            OPERATIONAL
          </span>
          <button
            onClick={() => setShowLocation(true)}
            className="flex items-center gap-1.5 hover:text-forge-cyan transition-colors px-2 py-1 rounded hover:bg-forge-panel/50"
            title="Observer Location — click to configure"
          >
            <span>📍</span>
            <span>{observer.name || `${observer.latitude.toFixed(2)}°, ${observer.longitude.toFixed(2)}°`}</span>
            <span className="text-[8px] opacity-50">{observer.source}</span>
          </button>
        </div>
      </header>

      {showLocation && <LocationPanel onClose={() => setShowLocation(false)} />}
    </>
  );
};
