import React, { createContext, useContext, useState, useCallback } from 'react';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface ToastCtx {
  toast: (message: string, type?: ToastItem['type']) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

let nextId = 0;

export const Toast: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = nextId++;
    setToasts((p) => [...p, { id, message, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);

  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const colors = { success: 'border-forge-green/50 text-forge-green', error: 'border-forge-red/50 text-forge-red', info: 'border-forge-cyan/50 text-forge-cyan', warning: 'border-forge-amber/50 text-forge-amber' };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-forge-surface border rounded-lg shadow-xl text-xs font-mono animate-[slideInRight_200ms_ease-out] ${colors[t.type]}`}>
            <span className="text-sm">{icons[t.type]}</span>
            <span className="text-forge-text">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
