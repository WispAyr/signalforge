import React, { useState, useEffect } from 'react';
import type { LogEntry, LogbookStats } from '@signalforge/shared';

export const LogbookView: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogbookStats | null>(null);
  const [tab, setTab] = useState<'log' | 'add' | 'stats'>('log');
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');

  const [newEntry, setNewEntry] = useState({
    callsign: '', frequency: 14200000, band: '20m', mode: 'SSB', rstSent: '59', rstReceived: '59',
    name: '', qth: '', gridSquare: '', power: 100, notes: '', qslSent: 'N' as const, qslReceived: 'N' as const, tags: [] as string[],
  });

  const fetchData = async () => {
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (bandFilter) q.set('band', bandFilter);
      if (modeFilter) q.set('mode', modeFilter);
      const [eRes, sRes] = await Promise.all([
        fetch(`/api/logbook?${q}`),
        fetch('/api/logbook/stats'),
      ]);
      setEntries(await eRes.json());
      setStats(await sRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); }, [search, bandFilter, modeFilter]);

  const addEntry = async () => {
    if (!newEntry.callsign) return;
    await fetch('/api/logbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newEntry, dateTimeOn: Date.now() }),
    });
    setNewEntry({ ...newEntry, callsign: '', name: '', qth: '', gridSquare: '', notes: '' });
    setTab('log');
    fetchData();
  };

  const deleteEntry = async (id: string) => {
    await fetch(`/api/logbook/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const exportADIF = () => {
    window.open('/api/logbook/export/adif', '_blank');
  };

  const bands = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];
  const modes = ['SSB', 'CW', 'FT8', 'FT4', 'FM', 'AM', 'RTTY', 'PSK31', 'SSTV', 'JT65'];

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📓 LOGBOOK</h2>
        <div className="flex gap-1 ml-4">
          {(['log', 'add', 'stats'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {t === 'add' ? '+ NEW' : t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={exportADIF} className="px-3 py-1 text-xs font-mono bg-forge-amber/10 text-forge-amber rounded hover:bg-forge-amber/20">EXPORT ADIF</button>
        </div>
      </div>

      {tab === 'add' && (
        <div className="panel-border rounded p-4 mb-4">
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input value={newEntry.callsign} onChange={e => setNewEntry({ ...newEntry, callsign: e.target.value.toUpperCase() })}
              placeholder="Callsign *" className="bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text uppercase" />
            <select value={newEntry.band} onChange={e => setNewEntry({ ...newEntry, band: e.target.value })}
              className="bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text">
              {bands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={newEntry.mode} onChange={e => setNewEntry({ ...newEntry, mode: e.target.value })}
              className="bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text">
              {modes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={newEntry.frequency / 1e6} type="number" step="0.001"
              onChange={e => setNewEntry({ ...newEntry, frequency: parseFloat(e.target.value) * 1e6 })}
              placeholder="MHz" className="bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text" />
          </div>
          <div className="grid grid-cols-6 gap-3 mb-3">
            <input value={newEntry.rstSent} onChange={e => setNewEntry({ ...newEntry, rstSent: e.target.value })}
              placeholder="RST Sent" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newEntry.rstReceived} onChange={e => setNewEntry({ ...newEntry, rstReceived: e.target.value })}
              placeholder="RST Rcvd" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newEntry.name} onChange={e => setNewEntry({ ...newEntry, name: e.target.value })}
              placeholder="Name" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newEntry.qth} onChange={e => setNewEntry({ ...newEntry, qth: e.target.value })}
              placeholder="QTH" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newEntry.gridSquare} onChange={e => setNewEntry({ ...newEntry, gridSquare: e.target.value.toUpperCase() })}
              placeholder="Grid" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newEntry.power} type="number" onChange={e => setNewEntry({ ...newEntry, power: parseInt(e.target.value) })}
              placeholder="Power W" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
          </div>
          <div className="flex gap-3">
            <input value={newEntry.notes} onChange={e => setNewEntry({ ...newEntry, notes: e.target.value })}
              placeholder="Notes" className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <button onClick={addEntry} className="px-4 py-1 text-xs font-mono bg-forge-green/20 text-forge-green rounded hover:bg-forge-green/30">LOG QSO</button>
          </div>
        </div>
      )}

      {tab === 'log' && (
        <>
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search callsign, name..."
              className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <select value={bandFilter} onChange={e => setBandFilter(e.target.value)}
              className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text">
              <option value="">All bands</option>
              {bands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
              className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text">
              <option value="">All modes</option>
              {modes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-forge-text-dim sticky top-0 bg-forge-surface">
                <tr>
                  <th className="text-left px-2 py-1">Date/Time</th>
                  <th className="text-left px-2 py-1">Callsign</th>
                  <th className="text-left px-2 py-1">Band</th>
                  <th className="text-left px-2 py-1">Mode</th>
                  <th className="text-left px-2 py-1">Freq</th>
                  <th className="text-left px-2 py-1">RST S/R</th>
                  <th className="text-left px-2 py-1">Name</th>
                  <th className="text-left px-2 py-1">QSL</th>
                  <th className="text-left px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-t border-forge-border/30 hover:bg-forge-panel/30">
                    <td className="px-2 py-1 text-forge-text-dim">{new Date(e.dateTimeOn).toLocaleString()}</td>
                    <td className="px-2 py-1 text-forge-cyan font-bold">{e.callsign}</td>
                    <td className="px-2 py-1 text-forge-text">{e.band}</td>
                    <td className="px-2 py-1 text-forge-amber">{e.mode}</td>
                    <td className="px-2 py-1 text-forge-text-dim">{(e.frequency / 1e6).toFixed(3)}</td>
                    <td className="px-2 py-1 text-forge-text-dim">{e.rstSent}/{e.rstReceived}</td>
                    <td className="px-2 py-1 text-forge-text-dim">{e.name || '—'}</td>
                    <td className="px-2 py-1">
                      <span className={`${e.qslReceived === 'Y' ? 'text-green-400' : 'text-forge-text-dim'}`}>
                        {e.qslReceived === 'Y' ? '✓' : '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <button onClick={() => deleteEntry(e.id)} className="text-forge-text-dim hover:text-red-400">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && <p className="text-center text-forge-text-dim text-xs py-8">No log entries. Click + NEW to add a QSO.</p>}
          </div>
        </>
      )}

      {tab === 'stats' && stats && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="panel-border rounded p-4 text-center">
              <div className="text-3xl font-mono font-bold text-forge-cyan">{stats.totalContacts}</div>
              <div className="text-xs text-forge-text-dim">Total QSOs</div>
            </div>
            <div className="panel-border rounded p-4 text-center">
              <div className="text-3xl font-mono font-bold text-forge-amber">{stats.uniqueCallsigns}</div>
              <div className="text-xs text-forge-text-dim">Unique Callsigns</div>
            </div>
            <div className="panel-border rounded p-4 text-center">
              <div className="text-3xl font-mono font-bold text-forge-green">{Object.keys(stats.bandBreakdown).length}</div>
              <div className="text-xs text-forge-text-dim">Bands Worked</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="panel-border rounded p-3">
              <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">BY BAND</h3>
              {Object.entries(stats.bandBreakdown).sort(([, a], [, b]) => b - a).map(([band, count]) => (
                <div key={band} className="flex justify-between text-xs font-mono py-0.5">
                  <span className="text-forge-text">{band}</span>
                  <span className="text-forge-cyan">{count}</span>
                </div>
              ))}
            </div>
            <div className="panel-border rounded p-3">
              <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">BY MODE</h3>
              {Object.entries(stats.modeBreakdown).sort(([, a], [, b]) => b - a).map(([mode, count]) => (
                <div key={mode} className="flex justify-between text-xs font-mono py-0.5">
                  <span className="text-forge-text">{mode}</span>
                  <span className="text-forge-amber">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
