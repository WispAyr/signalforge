import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  size?: 'sm' | 'md';
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  default: 'bg-forge-panel text-forge-text-dim border-forge-border',
  success: 'bg-forge-green/10 text-forge-green border-forge-green/30',
  warning: 'bg-forge-amber/10 text-forge-amber border-forge-amber/30',
  danger:  'bg-forge-red/10 text-forge-red border-forge-red/30',
  info:    'bg-forge-cyan/10 text-forge-cyan border-forge-cyan/30',
  purple:  'bg-purple-500/10 text-purple-400 border-purple-500/30',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', size = 'sm', pulse, children, className = '' }) => (
  <span className={`inline-flex items-center gap-1 border rounded-full font-mono tracking-wider ${size === 'sm' ? 'px-2 py-0.5 text-[9px]' : 'px-3 py-1 text-[10px]'} ${variantStyles[variant]} ${className}`}>
    {pulse && <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${variant === 'success' ? 'bg-forge-green' : variant === 'danger' ? 'bg-forge-red' : variant === 'warning' ? 'bg-forge-amber' : 'bg-forge-cyan'}`} />}
    {children}
  </span>
);
