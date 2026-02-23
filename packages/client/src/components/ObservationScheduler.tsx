import React, { useState, useEffect, useCallback } from 'react';

interface Observation {
  id: string;
  name: string;
  satelliteName?: string;
  frequency: number;
  mode: string;
  minElevation: number;
  status: 'scheduled' | 'active' | 'completed' | 'missed' | 'cancelled';
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  autoRecord: boolean;
  autoDoppler: boolean;
  autoRotator: boolean;
  notes?: string;
}

const API = '';

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'text-forge-cyan',
  active: 'text-forge-green animate-pulse',
  completed: 'text-forge-text-dim',
  missed: 'text-forge-red',
  cancelled: 'text-forge-text-dim line-through',
};

const STATUS_ICONS: Record<string, string> = {
  scheduled: '⏳',
  active: '📡',
  completed: '✅',
  missed: '❌',
  cancelled: '🚫',
};

export const ObservationScheduler: React.FC = () => {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  // Form state
  const [satName, setSatName] = useState('ISS (ZARYA)');
  const [satId, setSatId] = useState('25544');
  const [frequency, setFrequency] = useState('145.8');
  const [mode, setMode] = useState('FM');
  const [minEl, setMinEl] = useState('30');
  const [autoRecord, setAutoRecord] = useState(true);
  const [autoDoppler, setAutoDoppler] = useState(true);
  const [autoRotator, setAutoRotator] = useState(false);
  const [maxObs, setMaxObs] = useState('3');

  const fetchObservations = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/observations`);
      setObservations(await res.json());
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchObservations();
    const iv = setInterval(fetchObservations, 10000);
    return () => clearInterval(iv);
  }, [fetchObservations]);

  // WS updates
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'observation_update') {
          setObservations(prev => prev.map(o => o.id === msg.observation.id ? msg.observation : o));
        }
      } catch { /* */ }
    };
    return () => ws.close();
  }, []);

  const scheduleObservation = async () => {
    try {
      await fetch(`${API}/api/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          satelliteCatalogNumber: parseInt(satId),
          satelliteName: satName,
          frequency: parseFloat(frequency) * 1e6,
          mode,
          minElevation: parseInt(minEl),
          autoRecord,
          autoDoppler,
          autoRotator,
          maxObservations: parseInt(maxObs),
        }),
      });
      setShowNew(false);
      fetchObservations();
    } catch { /* */ }
  };

  const cancelObs = async (id: string) => {
    await fetch(`${API}/api/observations/${id}/cancel`, { method: 'POST' });
    fetchObservations();
  };

  const deleteObs = async (id: string) => {
    await fetch(`${API}/api/observations/${id}`, { method: 'DELETE' });
    fetchObservations();
  };

  const filtered = filter === 'all' ? observations : observations.filter(o => o.status === filter);

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-forge-border bg-forge-surface/50">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-forge-cyan tracking-wider">📅 OBSERVATION SCHEDULER</span>
          <div className="flex gap-1">
            {['all', 'scheduled', 'active', 'completed', 'missed'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2 py-0.5 text-[9px] font-mono rounded border transition-all ${
                  filter === f ? 'text-forge-cyan border-forge-cyan/30 bg-forge-cyan/10' : 'text-forge-text-dim border-forge-border/30'
                }`}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setShowNew(!showNew)}
          className="px-3 py-1 text-[10px] font-mono text-forge-cyan border border-forge-cyan/30 bg-forge-cyan/10 rounded hover:bg-forge-cyan/20 transition-all">
          + SCHEDULE
        </button>
      </div>

      {/* New observation form */}
      {showNew && (
        <div className="p-4 border-b border-forge-border bg-forge-surface/30">
          <h3 className="text-xs font-mono text-forge-cyan mb-3">Schedule New Observation</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Satellite Name</label>
              <input value={satName} onChange={e => setSatName(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim block mb-1">NORAD ID</label>
              <input value={satId} onChange={e => setSatId(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Frequency (MHz)</label>
              <input value={frequency} onChange={e => setFrequency(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none">
                <option>FM</option><option>AM</option><option>USB</option><option>LSB</option><option>RAW</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Min Elevation (°)</label>
              <input value={minEl} onChange={e => setMinEl(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Max Observations</label>
              <input value={maxObs} onChange={e => setMaxObs(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={autoRecord} onChange={e => setAutoRecord(e.target.checked)} className="accent-forge-cyan" />
                <span className="text-[10px] font-mono text-forge-text-dim">Record</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={autoDoppler} onChange={e => setAutoDoppler(e.target.checked)} className="accent-forge-cyan" />
                <span className="text-[10px] font-mono text-forge-text-dim">Doppler</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={autoRotator} onChange={e => setAutoRotator(e.target.checked)} className="accent-forge-cyan" />
                <span className="text-[10px] font-mono text-forge-text-dim">Rotator</span>
              </label>
            </div>
            <div className="flex items-end">
              <button onClick={scheduleObservation}
                className="px-4 py-1.5 bg-forge-cyan/20 text-forge-cyan border border-forge-cyan/30 rounded text-xs font-mono hover:bg-forge-cyan/30 transition-all">
                SCHEDULE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Observations list */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-2xl mb-2">📅</div>
            <div className="text-xs font-mono text-forge-text-dim">No observations {filter !== 'all' ? `with status "${filter}"` : 'scheduled'}</div>
            <div className="text-[10px] font-mono text-forge-text-dim mt-1">Click SCHEDULE to set up an automated observation</div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(obs => (
              <div key={obs.id} className="panel-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span>{STATUS_ICONS[obs.status]}</span>
                    <span className="text-xs font-mono text-forge-text">{obs.name}</span>
                    <span className={`text-[10px] font-mono ${STATUS_COLORS[obs.status]}`}>
                      {obs.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {obs.status === 'scheduled' && (
                      <button onClick={() => cancelObs(obs.id)}
                        className="text-[10px] font-mono text-forge-amber hover:text-amber-400 transition-colors">Cancel</button>
                    )}
                    {(obs.status === 'completed' || obs.status === 'missed' || obs.status === 'cancelled') && (
                      <button onClick={() => deleteObs(obs.id)}
                        className="text-[10px] font-mono text-forge-red hover:text-red-400 transition-colors">Delete</button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2 text-[10px] font-mono">
                  <div>
                    <span className="text-forge-text-dim">Satellite: </span>
                    <span className="text-forge-text">{obs.satelliteName}</span>
                  </div>
                  <div>
                    <span className="text-forge-text-dim">Freq: </span>
                    <span className="text-forge-cyan">{(obs.frequency / 1e6).toFixed(3)} MHz</span>
                  </div>
                  <div>
                    <span className="text-forge-text-dim">Mode: </span>
                    <span className="text-forge-text">{obs.mode}</span>
                  </div>
                  <div>
                    <span className="text-forge-text-dim">AOS: </span>
                    <span className="text-forge-text">{obs.scheduledStart ? new Date(obs.scheduledStart).toLocaleString() : '-'}</span>
                  </div>
                  <div>
                    <span className="text-forge-text-dim">LOS: </span>
                    <span className="text-forge-text">{obs.scheduledEnd ? new Date(obs.scheduledEnd).toLocaleString() : '-'}</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-1 text-[9px] font-mono text-forge-text-dim">
                  {obs.autoRecord && <span className="text-forge-green">⏺ REC</span>}
                  {obs.autoDoppler && <span className="text-forge-cyan">🔄 DOPPLER</span>}
                  {obs.autoRotator && <span className="text-forge-amber">🎯 ROTATOR</span>}
                  <span>Min El: {obs.minElevation}°</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
