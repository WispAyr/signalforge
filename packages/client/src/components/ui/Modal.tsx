import React, { useEffect, useCallback } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}

const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' };

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, width = 'md' }) => {
  const handleEsc = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_150ms]" onClick={onClose} />
      <div className={`relative ${widths[width]} w-full mx-4 bg-forge-surface border border-forge-border rounded-xl shadow-2xl animate-[slideUp_200ms_ease-out]`}>
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-forge-border">
            <h2 className="text-sm font-display tracking-wider text-forge-cyan">{title}</h2>
            <button onClick={onClose} className="text-forge-text-dim hover:text-forge-text transition-colors text-lg" aria-label="Close">✕</button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};
