import React, { useState, useEffect, useRef } from 'react';
import type { SolarData, BandCondition } from '@signalforge/shared';

export const PropagationView: React.FC = () => {
  const [solar, setSolar] = useState<SolarData | null>(null);
  const [bands, setBands] = useState<BandCondition[]>([]);
  const [fromGrid, setFromGrid] = useState('IO91');
  const [toGrid, setToGrid] = useState('FN31');
  const [prediction, setPrediction] = useState<any>(null);
  const [greyline, setGreyline] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fetchData = async () => {
    try {
      const [sRes, bRes, gRes] = await Promise.all([
        fetch('/api/propagation/solar'),
        fetch('/api/propagation/bands'),
        fetch('/api/propagation/greyline'),
      ]);
      setSolar(await sRes.json());
      setBands(await bRes.json());
      setGreyline(await gRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 60000); return () => clearInterval(i); }, []);

  useEffect(() => {
    if (!greyline || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    // Draw world outline (simplified)
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#1a1a2a';
    ctx.lineWidth = 0.5;
    for (let lat = -90; lat <= 90; lat += 30) {
      const y = h / 2 - (lat / 180) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let lng = -180; lng <= 180; lng += 30) {
      const x = (lng + 180) / 360 * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Draw terminator
    if (greyline.terminatorPoints) {
      ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (const p of greyline.terminatorPoints) {
        const x = (p.lng + 180) / 360 * w;
        const y = h / 2 - (p.lat / 180) * h;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, 0);
      ctx.closePath();
      ctx.fill();

      // Terminator line
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < greyline.terminatorPoints.length; i++) {
        const p = greyline.terminatorPoints[i];
        const x = (p.lng + 180) / 360 * w;
        const y = h / 2 - (p.lat / 180) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Subsolar point
    if (greyline.subsolarLat !== undefined) {
      const sx = (greyline.subsolarLng + 180) / 360 * w;
      const sy = h / 2 - (greyline.subsolarLat / 180) * h;
      ctx.fillStyle = '#ffab00';
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffab00';
      ctx.font = '10px monospace';
      ctx.fillText('☀', sx - 5, sy - 10);
    }
  }, [greyline]);

  const predict = async () => {
    try {
      const res = await fetch(`/api/propagation/predict?from=${fromGrid}&to=${toGrid}`);
      setPrediction(await res.json());
    } catch { /* ignore */ }
  };

  const condColor = (c: string) => {
    switch (c) { case 'open': return 'bg-green-500/20 text-green-400'; case 'fair': return 'bg-yellow-500/20 text-yellow-400'; case 'poor': return 'bg-orange-500/20 text-orange-400'; default: return 'bg-red-500/20 text-red-400'; }
  };

  const geoField = (f: string) => {
    switch (f) { case 'quiet': return '🟢 Quiet'; case 'unsettled': return '🟡 Unsettled'; case 'active': return '🟠 Active'; case 'storm': return '🔴 Storm'; default: return '🔴 Major Storm'; }
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📡 PROPAGATION</h2>
      </div>

      <div className="grid grid-cols-3 gap-4 flex-1 overflow-hidden">
        {/* Left: Solar data + Band conditions */}
        <div className="space-y-4 overflow-y-auto">
          {/* Solar indices */}
          <div className="panel-border rounded p-3">
            <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-3">☀ SOLAR CONDITIONS</h3>
            {solar ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="text-2xl font-mono font-bold text-forge-amber">{solar.solarFlux}</div>
                  <div className="text-[10px] text-forge-text-dim">SFI</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-mono font-bold text-forge-cyan">{solar.sunspotNumber}</div>
                  <div className="text-[10px] text-forge-text-dim">SSN</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-mono font-bold text-forge-text">{solar.aIndex}</div>
                  <div className="text-[10px] text-forge-text-dim">A-Index</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-mono font-bold text-forge-text">{solar.kIndex}</div>
                  <div className="text-[10px] text-forge-text-dim">K-Index</div>
                </div>
                <div className="col-span-2 text-center text-xs font-mono mt-1">
                  {geoField(solar.geomagField)}
                </div>
                <div className="col-span-2 text-[9px] text-forge-text-dim text-center">
                  Source: {solar.source} • {new Date(solar.updatedAt).toLocaleTimeString()}
                </div>
              </div>
            ) : (
              <div className="text-center text-forge-text-dim text-xs py-4">Loading...</div>
            )}
          </div>

          {/* Band conditions */}
          <div className="panel-border rounded p-3">
            <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">BAND CONDITIONS</h3>
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-forge-text-dim mb-1">
                <span>Band</span><span className="text-center">Day</span><span className="text-center">Night</span>
              </div>
              {bands.map(b => (
                <div key={b.band} className="grid grid-cols-3 gap-1 text-xs font-mono">
                  <span className="text-forge-text">{b.band}</span>
                  <span className={`text-center rounded px-1 ${condColor(b.dayCondition)}`}>{b.dayCondition}</span>
                  <span className={`text-center rounded px-1 ${condColor(b.nightCondition)}`}>{b.nightCondition}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Greyline map */}
        <div className="panel-border rounded p-3 flex flex-col">
          <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-2">GREYLINE MAP</h3>
          <canvas ref={canvasRef} className="flex-1 rounded" style={{ minHeight: 200 }} />
          <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-forge-text-dim">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-forge-cyan inline-block" /> Terminator</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-forge-amber inline-block" /> Subsolar</span>
          </div>
        </div>

        {/* Right: Prediction tool */}
        <div className="space-y-4 overflow-y-auto">
          <div className="panel-border rounded p-3">
            <h3 className="text-xs font-mono text-forge-text-dim tracking-wider mb-3">MUF/LUF CALCULATOR</h3>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={fromGrid} onChange={e => setFromGrid(e.target.value)} placeholder="From grid"
                  className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
                <span className="text-forge-text-dim text-xs self-center">→</span>
                <input value={toGrid} onChange={e => setToGrid(e.target.value)} placeholder="To grid"
                  className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
              </div>
              <button onClick={predict} className="w-full px-3 py-1.5 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20">
                PREDICT
              </button>
            </div>

            {prediction && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-lg font-mono font-bold text-forge-green">{prediction.muf.toFixed(1)}</div>
                    <div className="text-[10px] text-forge-text-dim">MUF MHz</div>
                  </div>
                  <div>
                    <div className="text-lg font-mono font-bold text-forge-amber">{prediction.fot.toFixed(1)}</div>
                    <div className="text-[10px] text-forge-text-dim">FOT MHz</div>
                  </div>
                  <div>
                    <div className="text-lg font-mono font-bold text-forge-red">{prediction.luf.toFixed(1)}</div>
                    <div className="text-[10px] text-forge-text-dim">LUF MHz</div>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-forge-text-dim text-center">
                  Distance: {prediction.distance.toFixed(0)} km • Bearing: {prediction.bearing.toFixed(0)}°
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
