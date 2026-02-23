import React, { useState, useEffect } from 'react';
import type { MeshNode, MeshMessage, MeshtasticStatus } from '@signalforge/shared';

export const MeshtasticView: React.FC = () => {
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [status, setStatus] = useState<MeshtasticStatus | null>(null);
  const [tab, setTab] = useState<'nodes' | 'messages'>('nodes');
  const [msgText, setMsgText] = useState('');

  const fetchData = async () => {
    try {
      const [nRes, mRes, sRes] = await Promise.all([fetch('/api/meshtastic/nodes'), fetch('/api/meshtastic/messages?limit=100'), fetch('/api/meshtastic/status')]);
      setNodes(await nRes.json());
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
        if (msg.type === 'mesh_message') setMessages(prev => [msg.message, ...prev].slice(0, 500));
        if (msg.type === 'mesh_nodes') setNodes(msg.nodes);
      } catch {}
    };
    return () => ws.close();
  }, []);

  const sendMsg = async () => {
    if (!msgText.trim()) return;
    await fetch('/api/meshtastic/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msgText }) });
    setMsgText('');
    fetchData();
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📡 MESHTASTIC</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.connected ? 'text-green-400' : 'text-red-400'}>{status.connected ? '● CONNECTED' : '○ DISCONNECTED'}</span>
            <span>{status.nodeCount} nodes</span>
            <span>{status.messagesReceived} msgs</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-3">
        {(['nodes', 'messages'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
            {t === 'nodes' ? `Nodes (${nodes.length})` : `Messages (${messages.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'nodes' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {nodes.map(node => (
              <div key={node.id} className="bg-forge-panel rounded-lg border border-forge-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">📡</span>
                  <div>
                    <div className="text-sm font-bold text-forge-text">{node.longName}</div>
                    <div className="text-[10px] font-mono text-forge-text-dim">{node.shortName} — {node.hwModel} — {node.role}</div>
                  </div>
                  <span className="ml-auto text-[10px] font-mono text-forge-text-dim">{node.hopsAway === 0 ? 'LOCAL' : `${node.hopsAway} hops`}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {node.batteryLevel != null && (
                    <div className="bg-forge-bg/50 rounded p-2">
                      <div className="text-forge-text-dim">Battery</div>
                      <div className={`font-bold ${node.batteryLevel > 50 ? 'text-green-400' : node.batteryLevel > 20 ? 'text-yellow-400' : 'text-red-400'}`}>{node.batteryLevel.toFixed(0)}%</div>
                    </div>
                  )}
                  {node.snr != null && (
                    <div className="bg-forge-bg/50 rounded p-2">
                      <div className="text-forge-text-dim">SNR</div>
                      <div className="text-forge-amber font-bold">{node.snr.toFixed(1)} dB</div>
                    </div>
                  )}
                  {node.temperature != null && (
                    <div className="bg-forge-bg/50 rounded p-2">
                      <div className="text-forge-text-dim">Temp</div>
                      <div className="text-forge-cyan font-bold">{node.temperature.toFixed(1)}°C</div>
                    </div>
                  )}
                </div>
                <div className="mt-2 text-[10px] font-mono text-forge-text-dim">
                  {node.latitude && node.longitude ? `📍 ${node.latitude.toFixed(4)}, ${node.longitude.toFixed(4)}` : '📍 No GPS'}
                  {' — '}{new Date(node.lastHeard).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto space-y-1 mb-3">
              {messages.map(msg => (
                <div key={msg.id} className="bg-forge-panel/50 rounded p-2 text-xs font-mono">
                  <span className="text-forge-cyan">{msg.fromName}</span>
                  <span className="text-forge-text-dim"> → </span>
                  <span className="text-forge-amber">{msg.toName}</span>
                  <span className="text-forge-text-dim"> [{new Date(msg.timestamp).toLocaleTimeString()}]</span>
                  <div className="text-forge-text mt-0.5">{msg.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={msgText} onChange={e => setMsgText(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMsg()}
                placeholder="Type message..." className="flex-1 px-3 py-2 text-xs font-mono bg-forge-bg border border-forge-border rounded" />
              <button onClick={sendMsg} className="px-4 py-2 text-xs font-mono bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30 rounded hover:bg-forge-cyan/25">Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
