import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'outlined' | 'elevated';
  glow?: 'cyan' | 'amber' | 'red' | 'green' | 'purple' | 'none';
  hoverable?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' };
const glowMap = {
  none: '',
  cyan: 'hover:shadow-[0_0_10px_rgba(0,229,255,0.3)]',
  amber: 'hover:shadow-[0_0_10px_rgba(255,171,0,0.3)]',
  red: 'hover:shadow-[0_0_10px_rgba(255,23,68,0.3)]',
  green: 'hover:shadow-[0_0_10px_rgba(0,230,118,0.3)]',
  purple: 'hover:shadow-[0_0_10px_rgba(170,0,255,0.3)]',
};

const variantMap = {
  default: 'panel-border rounded-lg',
  glass: 'bg-forge-surface/60 backdrop-blur-md border border-forge-border/50 rounded-lg',
  outlined: 'border border-forge-border rounded-lg',
  elevated: 'bg-forge-surface shadow-lg rounded-lg',
};

export const Card: React.FC<CardProps> = ({
  variant = 'default', glow = 'none', hoverable = false, padding = 'md',
  className = '', children, ...rest
}) => (
  <div
    className={`${variantMap[variant]} ${padMap[padding]} ${glowMap[glow]} ${hoverable ? 'hover:border-forge-cyan/30 hover:bg-forge-cyan/5 cursor-pointer transition-all duration-200' : 'transition-colors duration-200'} ${className}`}
    {...rest}
  >
    {children}
  </div>
);
