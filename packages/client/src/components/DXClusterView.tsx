import React, { useState, useEffect } from 'react';
import type { DXSpot } from '@signalforge/shared';

export const DXClusterView: React.FC = () => {
  const [spots, setSpots] = useState<DXSpot[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [bandFilter, setBandFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');

  const fetchData = async () => {
    try {
      const [sRes, cRes] = await Promise.all([fetch('/api/dxcluster/spots'), fetch('/api/dxcluster/config')]);
      setSpots(await sRes.json());
      setConfig(await cRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'dx_spot') setSpots(prev => [msg.spot, ...prev].slice(0, 200));
      } catch { /* binary */ }
    };
    return () => ws.close();
  }, []);

  const connect = async () => {
    await fetch('/api/dxcluster/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    fetchData();
  };

  const disconnect = async () => {
    await fetch('/api/dxcluster/disconnect', { method: 'POST' });
    fetchData();
  };

  const tuneToSpot = async (spot: DXSpot) => {
    await fetch('/api/sdr/frequency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frequency: spot.frequency }),
    });
  };

  const freqToBand = (f: number): string => {
    const mhz = f / 1e6;
    if (mhz < 2) return '160m'; if (mhz < 4) return '80m'; if (mhz < 8) return '40m';
    if (mhz < 11) return '30m'; if (mhz < 15) return '20m'; if (mhz < 19) return '17m';
    if (mhz < 22) return '15m'; if (mhz < 25) return '12m'; if (mhz < 30) return '10m';
    if (mhz < 55) return '6m'; return '?';
  };

  const bands = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m'];
  const modesSet = [...new Set(spots.map(s => s.mode).filter(Boolean))];

  let filtered = spots;
  if (bandFilter) filtered = filtered.filter(s => freqToBand(s.frequency) === bandFilter);
  if (modeFilter) filtered = filtered.filter(s => s.mode === modeFilter);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🌍 DX CLUSTER</h2>
        <div className="flex items-center gap-2 ml-4">
          <span className={`w-2 h-2 rounded-full ${config?.connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs font-mono text-forge-text-dim">{config?.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          {config?.connected ? (
            <button onClick={disconnect} className="px-2 py-0.5 text-[10px] font-mono bg-red-500/10 text-red-400 rounded">DISCONNECT</button>
          ) : (
            <button onClick={connect} className="px-2 py-0.5 text-[10px] font-mono bg-green-500/10 text-green-400 rounded">CONNECT</button>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <select value={bandFilter} onChange={e => setBandFilter(e.target.value)}
            className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text">
            <option value="">All bands</option>
            {bands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
            className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text">
            <option value="">All modes</option>
            {modesSet.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-forge-text-dim sticky top-0 bg-forge-surface">
            <tr>
              <th className="text-left px-2 py-1">Time</th>
              <th className="text-left px-2 py-1">Spotter</th>
              <th className="text-left px-2 py-1">DX</th>
              <th className="text-left px-2 py-1">Freq</th>
              <th className="text-left px-2 py-1">Band</th>
              <th className="text-left px-2 py-1">Mode</th>
              <th className="text-left px-2 py-1">Entity</th>
              <th className="text-left px-2 py-1">Comment</th>
              <th className="text-left px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} className={`border-t border-forge-border/30 hover:bg-forge-panel/30 ${s.isRare ? 'bg-forge-amber/5' : ''}`}>
                <td className="px-2 py-1 text-forge-text-dim">{new Date(s.timestamp).toLocaleTimeString()}</td>
                <td className="px-2 py-1 text-forge-text">{s.spotter}</td>
                <td className="px-2 py-1 font-bold" style={{ color: s.isRare ? '#ffab00' : '#00e5ff' }}>{s.spotted}</td>
                <td className="px-2 py-1 text-forge-text">{(s.frequency / 1e6).toFixed(3)}</td>
                <td className="px-2 py-1 text-forge-text-dim">{freqToBand(s.frequency)}</td>
                <td className="px-2 py-1 text-forge-amber">{s.mode || '—'}</td>
                <td className="px-2 py-1 text-forge-text-dim">{s.entity || '—'} {s.continent ? `(${s.continent})` : ''}</td>
                <td className="px-2 py-1 text-forge-text-dim text-[10px]">{s.comment}</td>
                <td className="px-2 py-1">
                  <button onClick={() => tuneToSpot(s)} className="px-2 py-0.5 text-[10px] font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20" title="Tune SDR to this frequency">
                    📻
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-forge-text-dim text-xs font-mono py-8">
            {config?.connected ? 'Waiting for spots...' : 'Click CONNECT to receive DX spots'}
          </p>
        )}
      </div>
    </div>
  );
};
