import React, { useState, useEffect, useRef } from 'react';
import type { DecoderStats, FrequencyActivity, ObservationStats, SignalHeatmap } from '@signalforge/shared';

export const AnalyticsView: React.FC = () => {
  const [heatmap, setHeatmap] = useState<SignalHeatmap | null>(null);
  const [frequencies, setFrequencies] = useState<FrequencyActivity[]>([]);
  const [decoders, setDecoders] = useState<DecoderStats[]>([]);
  const [observations, setObservations] = useState<ObservationStats | null>(null);
  const heatmapRef = useRef<HTMLCanvasElement>(null);

  const fetchData = async () => {
    try {
      const [hRes, fRes, dRes, oRes] = await Promise.all([
        fetch('/api/analytics/heatmap?hours=24'),
        fetch('/api/analytics/frequencies?limit=15'),
        fetch('/api/analytics/decoders'),
        fetch('/api/analytics/observations'),
      ]);
      setHeatmap(await hRes.json());
      setFrequencies(await fRes.json());
      setDecoders(await dRes.json());
      setObservations(await oRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 30000); return () => clearInterval(i); }, []);

  // Draw heatmap
  useEffect(() => {
    if (!heatmap || !heatmapRef.current) return;
    const canvas = heatmapRef.current;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    if (heatmap.cells.length === 0) return;

    const maxIntensity = Math.max(...heatmap.cells.map(c => c.intensity), 1);

    for (const cell of heatmap.cells) {
      const x = ((cell.frequency - heatmap.freqMin) / (heatmap.freqMax - heatmap.freqMin || 1)) * w;
      const y = h - ((cell.time - heatmap.timeMin) / (heatmap.timeMax - heatmap.timeMin || 1)) * h;
      const intensity = cell.intensity / maxIntensity;

      const r = Math.floor(intensity * 255);
      const g = Math.floor(intensity * 100);
      const b = Math.floor((1 - intensity) * 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;

      const cellW = Math.max(3, w / 50);
      const cellH = Math.max(3, h / 48);
      ctx.fillRect(x - cellW / 2, y - cellH / 2, cellW, cellH);
    }

    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.fillText(`${(heatmap.freqMin / 1e6).toFixed(1)} MHz`, 2, h - 2);
    ctx.fillText(`${(heatmap.freqMax / 1e6).toFixed(1)} MHz`, w - 60, h - 2);
  }, [heatmap]);

  const maxFreqCount = Math.max(...frequencies.map(f => f.count), 1);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📊 ANALYTICS</h2>
        <button onClick={fetchData} className="ml-auto px-3 py-1 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20">REFRESH</button>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">
        {/* Heatmap */}
        <div className="panel-border rounded p-3 flex flex-col">
          <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">SIGNAL ACTIVITY HEATMAP (24h)</h3>
          <canvas ref={heatmapRef} className="flex-1 rounded" style={{ minHeight: 150 }} />
          <div className="flex justify-between text-[9px] font-mono text-forge-text-dim mt-1">
            <span>Frequency →</span><span>← Time</span>
          </div>
        </div>

        {/* Busiest frequencies */}
        <div className="panel-border rounded p-3 overflow-y-auto">
          <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">BUSIEST FREQUENCIES</h3>
          <div className="space-y-1.5">
            {frequencies.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-forge-text-dim w-16 truncate">{f.label}</span>
                <div className="flex-1 h-3 bg-forge-bg rounded overflow-hidden">
                  <div className="h-full rounded" style={{
                    width: `${(f.count / maxFreqCount) * 100}%`,
                    background: `linear-gradient(90deg, #00e5ff, #ffab00)`,
                  }} />
                </div>
                <span className="text-[10px] font-mono text-forge-cyan w-10 text-right">{f.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Decoder stats */}
        <div className="panel-border rounded p-3">
          <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">DECODER STATISTICS</h3>
          <div className="grid grid-cols-2 gap-3">
            {decoders.map(d => (
              <div key={d.decoder} className="bg-forge-bg/50 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-forge-text font-bold">{d.decoder}</span>
                  <span className="text-[10px] font-mono text-forge-cyan">{d.messagesTotal}</span>
                </div>
                <div className="text-[10px] font-mono text-forge-text-dim space-y-0.5">
                  <div className="flex justify-between"><span>Per hour:</span><span>{d.messagesPerHour}</span></div>
                  <div className="flex justify-between"><span>Per day:</span><span>{d.messagesPerDay}</span></div>
                  <div className="flex justify-between"><span>Error rate:</span><span>{(d.errorRate * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span>Last:</span><span>{d.lastMessage ? new Date(d.lastMessage).toLocaleTimeString() : '—'}</span></div>
                </div>
                {/* Mini sparkline */}
                <div className="flex items-end gap-px mt-1 h-6">
                  {d.history.slice(-24).map((h, i) => {
                    const max = Math.max(...d.history.map(x => x.count), 1);
                    return <div key={i} className="flex-1 bg-forge-cyan/40 rounded-t" style={{ height: `${(h.count / max) * 100}%`, minHeight: 1 }} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Observation stats */}
        <div className="panel-border rounded p-3">
          <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">OBSERVATION SUCCESS RATE</h3>
          {observations && (
            <>
              <div className="flex items-center gap-4 mb-3">
                <div className="relative w-20 h-20">
                  <svg viewBox="0 0 36 36" className="w-20 h-20">
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#1a1a2a" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#00e676" strokeWidth="3"
                      strokeDasharray={`${observations.successRate * 100} ${100 - observations.successRate * 100}`}
                      strokeDashoffset="25" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-mono font-bold text-forge-green">{(observations.successRate * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="space-y-1 text-xs font-mono">
                  <div className="flex justify-between gap-4"><span className="text-forge-text-dim">Total:</span><span className="text-forge-text">{observations.total}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-forge-text-dim">Success:</span><span className="text-green-400">{observations.successful}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-forge-text-dim">Failed:</span><span className="text-red-400">{observations.failed}</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-mono text-forge-text-dim mb-1">BY SATELLITE</div>
                {Object.entries(observations.bySatellite).map(([sat, data]) => (
                  <div key={sat} className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-forge-text">{sat}</span>
                    <span className="text-forge-text-dim">{data.successful}/{data.total}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
