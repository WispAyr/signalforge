import React, { useState, useEffect } from 'react';
import type { VoiceDecoderState, DigitalVoiceFrame, TalkgroupInfo } from '@signalforge/shared';

export const VoiceDecoderView: React.FC = () => {
  const [decoders, setDecoders] = useState<VoiceDecoderState[]>([]);
  const [frames, setFrames] = useState<DigitalVoiceFrame[]>([]);
  const [talkgroups, setTalkgroups] = useState<TalkgroupInfo[]>([]);
  const [filter, setFilter] = useState<string>('all');

  const fetchData = async () => {
    try {
      const [dRes, fRes, tRes] = await Promise.all([
        fetch('/api/voice/decoders'),
        fetch('/api/voice/frames?limit=200'),
        fetch('/api/voice/talkgroups'),
      ]);
      setDecoders(await dRes.json());
      setFrames(await fRes.json());
      setTalkgroups(await tRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 3000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'voice_frame') setFrames(prev => [msg.frame, ...prev].slice(0, 200));
      } catch { /* binary */ }
    };
    return () => ws.close();
  }, []);

  const toggleDecoder = async (protocol: string, enabled: boolean) => {
    await fetch(`/api/voice/decoders/${protocol}/${enabled ? 'disable' : 'enable'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    fetchData();
  };

  const protocolColor = (p: string) => {
    switch (p) { case 'DMR': return '#00e5ff'; case 'DSTAR': return '#ffab00'; case 'C4FM': return '#e040fb'; default: return '#888'; }
  };

  const filtered = filter === 'all' ? frames : frames.filter(f => f.protocol === filter);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🎙️ DIGITAL VOICE</h2>
        <div className="flex gap-1 ml-4">
          {['all', 'DMR', 'DSTAR', 'C4FM'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-mono rounded ${filter === f ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Decoder cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {decoders.map(d => (
          <div key={d.protocol} className="panel-border rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono font-bold" style={{ color: protocolColor(d.protocol) }}>{d.protocol}</span>
              <button onClick={() => toggleDecoder(d.protocol, d.enabled)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${d.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {d.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="text-[10px] font-mono text-forge-text-dim space-y-0.5">
              <div>Freq: {(d.frequency / 1e6).toFixed(3)} MHz</div>
              <div>Decoded: {d.framesDecoded}</div>
              <div>Active: {d.activeCallsigns.join(', ') || '—'}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Talkgroups */}
      <div className="mb-3">
        <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">TALKGROUPS</h3>
        <div className="flex flex-wrap gap-2">
          {talkgroups.map(tg => (
            <div key={tg.id} className={`px-2 py-1 rounded text-[10px] font-mono ${tg.active ? 'bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20' : 'bg-forge-bg text-forge-text-dim border border-forge-border'}`}>
              TG{tg.id} {tg.name}
              {tg.active && <span className="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-green-400 animate-pulse" />}
            </div>
          ))}
        </div>
      </div>

      {/* Frame list */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-forge-text-dim sticky top-0 bg-forge-surface">
            <tr>
              <th className="text-left px-2 py-1">Time</th>
              <th className="text-left px-2 py-1">Protocol</th>
              <th className="text-left px-2 py-1">Callsign</th>
              <th className="text-left px-2 py-1">Talkgroup</th>
              <th className="text-left px-2 py-1">Signal</th>
              <th className="text-left px-2 py-1">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => (
              <tr key={f.id} className="border-t border-forge-border/30 hover:bg-forge-panel/30">
                <td className="px-2 py-1 text-forge-text-dim">{new Date(f.timestamp).toLocaleTimeString()}</td>
                <td className="px-2 py-1" style={{ color: protocolColor(f.protocol) }}>{f.protocol}</td>
                <td className="px-2 py-1 text-forge-text">{f.sourceCallsign || f.myCallsign || '—'}</td>
                <td className="px-2 py-1 text-forge-text-dim">{f.talkgroupName || f.destCallsign || '—'}</td>
                <td className="px-2 py-1 text-forge-text-dim">{f.signalStrength?.toFixed(0)} dBm</td>
                <td className="px-2 py-1 text-forge-text-dim text-[10px]">
                  {f.protocol === 'DMR' && `TS${f.timeslot} CC${f.colorCode} RID:${f.radioId}`}
                  {f.protocol === 'DSTAR' && `RPT:${f.rpt1Callsign}`}
                  {f.protocol === 'C4FM' && `DG:${f.dgId} ${f.dataType}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-center text-forge-text-dim text-xs py-8">Enable a decoder to see frames</p>}
      </div>
    </div>
  );
};
