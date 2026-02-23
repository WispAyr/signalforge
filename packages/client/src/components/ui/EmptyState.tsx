import React from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center py-16 px-8 text-center ${className}`}>
    <div className="text-5xl mb-4 opacity-60">{icon}</div>
    <h3 className="font-display text-lg tracking-wider text-forge-text mb-2">{title}</h3>
    <p className="text-xs font-mono text-forge-text-dim max-w-sm mb-6 leading-relaxed">{description}</p>
    {action && <Button variant="primary" size="md" onClick={action.onClick}>{action.label}</Button>}
  </div>
);
