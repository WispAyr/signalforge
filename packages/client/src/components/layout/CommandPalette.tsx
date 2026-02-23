import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ALL_VIEWS } from './navigation';
import { useUIStore } from '../../stores/ui';
import type { View } from '../../App';

interface CommandPaletteProps {
  onViewChange: (view: View) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ onViewChange }) => {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return ALL_VIEWS.slice(0, 12);
    const q = query.toLowerCase();
    return ALL_VIEWS.filter(
      (v) => v.label.toLowerCase().includes(q) || v.section.toLowerCase().includes(q) || v.id.includes(q)
    ).slice(0, 12);
  }, [query]);

  const execute = useCallback((idx: number) => {
    const item = results[idx];
    if (item) {
      onViewChange(item.id);
      setCommandPaletteOpen(false);
      setQuery('');
    }
  }, [results, onViewChange, setCommandPaletteOpen]);

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        setQuery('');
        setSelectedIdx(0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(selectedIdx); }
    else if (e.key === 'Escape') { setCommandPaletteOpen(false); }
  };

  if (!commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" role="dialog" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCommandPaletteOpen(false)} />
      <div className="relative w-full max-w-lg bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden animate-[slideDown_150ms_ease-out]">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-forge-border">
          <span className="text-forge-text-dim text-sm">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search views, actions, frequencies..."
            className="flex-1 bg-transparent text-sm font-mono text-forge-text placeholder:text-forge-text-dim/40 focus:outline-none"
            aria-label="Command search"
          />
          <kbd className="text-[9px] text-forge-text-dim bg-forge-panel px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-xs font-mono text-forge-text-dim">No results found</div>
          )}
          {results.map((item, i) => (
            <button
              key={item.id}
              onClick={() => execute(i)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === selectedIdx ? 'bg-forge-cyan/10 text-forge-cyan' : 'text-forge-text hover:bg-forge-panel/30'
              }`}
            >
              <span className="text-base w-6 text-center">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono">{item.label}</div>
                <div className="text-[9px] text-forge-text-dim">{item.section}</div>
              </div>
              {item.shortcut && (
                <kbd className="text-[9px] text-forge-text-dim bg-forge-panel px-1.5 py-0.5 rounded">{item.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-forge-border/50 text-[9px] font-mono text-forge-text-dim">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
};
