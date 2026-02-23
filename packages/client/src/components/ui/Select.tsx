import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({ label, options, className = '', ...rest }) => (
  <div className="flex flex-col gap-1">
    {label && <label className="text-[10px] font-mono tracking-wider text-forge-text-dim uppercase">{label}</label>}
    <select
      className={`bg-forge-bg border border-forge-border rounded-md px-3 py-2 text-xs font-mono text-forge-text focus:outline-none focus:border-forge-cyan/50 focus:ring-1 focus:ring-forge-cyan/20 transition-colors appearance-none cursor-pointer ${className}`}
      {...rest}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);
