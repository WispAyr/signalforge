import React, { useState, useEffect } from 'react';

interface Observation {
  id: number;
  start: string;
  end: string;
  satellite_name: string;
  norad_cat_id: number;
  status: string;
  station_name: string;
  station_lat: number;
  station_lng: number;
}

interface Transmitter {
  uuid: string;
  description: string;
  alive: boolean;
  downlink_low?: number;
  downlink_high?: number;
  mode?: string;
  baud?: number;
  status: string;
}

export const SatNOGSView: React.FC = () => {
  const [tab, setTab] = useState<'observations' | 'transmitters' | 'stations'>('observations');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [transmitters, setTransmitters] = useState<Transmitter[]>([]);
  const [searchNorad, setSearchNorad] = useState('25544');
  const [loading, setLoading] = useState(false);

  const fetchObservations = async (noradId?: string) => {
    setLoading(true);
    try {
      const q = noradId ? `?satellite=${noradId}` : '';
      const res = await fetch(`/api/satnogs/observations${q}`);
      setObservations(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchTransmitters = async (noradId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/satnogs/transmitters/${noradId}`);
      setTransmitters(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  const autoConfigure = async (noradId: string) => {
    try {
      const res = await fetch(`/api/satnogs/auto-configure/${noradId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ satelliteName: `SAT-${noradId}` }),
      });
      const config = await res.json();
      alert(`Auto-configured: ${config.mode} @ ${(config.frequency / 1e6).toFixed(3)} MHz, BW: ${config.bandwidth} Hz`);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchObservations();
  }, []);

  const statusColor = (s: string) => {
    switch (s) {
      case 'good': return 'text-green-400';
      case 'bad': case 'failed': return 'text-red-400';
      case 'future': return 'text-forge-cyan';
      default: return 'text-forge-text-dim';
    }
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🛰️ SATNOGS NETWORK</h2>
        <div className="flex gap-1 ml-4">
          {(['observations', 'transmitters', 'stations'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input value={searchNorad} onChange={e => setSearchNorad(e.target.value)}
            placeholder="NORAD ID" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono w-24 text-forge-text" />
          <button onClick={() => { fetchObservations(searchNorad); fetchTransmitters(searchNorad); }}
            className="px-3 py-1 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20">SEARCH</button>
          <button onClick={() => autoConfigure(searchNorad)}
            className="px-3 py-1 text-xs font-mono bg-forge-amber/10 text-forge-amber rounded hover:bg-forge-amber/20">AUTO-CONFIG</button>
        </div>
      </div>

      {loading && <div className="text-center text-forge-text-dim text-xs font-mono py-8">Loading from SatNOGS...</div>}

      {tab === 'observations' && !loading && (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-forge-text-dim sticky top-0 bg-forge-surface">
              <tr>
                <th className="text-left px-2 py-1">ID</th>
                <th className="text-left px-2 py-1">Satellite</th>
                <th className="text-left px-2 py-1">Station</th>
                <th className="text-left px-2 py-1">Start</th>
                <th className="text-left px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {observations.map(obs => (
                <tr key={obs.id} className="border-t border-forge-border/30 hover:bg-forge-panel/30">
                  <td className="px-2 py-1.5 text-forge-text-dim">{obs.id}</td>
                  <td className="px-2 py-1.5 text-forge-text">{obs.satellite_name || `NORAD ${obs.norad_cat_id}`}</td>
                  <td className="px-2 py-1.5 text-forge-text-dim">{obs.station_name}</td>
                  <td className="px-2 py-1.5 text-forge-text-dim">{new Date(obs.start).toLocaleString()}</td>
                  <td className={`px-2 py-1.5 ${statusColor(obs.status)}`}>{obs.status?.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {observations.length === 0 && <p className="text-center text-forge-text-dim text-xs py-8">No observations found</p>}
        </div>
      )}

      {tab === 'transmitters' && !loading && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-2">
            {transmitters.map(tx => (
              <div key={tx.uuid} className={`panel-border rounded p-3 ${tx.alive ? 'border-green-500/30' : 'border-forge-border'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-forge-text">{tx.description}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${tx.alive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {tx.alive ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 text-[10px] text-forge-text-dim font-mono">
                  {tx.downlink_low && <span>↓ {(tx.downlink_low / 1e6).toFixed(3)} MHz</span>}
                  {tx.downlink_high && tx.downlink_high !== tx.downlink_low && <span>— {(tx.downlink_high / 1e6).toFixed(3)} MHz</span>}
                  {tx.mode && <span>Mode: {tx.mode}</span>}
                  {tx.baud && <span>Baud: {tx.baud}</span>}
                </div>
              </div>
            ))}
            {transmitters.length === 0 && <p className="text-center text-forge-text-dim text-xs py-8">Enter a NORAD ID and click SEARCH</p>}
          </div>
        </div>
      )}

      {tab === 'stations' && <div className="text-center text-forge-text-dim text-xs py-8 font-mono">Click SEARCH to load SatNOGS ground stations</div>}
    </div>
  );
};
