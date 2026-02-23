import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled, size = 'md' }) => {
  const w = size === 'sm' ? 'w-8' : 'w-10';
  const h = size === 'sm' ? 'h-4' : 'h-5';
  const dot = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const translate = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`${w} ${h} rounded-full relative transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-forge-cyan/30 ${checked ? 'bg-forge-cyan/30' : 'bg-forge-border'}`}
      >
        <span className={`${dot} rounded-full absolute top-0.5 left-0.5 transition-all duration-200 ${checked ? `${translate} bg-forge-cyan shadow-[0_0_6px_rgba(0,229,255,0.5)]` : 'bg-forge-text-dim'}`} />
      </button>
      {label && <span className="text-xs font-mono text-forge-text-dim">{label}</span>}
    </label>
  );
};
