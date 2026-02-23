import React, { useState, useEffect } from 'react';
import { offlineStore } from '../services/offline';

export const OfflineIndicator: React.FC = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    const unsub = offlineStore.onStatusChange((isOnline) => {
      setOnline(isOnline);
      if (isOnline) {
        offlineStore.syncQueue().then(({ synced }) => {
          if (synced > 0) setQueueCount(0);
        });
      }
    });

    // Check queue size periodically
    const interval = setInterval(async () => {
      const actions = await offlineStore.getQueuedActions();
      setQueueCount(actions.length);
    }, 5000);

    return () => { unsub(); clearInterval(interval); };
  }, []);

  if (online && queueCount === 0) return null;

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs border ${
      online ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
    }`}>
      {!online && <span>📴 Offline Mode</span>}
      {online && queueCount > 0 && <span>🔄 Syncing {queueCount} queued items...</span>}
    </div>
  );
};
