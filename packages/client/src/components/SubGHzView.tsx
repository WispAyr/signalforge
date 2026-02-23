import React, { useState, useEffect } from 'react';
import type { SubGHzSignal, SubGHzStatus } from '@signalforge/shared';

export const SubGHzView: React.FC = () => {
  const [signals, setSignals] = useState<SubGHzSignal[]>([]);
  const [status, setStatus] = useState<SubGHzStatus | null>(null);

  const fetchData = async () => {
    try {
      const [sigRes, stRes] = await Promise.all([fetch('/api/subghz/signals?limit=100'), fetch('/api/subghz/status')]);
      setSignals(await sigRes.json());
      setStatus(await stRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 4000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'subghz_signal') setSignals(prev => [msg.signal, ...prev].slice(0, 200));
      } catch {}
    };
    return () => ws.close();
  }, []);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📶 SUB-GHz ANALYZER</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.connected ? 'text-green-400' : 'text-red-400'}>{status.connected ? '● HACKRF ONLINE' : '○ DISCONNECTED'}</span>
            <span>{status.signalsDetected} signals</span>
            <span>{status.protocolsIdentified} identified</span>
            {status.replayAttemptsDetected > 0 && <span className="text-red-400">⚠ {status.replayAttemptsDetected} replay attacks</span>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
            <tr><th className="text-left p-2">Time</th><th className="text-left p-2">Frequency</th><th className="text-left p-2">Power</th><th className="text-left p-2">Protocol</th><th className="text-left p-2">Device</th><th className="text-left p-2">Modulation</th><th className="text-left p-2">Replay</th></tr>
          </thead>
          <tbody>
            {signals.map(sig => (
              <tr key={sig.id} className={`border-t border-forge-border/30 hover:bg-forge-panel/50 ${sig.isReplay ? 'bg-red-500/10' : ''}`}>
                <td className="p-2 text-forge-text-dim whitespace-nowrap">{new Date(sig.timestamp).toLocaleTimeString()}</td>
                <td className="p-2 text-forge-cyan">{(sig.frequency / 1e6).toFixed(3)} MHz</td>
                <td className="p-2 text-forge-amber">{sig.power.toFixed(0)} dBm</td>
                <td className="p-2 text-forge-text">{sig.protocol || '—'}</td>
                <td className="p-2"><span className="px-1.5 py-0.5 rounded text-[10px] bg-forge-cyan/10 text-forge-cyan">{sig.deviceType?.replace('_', ' ') || 'unknown'}</span></td>
                <td className="p-2 text-forge-text-dim">{sig.modulation || '—'}</td>
                <td className="p-2">{sig.isReplay ? <span className="text-red-400 font-bold">⚠ REPLAY ×{sig.replayCount}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {signals.length === 0 && <div className="text-center py-10 text-forge-text-dim text-sm">No sub-GHz signals detected. Connect HackRF to begin scanning.</div>}
      </div>
    </div>
  );
};
