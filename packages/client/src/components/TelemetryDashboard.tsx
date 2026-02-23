import React, { useState, useEffect, useRef } from 'react';
import type { TelemetryFrame, TelemetryValue, TelemetryTimeSeries } from '@signalforge/shared';

export const TelemetryDashboard: React.FC = () => {
  const [frames, setFrames] = useState<TelemetryFrame[]>([]);
  const [latestValues, setLatestValues] = useState<TelemetryValue[]>([]);
  const [series, setSeries] = useState<Map<string, TelemetryTimeSeries>>(new Map());
  const [selectedSat, setSelectedSat] = useState(25544);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'telemetry_frame') {
          setFrames(prev => [msg.frame, ...prev].slice(0, 100));
          setLatestValues(msg.frame.parsed);
        }
      } catch { /* ignore */ }
    };

    // Initial load
    fetch(`/api/telemetry/latest/${selectedSat}`).then(r => r.json()).then(setLatestValues).catch(() => {});
    fetch(`/api/telemetry/frames?noradId=${selectedSat}&limit=20`).then(r => r.json()).then(setFrames).catch(() => {});

    return () => ws.close();
  }, [selectedSat]);

  // Load time series for each value
  useEffect(() => {
    if (latestValues.length === 0) return;
    const loadSeries = async () => {
      const newSeries = new Map<string, TelemetryTimeSeries>();
      for (const val of latestValues) {
        if (typeof val.value !== 'number') continue;
        try {
          const s = await fetch(`/api/telemetry/series/${selectedSat}/${val.key}`).then(r => r.json());
          newSeries.set(val.key, s);
        } catch { /* ignore */ }
      }
      setSeries(newSeries);
    };
    loadSeries();
    const interval = setInterval(loadSeries, 10000);
    return () => clearInterval(interval);
  }, [latestValues, selectedSat]);

  // Draw mini charts
  useEffect(() => {
    for (const [key, s] of series) {
      const canvas = canvasRefs.current.get(key);
      if (!canvas || !s.points.length) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const w = canvas.width = canvas.offsetWidth * 2;
      const h = canvas.height = 60;
      ctx.clearRect(0, 0, w, h);

      const values = s.points.map(p => p.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;

      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = (i / (s.points.length - 1)) * w;
        const y = h - ((p.value - min) / range) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill area
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.1)';
      ctx.fill();
    }
  }, [series]);

  const getValueColor = (val: TelemetryValue): string => {
    if (typeof val.value !== 'number') return '#e0e0e8';
    if (val.critical) {
      if (val.critical.low !== undefined && val.value <= val.critical.low) return '#ff1744';
      if (val.critical.high !== undefined && val.value >= val.critical.high) return '#ff1744';
    }
    if (val.warning) {
      if (val.warning.low !== undefined && val.value <= val.warning.low) return '#ffab00';
      if (val.warning.high !== undefined && val.value >= val.warning.high) return '#ffab00';
    }
    return '#00e676';
  };

  const categories = ['power', 'thermal', 'comms', 'attitude', 'system', 'payload', 'custom'];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-forge-border">
        <h2 className="text-sm font-display font-bold text-forge-cyan tracking-wider">🛰️ TELEMETRY</h2>
        <span className="text-[10px] font-mono text-forge-text-dim">ISS (ZARYA) · NORAD {selectedSat}</span>
        <span className="text-[10px] font-mono text-forge-green ml-2">{frames.length > 0 ? '● LIVE' : '○ WAITING'}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-5xl mx-auto">
          {/* Value cards grouped by category */}
          {categories.map(cat => {
            const vals = latestValues.filter(v => v.category === cat);
            if (vals.length === 0) return null;
            return (
              <div key={cat} className="mb-6">
                <h3 className="text-[10px] font-mono text-forge-text-dim tracking-wider uppercase mb-2">{cat}</h3>
                <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                  {vals.map(val => (
                    <div key={val.key} className="panel-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-forge-text-dim">{val.name}</span>
                        <span className="text-lg font-mono font-bold" style={{ color: getValueColor(val) }}>
                          {typeof val.value === 'number' ? val.value.toFixed(val.unit === '°C' || val.unit === 'V' ? 1 : val.unit === 'A' ? 3 : 0) : val.value}
                          <span className="text-[10px] text-forge-text-dim ml-1">{val.unit}</span>
                        </span>
                      </div>

                      {/* Mini chart */}
                      {typeof val.value === 'number' && (
                        <canvas
                          ref={el => { if (el) canvasRefs.current.set(val.key, el); }}
                          className="w-full"
                          style={{ height: 30 }}
                        />
                      )}

                      {/* Range bar */}
                      {val.min !== undefined && val.max !== undefined && typeof val.value === 'number' && (
                        <div className="mt-1.5 h-1.5 rounded-full bg-forge-bg relative overflow-hidden">
                          <div
                            className="absolute top-0 left-0 h-full rounded-full transition-all"
                            style={{
                              width: `${Math.max(0, Math.min(100, ((val.value - val.min) / (val.max - val.min)) * 100))}%`,
                              backgroundColor: getValueColor(val),
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Raw frames */}
          <div className="mt-6">
            <h3 className="text-[10px] font-mono text-forge-text-dim tracking-wider mb-2">RAW FRAMES</h3>
            <div className="space-y-1">
              {frames.slice(0, 20).map(f => (
                <div key={f.id} className="flex items-center gap-3 px-2 py-1 rounded bg-forge-bg/50 text-[10px] font-mono">
                  <span className="text-forge-text-dim">{new Date(f.timestamp).toLocaleTimeString()}</span>
                  <span className="text-forge-cyan">{f.protocol.toUpperCase()}</span>
                  <span className="text-forge-text font-mono tracking-wider">{f.rawHex.slice(0, 40)}...</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
