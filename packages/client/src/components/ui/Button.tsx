import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
}

const variants = {
  primary:   'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30 hover:bg-forge-cyan/25 hover:shadow-[0_0_12px_rgba(0,229,255,0.25)] active:scale-[0.97]',
  secondary: 'bg-forge-amber/15 text-forge-amber border border-forge-amber/30 hover:bg-forge-amber/25 active:scale-[0.97]',
  ghost:     'text-forge-text-dim hover:text-forge-text hover:bg-forge-panel/50 active:scale-[0.97]',
  danger:    'bg-forge-red/15 text-forge-red border border-forge-red/30 hover:bg-forge-red/25 active:scale-[0.97]',
  outline:   'border border-forge-border text-forge-text-dim hover:border-forge-cyan/30 hover:text-forge-cyan active:scale-[0.97]',
};

const sizes = {
  xs: 'px-2 py-1 text-[10px]',
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary', size = 'sm', icon, loading, children, className = '', disabled, ...rest
}) => (
  <button
    className={`inline-flex items-center justify-center gap-1.5 font-mono tracking-wider rounded-md transition-all duration-150 ${variants[variant]} ${sizes[size]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    disabled={disabled || loading}
    {...rest}
  >
    {loading ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : icon}
    {children}
  </button>
);
