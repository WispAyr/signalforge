import React from 'react';

type View = 'flow' | 'waterfall' | 'map' | 'split';

interface HeaderProps {
  activeView: View;
  onViewChange: (view: View) => void;
}

const views: { id: View; label: string; icon: string }[] = [
  { id: 'flow', label: 'FLOW', icon: '◇' },
  { id: 'waterfall', label: 'SPECTRUM', icon: '≋' },
  { id: 'map', label: 'MAP', icon: '◎' },
  { id: 'split', label: 'SPLIT', icon: '⊞' },
];

export const Header: React.FC<HeaderProps> = ({ activeView, onViewChange }) => {
  return (
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
          DEMO SDR
        </span>
        <span>100.000 MHz</span>
        <span>2.4 MS/s</span>
      </div>
    </header>
  );
};
