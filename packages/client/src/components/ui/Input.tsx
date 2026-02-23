import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', ...rest }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[10px] font-mono tracking-wider text-forge-text-dim uppercase">{label}</label>}
      <div className="relative">
        {icon && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-forge-text-dim text-xs">{icon}</span>}
        <input
          ref={ref}
          className={`w-full bg-forge-bg border border-forge-border rounded-md px-3 py-2 text-xs font-mono text-forge-text placeholder:text-forge-text-dim/50 focus:outline-none focus:border-forge-cyan/50 focus:ring-1 focus:ring-forge-cyan/20 transition-colors ${icon ? 'pl-8' : ''} ${error ? 'border-forge-red/50' : ''} ${className}`}
          {...rest}
        />
      </div>
      {error && <span className="text-[10px] font-mono text-forge-red">{error}</span>}
    </div>
  )
);
Input.displayName = 'Input';
