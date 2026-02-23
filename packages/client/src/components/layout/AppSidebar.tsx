import React, { useState } from 'react';
import { NAV_SECTIONS, VIEW_MAP } from './navigation';
import { useUIStore } from '../../stores/ui';
import { Tooltip } from '../ui/Tooltip';
import type { View } from '../../App';

interface AppSidebarProps {
  activeView: View;
  onViewChange: (view: View) => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ activeView, onViewChange }) => {
  const { sidebarPinned, setSidebarPinned, sidebarHovered, setSidebarHovered } = useUIStore();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set([VIEW_MAP[activeView]?.section?.id || 'operations'])
  );

  const expanded = sidebarPinned || sidebarHovered;

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleViewChange = (view: View) => {
    onViewChange(view);
    const entry = VIEW_MAP[view];
    if (entry) {
      useUIStore.getState().setActiveSection(entry.section.label);
      setExpandedSections((prev) => new Set([...prev, entry.section.id]));
    }
  };

  return (
    <aside
      onMouseEnter={() => setSidebarHovered(true)}
      onMouseLeave={() => setSidebarHovered(false)}
      className={`fixed left-0 top-12 bottom-7 z-40 bg-forge-surface/95 backdrop-blur-md border-r border-forge-border transition-all duration-300 ease-out overflow-hidden flex flex-col ${
        expanded ? 'w-56' : 'w-12'
      }`}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Pin button */}
      {expanded && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/50">
          <span className="text-[9px] font-mono tracking-widest text-forge-text-dim uppercase">Navigation</span>
          <button
            onClick={() => setSidebarPinned(!sidebarPinned)}
            className={`text-xs transition-colors ${sidebarPinned ? 'text-forge-cyan' : 'text-forge-text-dim hover:text-forge-text'}`}
            aria-label={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'}
            title={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'}
          >
            {sidebarPinned ? '📌' : '📍'}
          </button>
        </div>
      )}

      {/* Sections */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {NAV_SECTIONS.map((section) => {
          const isExpanded = expandedSections.has(section.id);
          const hasActive = section.items.some((i) => i.id === activeView);

          return (
            <div key={section.id} className="mb-0.5">
              {/* Section header */}
              {expanded ? (
                <button
                  onClick={() => toggleSection(section.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-mono tracking-wider transition-colors ${
                    hasActive ? 'text-forge-cyan' : 'text-forge-text-dim hover:text-forge-text'
                  }`}
                >
                  <span className="text-sm w-5 text-center">{section.icon}</span>
                  <span className="flex-1 text-left uppercase">{section.label}</span>
                  <span className="text-[8px] transition-transform" style={{ transform: isExpanded ? 'rotate(0)' : 'rotate(-90deg)' }}>▼</span>
                </button>
              ) : (
                <Tooltip content={section.label} side="right">
                  <button
                    onClick={() => {
                      // Click collapsed icon = go to first item in section
                      handleViewChange(section.items[0].id);
                    }}
                    className={`w-full flex justify-center py-2.5 transition-colors ${
                      hasActive ? 'text-forge-cyan' : 'text-forge-text-dim hover:text-forge-text'
                    }`}
                  >
                    <span className="text-base">{section.icon}</span>
                  </button>
                </Tooltip>
              )}

              {/* Items */}
              {expanded && isExpanded && (
                <div className="pb-1">
                  {section.items.map((item) => {
                    const isActive = item.id === activeView;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleViewChange(item.id)}
                        className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-[11px] font-mono transition-all ${
                          isActive
                            ? 'text-forge-cyan bg-forge-cyan/8 border-r-2 border-forge-cyan'
                            : 'text-forge-text-dim hover:text-forge-text hover:bg-forge-panel/30'
                        }`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <span className="w-4 text-center text-xs">{item.icon}</span>
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.shortcut && (
                          <kbd className="text-[8px] text-forge-text-dim/50 bg-forge-panel/50 px-1 rounded">{item.shortcut}</kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
