import React, { useState, useEffect } from 'react';
import type { TSCMSweepResult, TSCMAnomaly, TSCMBaseline, ThreatLevel } from '@signalforge/shared';

const THREAT_COLORS: Record<ThreatLevel, string> = { clear: 'text-green-400', low: 'text-yellow-400', medium: 'text-orange-400', high: 'text-red-400', critical: 'text-red-500' };
const THREAT_BG: Record<ThreatLevel, string> = { clear: 'bg-green-500/10', low: 'bg-yellow-500/10', medium: 'bg-orange-500/10', high: 'bg-red-500/10', critical: 'bg-red-500/20' };

export const TSCMView: React.FC = () => {
  const [sweeps, setSweeps] = useState<TSCMSweepResult[]>([]);
  const [baselines, setBaselines] = useState<TSCMBaseline[]>([]);
  const [anomalies, setAnomalies] = useState<TSCMAnomaly[]>([]);

  const fetchData = async () => {
    try {
      const [swRes, blRes, anRes] = await Promise.all([fetch('/api/tscm/sweeps?limit=20'), fetch('/api/tscm/baselines'), fetch('/api/tscm/anomalies?limit=50')]);
      setSweeps(await swRes.json());
      setBaselines(await blRes.json());
      setAnomalies(await anRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, []);

  const runSweep = async () => {
    await fetch('/api/tscm/sweep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Manual Sweep' }) });
    fetchData();
  };

  const recordBaseline = async () => {
    await fetch('/api/tscm/baseline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Baseline ${new Date().toLocaleString()}`, location: 'Current Location' }) });
    fetchData();
  };

  const latestSweep = sweeps[0];

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🛡️ TSCM — Counter-Surveillance</h2>
        <div className="flex gap-2 ml-auto">
          <button onClick={recordBaseline} className="px-3 py-1.5 text-xs font-mono bg-forge-panel border border-forge-border rounded hover:border-forge-cyan/30">📊 Record Baseline</button>
          <button onClick={runSweep} className="px-3 py-1.5 text-xs font-mono bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30 rounded hover:bg-forge-cyan/25">🔍 Run Sweep</button>
        </div>
      </div>

      {latestSweep && (
        <div className={`rounded-lg border p-4 mb-4 ${THREAT_BG[latestSweep.overallThreat]} border-forge-border`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`text-3xl font-bold ${THREAT_COLORS[latestSweep.overallThreat]}`}>
              {latestSweep.overallThreat === 'clear' ? '✅' : latestSweep.overallThreat === 'low' ? '⚠️' : '🚨'} {latestSweep.overallThreat.toUpperCase()}
            </div>
            <div className="text-xs font-mono text-forge-text-dim">
              <div>{latestSweep.location} — {new Date(latestSweep.timestamp).toLocaleString()}</div>
              <div>{latestSweep.bandsSwept.length} bands swept — {latestSweep.anomalies.length} anomalies — {latestSweep.duration.toFixed(0)}s</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {latestSweep.bandsSwept.map(band => (
              <div key={band.name} className={`rounded p-2 text-center ${THREAT_BG[band.status]}`}>
                <div className="text-[10px] font-mono text-forge-text-dim">{band.name}</div>
                <div className={`text-xs font-bold ${THREAT_COLORS[band.status]}`}>{band.status.toUpperCase()}</div>
                {band.anomalyCount > 0 && <div className="text-[10px] text-forge-text-dim">{band.anomalyCount} anomalies</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <h3 className="text-sm font-mono text-forge-text-dim mb-2">ANOMALIES</h3>
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
            <tr><th className="text-left p-2">Time</th><th className="text-left p-2">Frequency</th><th className="text-left p-2">Power</th><th className="text-left p-2">Deviation</th><th className="text-left p-2">Threat</th><th className="text-left p-2">Description</th></tr>
          </thead>
          <tbody>
            {anomalies.map(a => (
              <tr key={a.id} className={`border-t border-forge-border/30 hover:bg-forge-panel/50 ${THREAT_BG[a.threatLevel]}`}>
                <td className="p-2 text-forge-text-dim">{new Date(a.timestamp).toLocaleTimeString()}</td>
                <td className="p-2 text-forge-cyan">{(a.frequency / 1e6).toFixed(3)} MHz</td>
                <td className="p-2 text-forge-amber">{a.power.toFixed(0)} dBm</td>
                <td className="p-2">+{a.deviation.toFixed(1)} dB</td>
                <td className={`p-2 font-bold ${THREAT_COLORS[a.threatLevel]}`}>{a.threatLevel.toUpperCase()}</td>
                <td className="p-2 text-forge-text max-w-md truncate">{a.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {anomalies.length === 0 && <div className="text-center py-10 text-green-400 text-sm">✅ No anomalies detected</div>}
      </div>
    </div>
  );
};
