import React from 'react';
import { popOutView } from '../../services/multiwindow';

interface PopOutButtonProps {
  view: string;
  className?: string;
}

export const PopOutButton: React.FC<PopOutButtonProps> = ({ view, className = '' }) => {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); popOutView(view); }}
      className={`px-2 py-1 rounded text-xs font-mono text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors ${className}`}
      title={`Open ${view} in new window`}
    >
      ↗️ Pop Out
    </button>
  );
};
