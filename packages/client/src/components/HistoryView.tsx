import React, { useState, useEffect } from 'react';
import type { SignalHistoryEntry, HistoryStats, HistoryConfig } from '@signalforge/shared';

export const HistoryView: React.FC = () => {
  const [entries, setEntries] = useState<SignalHistoryEntry[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [config, setConfig] = useState<HistoryConfig | null>(null);
  const [queryFreq, setQueryFreq] = useState('');
  const [queryDecoder, setQueryDecoder] = useState('');
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d' | '30d'>('24h');

  const timeRangeMs: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };

  const fetchData = async () => {
    const now = Date.now();
    const body: any = { startTime: now - timeRangeMs[timeRange], endTime: now, limit: 200 };
    if (queryFreq) body.frequencyHz = parseFloat(queryFreq) * 1000000;
    if (queryDecoder) body.decoderType = queryDecoder;
    try {
      const [entriesRes, statsRes, configRes] = await Promise.all([
        fetch('/api/history/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        fetch('/api/history/stats'),
        fetch('/api/history/config'),
      ]);
      setEntries(await entriesRes.json());
      setStats(await statsRes.json());
      setConfig(await configRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); }, [timeRange, queryFreq, queryDecoder]);

  const formatFreq = (hz: number) => hz >= 1e9 ? `${(hz / 1e9).toFixed(3)} GHz` : `${(hz / 1e6).toFixed(3)} MHz`;
  const formatTime = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">⏳ Signal History</span>
        {stats && (
          <span className="text-xs font-mono text-gray-500">{stats.totalEntries.toLocaleString()} entries • {stats.storageSizeMb} MB</span>
        )}
        <div className="flex-1" />
        {(['1h', '6h', '24h', '7d', '30d'] as const).map(r => (
          <button key={r} onClick={() => setTimeRange(r)}
            className={`px-2 py-0.5 rounded text-xs font-mono ${timeRange === r ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-500 border border-forge-border'}`}>
            {r}
          </button>
        ))}
      </div>

      <div className="flex gap-3 p-3 border-b border-forge-border">
        <input type="text" value={queryFreq} onChange={e => setQueryFreq(e.target.value)} placeholder="Frequency (MHz)..."
          className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono w-40" />
        <select value={queryDecoder} onChange={e => setQueryDecoder(e.target.value)}
          className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono">
          <option value="">All decoders</option>
          {['adsb', 'acars', 'ais', 'aprs', 'dmr', 'rtl433', 'apt', 'sstv', 'pocsag'].map(d => <option key={d} value={d}>{d.toUpperCase()}</option>)}
        </select>
        <button onClick={fetchData} className="px-3 py-1 rounded text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">🔍 Search</button>
      </div>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-6 gap-2 p-3 border-b border-forge-border">
          {Object.entries(stats.entriesByDecoder).slice(0, 6).map(([decoder, count]) => (
            <div key={decoder} className="bg-forge-surface border border-forge-border rounded p-2 text-center">
              <div className="text-xs text-gray-500 font-mono uppercase">{decoder}</div>
              <div className="text-sm text-cyan-400 font-mono font-bold">{count}</div>
            </div>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-forge-surface">
            <tr className="text-gray-500 border-b border-forge-border">
              <th className="text-left py-2 px-3">Time</th>
              <th className="text-left py-2 px-3">Frequency</th>
              <th className="text-left py-2 px-3">Mode</th>
              <th className="text-left py-2 px-3">Decoder</th>
              <th className="text-right py-2 px-3">Signal</th>
              <th className="text-left py-2 px-3">Data</th>
              <th className="text-left py-2 px-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id} className="border-b border-forge-border/30 hover:bg-forge-surface/50 text-gray-300">
                <td className="py-1.5 px-3 text-gray-500 whitespace-nowrap">{formatTime(entry.timestamp)}</td>
                <td className="py-1.5 px-3 text-cyan-400 whitespace-nowrap">{formatFreq(entry.frequencyHz)}</td>
                <td className="py-1.5 px-3">{entry.mode || '—'}</td>
                <td className="py-1.5 px-3">
                  {entry.decoderType && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 text-[10px]">
                      {entry.decoderType.toUpperCase()}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right">
                  <span className={entry.signalStrengthDbm > -60 ? 'text-green-400' : entry.signalStrengthDbm > -90 ? 'text-amber-400' : 'text-red-400'}>
                    {entry.signalStrengthDbm.toFixed(0)} dBm
                  </span>
                </td>
                <td className="py-1.5 px-3 text-gray-400 max-w-xs truncate">{entry.decodedData || '—'}</td>
                <td className="py-1.5 px-3 text-gray-500">{entry.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-500 font-mono text-sm">No history entries found for this query</div>
        )}
      </div>
    </div>
  );
};
