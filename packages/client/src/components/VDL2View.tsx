import React, { useState, useEffect } from 'react';
import type { VDL2Message, VDL2Status } from '@signalforge/shared';

const MSG_TYPE_COLORS: Record<string, string> = { ACARS: 'bg-blue-500/20 text-blue-400', 'ADS-C': 'bg-green-500/20 text-green-400', CPDLC: 'bg-purple-500/20 text-purple-400', CM: 'bg-yellow-500/20 text-yellow-400', UNKNOWN: 'bg-gray-500/20 text-gray-400' };

export const VDL2View: React.FC = () => {
  const [messages, setMessages] = useState<VDL2Message[]>([]);
  const [status, setStatus] = useState<VDL2Status | null>(null);
  const [filter, setFilter] = useState('all');

  const fetchData = async () => {
    try {
      const [mRes, sRes] = await Promise.all([fetch('/api/vdl2/messages?limit=200'), fetch('/api/vdl2/status')]);
      setMessages(await mRes.json());
      setStatus(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'vdl2_message') setMessages(prev => [msg.message, ...prev].slice(0, 500));
      } catch {}
    };
    return () => ws.close();
  }, []);

  const filtered = filter === 'all' ? messages : messages.filter(m => m.messageType === filter);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">✈️ VDL2 DECODER</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.connected ? 'text-green-400' : 'text-red-400'}>{status.connected ? '● CONNECTED' : '○ OFFLINE'}</span>
            <span>{status.messagesDecoded} decoded</span>
            <span>{status.uniqueAircraft} aircraft</span>
            <span>{status.acarsMessages} ACARS</span>
          </div>
        )}
        <div className="flex gap-1 ml-auto">
          {['all', 'ACARS', 'ADS-C', 'CPDLC', 'CM'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[10px] font-mono rounded ${filter === f ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim'}`}>{f}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
            <tr><th className="text-left p-2">Time</th><th className="text-left p-2">Flight</th><th className="text-left p-2">Reg</th><th className="text-left p-2">Type</th><th className="text-left p-2">Freq</th><th className="text-left p-2">GS</th><th className="text-left p-2">Content</th></tr>
          </thead>
          <tbody>
            {filtered.map(msg => (
              <tr key={msg.id} className="border-t border-forge-border/30 hover:bg-forge-panel/50">
                <td className="p-2 text-forge-text-dim whitespace-nowrap">{new Date(msg.timestamp).toLocaleTimeString()}</td>
                <td className="p-2 text-forge-cyan font-bold">{msg.callsign || msg.flightNumber || '—'}</td>
                <td className="p-2 text-forge-text">{msg.registration || '—'}</td>
                <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${MSG_TYPE_COLORS[msg.messageType] || ''}`}>{msg.messageType}</span></td>
                <td className="p-2 text-forge-amber">{(msg.frequency / 1e6).toFixed(3)}</td>
                <td className="p-2 text-forge-text-dim">{msg.groundStation || '—'}</td>
                <td className="p-2 text-forge-text max-w-md truncate">{msg.acarsText || msg.acarsLabel || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-center py-10 text-forge-text-dim text-sm">No VDL2 messages. Connect dumpvdl2 to begin decoding.</div>}
      </div>
    </div>
  );
};
