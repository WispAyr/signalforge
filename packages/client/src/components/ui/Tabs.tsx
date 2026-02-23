import React from 'react';

interface Tab { id: string; label: string; icon?: string; }
interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, active, onChange, className = '' }) => (
  <div className={`flex gap-0.5 border-b border-forge-border ${className}`} role="tablist">
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={`px-3 py-2 text-[10px] font-mono tracking-wider transition-all border-b-2 -mb-px ${
          active === t.id
            ? 'text-forge-cyan border-forge-cyan bg-forge-cyan/5'
            : 'text-forge-text-dim border-transparent hover:text-forge-text hover:border-forge-border'
        }`}
      >
        {t.icon && <span className="mr-1">{t.icon}</span>}{t.label}
      </button>
    ))}
  </div>
);
