import React, { useState, useEffect } from 'react';
import type { PagerMessage, PagerStats } from '@signalforge/shared';

export const PagerView: React.FC = () => {
  const [messages, setMessages] = useState<PagerMessage[]>([]);
  const [stats, setStats] = useState<PagerStats | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    try {
      const [mRes, sRes] = await Promise.all([fetch('/api/pager/messages?limit=200'), fetch('/api/pager/stats')]);
      setMessages(await mRes.json());
      setStats(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'pager_message') setMessages(prev => [msg.message, ...prev].slice(0, 500));
      } catch {}
    };
    return () => ws.close();
  }, []);

  const filtered = messages
    .filter(m => filter === 'all' || m.protocol === filter)
    .filter(m => !search || m.content.toLowerCase().includes(search.toLowerCase()) || String(m.capcode).includes(search));

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📟 PAGER DECODER</h2>
        <div className="flex gap-1 ml-4">
          {['all', 'POCSAG', 'FLEX'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-mono rounded ${filter === f ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {f}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search capcode or text..."
          className="ml-auto px-3 py-1 text-xs font-mono bg-forge-bg border border-forge-border rounded w-60" />
      </div>

      {stats && (
        <div className="flex gap-4 mb-3 text-xs font-mono text-forge-text-dim">
          <span>Total: {stats.totalMessages}</span>
          <span className="text-red-400">POCSAG: {stats.pocsagMessages}</span>
          <span className="text-purple-400">FLEX: {stats.flexMessages}</span>
          <span>Capcodes: {stats.uniqueCapcodes}</span>
          <span>{stats.messagesPerHour}/hr</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
            <tr><th className="text-left p-2">Time</th><th className="text-left p-2">Proto</th><th className="text-left p-2">Capcode</th><th className="text-left p-2">Baud</th><th className="text-left p-2">Type</th><th className="text-left p-2">Content</th></tr>
          </thead>
          <tbody>
            {filtered.map(msg => (
              <tr key={msg.id} className="border-t border-forge-border/30 hover:bg-forge-panel/50">
                <td className="p-2 text-forge-text-dim whitespace-nowrap">{new Date(msg.timestamp).toLocaleTimeString()}</td>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${msg.protocol === 'POCSAG' ? 'bg-red-500/20 text-red-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    {msg.protocol}
                  </span>
                </td>
                <td className="p-2 text-forge-amber">{msg.capcode}</td>
                <td className="p-2 text-forge-text-dim">{msg.baudRate}</td>
                <td className="p-2 text-forge-text-dim">{msg.messageType}</td>
                <td className="p-2 text-forge-text max-w-lg truncate">{msg.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
