import React, { useState, useEffect } from 'react';
import type { AudioStream, AudioChatRoom } from '@signalforge/shared';

export const AudioStreamView: React.FC = () => {
  const [streams, setStreams] = useState<AudioStream[]>([]);
  const [rooms, setRooms] = useState<AudioChatRoom[]>([]);
  const [tab, setTab] = useState<'streams' | 'rooms' | 'config'>('streams');
  const [showCreate, setShowCreate] = useState(false);
  const [newStream, setNewStream] = useState({ name: '', frequency: 145500000, mode: 'FM', createdBy: 'Operator' });

  const fetchData = async () => {
    try {
      const [sRes, rRes] = await Promise.all([fetch('/api/audio/streams'), fetch('/api/audio/rooms')]);
      setStreams(await sRes.json());
      setRooms(await rRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  const createStream = async () => {
    if (!newStream.name) return;
    await fetch('/api/audio/streams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newStream),
    });
    setShowCreate(false);
    fetchData();
  };

  const stopStream = async (id: string) => {
    await fetch(`/api/audio/streams/${id}/stop`, { method: 'POST' });
    fetchData();
  };

  const joinStream = async (id: string) => {
    await fetch(`/api/audio/streams/${id}/join`, { method: 'POST' });
    fetchData();
  };

  const createRoom = async () => {
    const name = prompt('Room name:');
    if (!name) return;
    await fetch('/api/audio/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, maxParticipants: 10 }),
    });
    fetchData();
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🔊 AUDIO STREAMING</h2>
        <div className="flex gap-1 ml-4">
          {(['streams', 'rooms', 'config'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        {tab === 'streams' && (
          <button onClick={() => setShowCreate(!showCreate)} className="ml-auto px-3 py-1 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded">+ STREAM</button>
        )}
        {tab === 'rooms' && (
          <button onClick={createRoom} className="ml-auto px-3 py-1 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded">+ ROOM</button>
        )}
      </div>

      {showCreate && tab === 'streams' && (
        <div className="panel-border rounded p-4 mb-4">
          <div className="grid grid-cols-4 gap-3">
            <input value={newStream.name} onChange={e => setNewStream({ ...newStream, name: e.target.value })}
              placeholder="Stream name" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newStream.frequency / 1e6} type="number" step="0.001"
              onChange={e => setNewStream({ ...newStream, frequency: parseFloat(e.target.value) * 1e6 })}
              placeholder="MHz" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newStream.mode} onChange={e => setNewStream({ ...newStream, mode: e.target.value })}
              placeholder="Mode" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <button onClick={createStream} className="px-3 py-1 text-xs font-mono bg-forge-green/20 text-forge-green rounded">CREATE</button>
          </div>
        </div>
      )}

      {tab === 'streams' && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {streams.map(s => (
            <div key={s.id} className={`panel-border rounded p-3 flex items-center justify-between ${s.active ? 'border-green-500/20' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${s.active ? 'bg-green-400 animate-pulse' : 'bg-forge-text-dim'}`} />
                <div>
                  <div className="text-sm font-mono text-forge-text">{s.name}</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">
                    {(s.frequency / 1e6).toFixed(3)} MHz • {s.mode} • {s.format.toUpperCase()} {s.bitrate / 1000}kbps • 👥 {s.listeners}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {s.active && (
                  <>
                    <button onClick={() => joinStream(s.id)} className="px-2 py-0.5 text-[10px] font-mono bg-forge-cyan/10 text-forge-cyan rounded">LISTEN</button>
                    <button onClick={() => stopStream(s.id)} className="px-2 py-0.5 text-[10px] font-mono bg-red-500/10 text-red-400 rounded">STOP</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {streams.length === 0 && <p className="text-center text-forge-text-dim text-xs font-mono py-8">No audio streams. Click + STREAM to share audio.</p>}
        </div>
      )}

      {tab === 'rooms' && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {rooms.map(r => (
            <div key={r.id} className="panel-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-mono text-forge-text">🎙️ {r.name}</span>
                <span className="text-[10px] font-mono text-forge-text-dim">{r.participants.length}/{r.maxParticipants}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.participants.map(p => (
                  <span key={p.userId} className={`px-2 py-0.5 rounded text-[10px] font-mono ${p.speaking ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-forge-bg text-forge-text-dim'}`}>
                    {p.muted ? '🔇' : '🔊'} {p.nickname}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {rooms.length === 0 && <p className="text-center text-forge-text-dim text-xs font-mono py-8">No voice rooms. Click + ROOM to create one.</p>}
        </div>
      )}

      {tab === 'config' && (
        <div className="panel-border rounded p-4 space-y-3 max-w-md">
          <h3 className="text-xs font-mono text-forge-text-dim tracking-wider">STREAMING CONFIGURATION</h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between"><span className="text-forge-text-dim">Format:</span><span className="text-forge-text">Opus</span></div>
            <div className="flex justify-between"><span className="text-forge-text-dim">Sample Rate:</span><span className="text-forge-text">48000 Hz</span></div>
            <div className="flex justify-between"><span className="text-forge-text-dim">Bitrate:</span><span className="text-forge-text">64 kbps</span></div>
            <div className="flex justify-between"><span className="text-forge-text-dim">Max Listeners:</span><span className="text-forge-text">50</span></div>
          </div>
          <div className="border-t border-forge-border pt-3">
            <h4 className="text-[10px] font-mono text-forge-text-dim tracking-wider mb-2">ICECAST OUTPUT (STUB)</h4>
            <div className="text-[10px] font-mono text-forge-text-dim">
              Icecast/Broadcastify output available in future release. Configure host, port, mount point and credentials here.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
