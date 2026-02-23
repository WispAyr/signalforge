import React, { useState, useEffect } from 'react';
import type { FieldModeStatus, FieldChecklist } from '@signalforge/shared';

export const FieldModeView: React.FC = () => {
  const [status, setStatus] = useState<FieldModeStatus | null>(null);
  const [checklists, setChecklists] = useState<FieldChecklist[]>([]);

  const fetchData = async () => {
    try {
      const [sRes, cRes] = await Promise.all([fetch('/api/fieldmode/status'), fetch('/api/fieldmode/checklists')]);
      setStatus(await sRes.json());
      setChecklists(await cRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); }, []);

  const toggleFieldMode = async () => {
    await fetch(`/api/fieldmode/${status?.enabled ? 'disable' : 'enable'}`, { method: 'POST' });
    fetchData();
  };

  const createChecklist = async () => {
    await fetch('/api/fieldmode/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Field Deployment ${new Date().toLocaleDateString()}` }) });
    fetchData();
  };

  const toggleItem = async (clId: string, itemId: string, checked: boolean) => {
    await fetch(`/api/fieldmode/checklists/${clId}/items/${itemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checked: !checked }) });
    fetchData();
  };

  const formatSize = (bytes: number) => bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(0)} KB`;

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🏕️ FIELD MODE</h2>
        <button onClick={toggleFieldMode}
          className={`px-4 py-1.5 text-xs font-mono rounded border ${status?.enabled ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-forge-panel border-forge-border text-forge-text-dim'}`}>
          {status?.enabled ? '● FIELD MODE ACTIVE' : '○ ENABLE FIELD MODE'}
        </button>
      </div>

      <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cached Assets */}
        <div className="bg-forge-panel rounded-lg border border-forge-border p-4">
          <h3 className="text-sm font-mono font-bold text-forge-text mb-3">📦 CACHED ASSETS</h3>
          {status && (
            <div className="text-xs font-mono text-forge-text-dim mb-3">
              Storage: {formatSize(status.storageUsed)} / {formatSize(status.storageAvailable)} — {status.offlineReady ? '✅ Offline Ready' : '⚠️ Not Ready'}
            </div>
          )}
          <div className="space-y-2">
            {status?.cachedAssets.map(asset => (
              <div key={asset.type} className="flex items-center gap-3 bg-forge-bg/50 rounded p-2 text-xs font-mono">
                <div className="flex-1">
                  <div className="text-forge-text">{asset.name}</div>
                  <div className="text-forge-text-dim">{formatSize(asset.size)} — v{asset.version} — {new Date(asset.lastUpdated).toLocaleDateString()}</div>
                </div>
                <button onClick={() => fetch(`/api/fieldmode/refresh/${asset.type}`, { method: 'POST' }).then(fetchData)}
                  className="px-2 py-1 text-[10px] bg-forge-cyan/10 text-forge-cyan rounded border border-forge-cyan/20 hover:bg-forge-cyan/20">Refresh</button>
              </div>
            ))}
          </div>
        </div>

        {/* Checklists */}
        <div className="bg-forge-panel rounded-lg border border-forge-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-mono font-bold text-forge-text">✅ DEPLOYMENT CHECKLISTS</h3>
            <button onClick={createChecklist} className="ml-auto px-2 py-1 text-[10px] font-mono bg-forge-cyan/10 text-forge-cyan rounded border border-forge-cyan/20">+ New</button>
          </div>
          {checklists.map(cl => (
            <div key={cl.id} className="mb-4">
              <div className="text-xs font-mono text-forge-cyan mb-2">{cl.name} {cl.completedAt && <span className="text-green-400">✅ Complete</span>}</div>
              <div className="space-y-1">
                {cl.items.map(item => (
                  <label key={item.id} className="flex items-center gap-2 text-xs font-mono cursor-pointer hover:bg-forge-bg/30 rounded p-1">
                    <input type="checkbox" checked={item.checked} onChange={() => toggleItem(cl.id, item.id, item.checked)} className="accent-forge-cyan" />
                    <span className={item.checked ? 'text-forge-text-dim line-through' : 'text-forge-text'}>{item.label}</span>
                    <span className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-forge-bg/50 text-forge-text-dim">{item.category}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {checklists.length === 0 && <div className="text-center py-4 text-forge-text-dim text-sm">No checklists yet. Create one for your next deployment.</div>}
        </div>
      </div>
    </div>
  );
};
