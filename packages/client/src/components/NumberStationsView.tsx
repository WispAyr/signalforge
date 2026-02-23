import React, { useState, useEffect } from 'react';
import type { NumberStation, NumberStationNowOnAir } from '@signalforge/shared';

export const NumberStationsView: React.FC = () => {
  const [stations, setStations] = useState<NumberStation[]>([]);
  const [onAir, setOnAir] = useState<NumberStationNowOnAir[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<NumberStation | null>(null);

  const fetchData = async () => {
    try {
      const [sRes, oRes] = await Promise.all([fetch('/api/numberstations'), fetch('/api/numberstations/onair')]);
      setStations(await sRes.json());
      setOnAir(await oRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 30000); return () => clearInterval(i); }, []);

  const filtered = stations.filter(s =>
    !search || s.designator.toLowerCase().includes(search.toLowerCase()) ||
    (s.nickname && s.nickname.toLowerCase().includes(search.toLowerCase())) ||
    (s.country && s.country.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🔢 NUMBER STATIONS</h2>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search stations..."
          className="ml-auto px-3 py-1 text-xs font-mono bg-forge-bg border border-forge-border rounded w-60" />
      </div>

      {onAir.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-forge-amber/30 bg-forge-amber/10">
          <div className="text-xs font-mono font-bold text-forge-amber mb-2 flex items-center gap-2">
            <span className="animate-pulse">🔴</span> NOW ON AIR
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {onAir.map((oa, i) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-forge-cyan font-bold">{oa.station.designator}</span>
                <span className="text-forge-text">{oa.station.nickname}</span>
                <span className="text-forge-amber">{(oa.frequency / 1e3).toFixed(0)} kHz</span>
                <span className="text-forge-text-dim">{oa.startTime}–{oa.endTime} UTC</span>
                {oa.webSdrUrl && <a href={oa.webSdrUrl} target="_blank" rel="noopener" className="text-forge-cyan hover:underline">📻 Listen</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto flex gap-4">
        <div className="flex-1">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
              <tr><th className="text-left p-2">ID</th><th className="text-left p-2">Nickname</th><th className="text-left p-2">Country</th><th className="text-left p-2">Language</th><th className="text-left p-2">Status</th><th className="text-left p-2">Frequencies</th></tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} onClick={() => setSelected(s)} className={`border-t border-forge-border/30 hover:bg-forge-panel/50 cursor-pointer ${selected?.id === s.id ? 'bg-forge-cyan/10' : ''}`}>
                  <td className="p-2 text-forge-cyan font-bold">{s.designator}</td>
                  <td className="p-2 text-forge-text">{s.nickname || '—'}</td>
                  <td className="p-2 text-forge-text-dim">{s.country || '?'}</td>
                  <td className="p-2 text-forge-text-dim">{s.language || '?'}</td>
                  <td className="p-2"><span className={s.status === 'active' ? 'text-green-400' : 'text-red-400'}>{s.status}</span></td>
                  <td className="p-2 text-forge-amber">{s.frequencies.map(f => `${(f.frequency / 1e3).toFixed(0)}`).join(', ')} kHz</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="w-80 bg-forge-panel rounded-lg border border-forge-border p-4 overflow-auto">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🔢</span>
              <div>
                <div className="text-sm font-bold text-forge-cyan">{selected.designator}</div>
                <div className="text-xs text-forge-text">{selected.nickname}</div>
              </div>
            </div>
            <div className="space-y-2 text-xs font-mono">
              <div><span className="text-forge-text-dim">Country:</span> {selected.country || 'Unknown'}</div>
              <div><span className="text-forge-text-dim">Operator:</span> {selected.operator || 'Unknown'}</div>
              <div><span className="text-forge-text-dim">Language:</span> {selected.language || 'Unknown'}</div>
              <div><span className="text-forge-text-dim">Signal:</span> {selected.signalType}</div>
              {selected.voiceType && <div><span className="text-forge-text-dim">Voice:</span> {selected.voiceType}</div>}
              <div><span className="text-forge-text-dim">First logged:</span> {selected.firstLogged || '?'}</div>
              <div className="pt-2 border-t border-forge-border"><span className="text-forge-text-dim">Description:</span><p className="text-forge-text mt-1">{selected.description}</p></div>
              <div className="pt-2 border-t border-forge-border">
                <div className="text-forge-text-dim mb-1">Frequencies:</div>
                {selected.frequencies.map((f, i) => (
                  <div key={i} className="text-forge-amber">{(f.frequency / 1e3).toFixed(0)} kHz {f.mode} {f.primary ? '(primary)' : ''}</div>
                ))}
              </div>
              {selected.schedule.length > 0 && (
                <div className="pt-2 border-t border-forge-border">
                  <div className="text-forge-text-dim mb-1">Schedule:</div>
                  {selected.schedule.map((s, i) => (
                    <div key={i} className="text-forge-text">{s.timeUTC} UTC {s.dayOfWeek ? `(days: ${s.dayOfWeek.join(',')})` : '(daily)'} — {s.duration || '?'}min</div>
                  ))}
                </div>
              )}
              {selected.priyomRef && <div className="pt-2"><a href={`https://priyom.org/number-stations/${selected.priyomRef}`} target="_blank" rel="noopener" className="text-forge-cyan hover:underline">Priyom.org →</a></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
