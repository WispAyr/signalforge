import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PopOutButton } from './ui/PopOutButton';

interface SweepResult {
  frequencies: number[];
  powers: number[];
  maxHold: number[];
  timestamp: number;
  sweepCount: number;
}

interface DetectedSignal {
  frequency: number;
  power: number;
  bandwidth: number;
  classification?: string;
  timestamp: number;
}

const API = '';

const PRESETS = [
  { label: 'FM Broadcast', start: 87.5, end: 108, step: 0.1 },
  { label: 'Air Band', start: 118, end: 137, step: 0.025 },
  { label: 'VHF Marine', start: 156, end: 162, step: 0.025 },
  { label: '2m Amateur', start: 144, end: 148, step: 0.0125 },
  { label: '70cm Amateur', start: 430, end: 440, step: 0.025 },
  { label: 'PMR446', start: 445, end: 447, step: 0.00625 },
  { label: 'Wide (50-500)', start: 50, end: 500, step: 0.5 },
  { label: 'Full (24-1700)', start: 24, end: 1700, step: 2 },
];

export const SpectrumAnalyzer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sweeping, setSweeping] = useState(false);
  const [startFreq, setStartFreq] = useState('87.5');
  const [endFreq, setEndFreq] = useState('108');
  const [stepSize, setStepSize] = useState('0.1');
  const [rbw, setRbw] = useState('10');
  const [sweepData, setSweepData] = useState<SweepResult | null>(null);
  const [signals, setSignals] = useState<DetectedSignal[]>([]);
  const [showMaxHold, setShowMaxHold] = useState(true);
  const [cursor, setCursor] = useState<{ freq: number; power: number } | null>(null);

  // Listen for sweep results via WebSocket
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'spectrum_sweep') setSweepData(msg.result);
        if (msg.type === 'detected_signals') setSignals(msg.signals);
      } catch { /* binary */ }
    };
    return () => ws.close();
  }, []);

  // Draw spectrum
  useEffect(() => {
    if (!canvasRef.current || !sweepData) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    const W = rect.width;
    const H = rect.height;

    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);

    // Grid
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;
    const minDb = -120;
    const maxDb = -20;

    // Grid lines
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth = 0.5;
    for (let db = minDb; db <= maxDb; db += 10) {
      const y = margin.top + plotH * (1 - (db - minDb) / (maxDb - minDb));
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#4a4a6a';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${db}`, margin.left - 5, y + 3);
    }

    const freqs = sweepData.frequencies;
    const fMin = freqs[0];
    const fMax = freqs[freqs.length - 1];

    // Frequency labels
    const fRange = fMax - fMin;
    const fStep = fRange > 100e6 ? 50e6 : fRange > 10e6 ? 5e6 : fRange > 1e6 ? 500e3 : 100e3;
    ctx.fillStyle = '#4a4a6a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (let f = Math.ceil(fMin / fStep) * fStep; f <= fMax; f += fStep) {
      const x = margin.left + plotW * ((f - fMin) / (fMax - fMin));
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
      ctx.strokeStyle = '#1a1a3a';
      ctx.stroke();
      ctx.fillText(`${(f / 1e6).toFixed(f >= 1e9 ? 0 : 1)}`, x, H - margin.bottom + 15);
    }
    ctx.fillText('MHz', margin.left + plotW / 2, H - 5);

    // dB label
    ctx.save();
    ctx.translate(12, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('dBm', 0, 0);
    ctx.restore();

    // Max hold trace
    if (showMaxHold && sweepData.maxHold.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < sweepData.maxHold.length; i++) {
        const x = margin.left + plotW * (i / (sweepData.maxHold.length - 1));
        const y = margin.top + plotH * (1 - (sweepData.maxHold[i] - minDb) / (maxDb - minDb));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Power trace
    ctx.beginPath();
    const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + plotH);
    gradient.addColorStop(0, '#00e5ff');
    gradient.addColorStop(0.5, '#00e5ff80');
    gradient.addColorStop(1, '#00e5ff20');

    for (let i = 0; i < sweepData.powers.length; i++) {
      const x = margin.left + plotW * (i / (sweepData.powers.length - 1));
      const y = margin.top + plotH * (1 - (sweepData.powers[i] - minDb) / (maxDb - minDb));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Detected signals markers
    for (const sig of signals) {
      const x = margin.left + plotW * ((sig.frequency - fMin) / (fMax - fMin));
      const y = margin.top + plotH * (1 - (sig.power - minDb) / (maxDb - minDb));
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4444';
      ctx.fill();
      ctx.strokeStyle = '#ff444480';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Classification badge + label
      ctx.fillStyle = '#ff8888';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(sig.frequency / 1e6).toFixed(3)}`, x, y - 8);

      if (sig.classification) {
        // Classification badge background
        const label = sig.classification.toUpperCase();
        const labelW = ctx.measureText(label).width + 6;
        ctx.fillStyle = 'rgba(0, 200, 120, 0.15)';
        ctx.strokeStyle = 'rgba(0, 200, 120, 0.5)';
        ctx.lineWidth = 0.5;
        const bx = x - labelW / 2;
        const by = y - 22;
        ctx.beginPath();
        ctx.roundRect(bx, by, labelW, 11, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#00c878';
        ctx.font = 'bold 7px monospace';
        ctx.fillText(label, x, by + 8);
      }
    }

    // Cursor
    if (cursor) {
      const x = margin.left + plotW * ((cursor.freq - fMin) / (fMax - fMin));
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
      ctx.strokeStyle = '#ffffff40';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${(cursor.freq / 1e6).toFixed(3)} MHz  ${cursor.power.toFixed(1)} dBm`, x + 5, margin.top + 15);
    }

    // Sweep count
    ctx.fillStyle = '#4a4a6a';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Sweep #${sweepData.sweepCount}`, W - margin.right, margin.top + 12);

  }, [sweepData, signals, showMaxHold, cursor]);

  const startSweep = async () => {
    await fetch(`${API}/api/spectrum/sweep/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startFrequency: parseFloat(startFreq) * 1e6,
        endFrequency: parseFloat(endFreq) * 1e6,
        stepSize: parseFloat(stepSize) * 1e6,
        dwellTime: 50,
        rbw: parseFloat(rbw) * 1e3,
        fftSize: 4096,
      }),
    });
    setSweeping(true);
  };

  const stopSweep = async () => {
    await fetch(`${API}/api/spectrum/sweep/stop`, { method: 'POST' });
    setSweeping(false);
  };

  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sweepData || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const x = e.clientX - rect.left;
    const ratio = (x - margin.left) / (rect.width - margin.left - margin.right);
    if (ratio < 0 || ratio > 1) { setCursor(null); return; }
    const idx = Math.floor(ratio * sweepData.frequencies.length);
    if (idx >= 0 && idx < sweepData.frequencies.length) {
      setCursor({ freq: sweepData.frequencies[idx], power: sweepData.powers[idx] });
    }
  }, [sweepData]);

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      {/* Controls */}
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-xs font-mono text-forge-cyan tracking-wider">📊 SPECTRUM ANALYZER</span>
        <PopOutButton view="analyzer" />

        <div className="flex items-center gap-1 ml-2">
          <input value={startFreq} onChange={e => setStartFreq(e.target.value)} placeholder="Start MHz"
            className="w-20 bg-forge-bg border border-forge-border rounded px-1.5 py-1 text-[10px] font-mono text-forge-text focus:border-forge-cyan outline-none" />
          <span className="text-forge-text-dim text-[10px]">—</span>
          <input value={endFreq} onChange={e => setEndFreq(e.target.value)} placeholder="End MHz"
            className="w-20 bg-forge-bg border border-forge-border rounded px-1.5 py-1 text-[10px] font-mono text-forge-text focus:border-forge-cyan outline-none" />
          <span className="text-[10px] font-mono text-forge-text-dim ml-1">Step:</span>
          <input value={stepSize} onChange={e => setStepSize(e.target.value)}
            className="w-14 bg-forge-bg border border-forge-border rounded px-1.5 py-1 text-[10px] font-mono text-forge-text focus:border-forge-cyan outline-none" />
          <span className="text-[10px] font-mono text-forge-text-dim ml-1">RBW:</span>
          <input value={rbw} onChange={e => setRbw(e.target.value)}
            className="w-14 bg-forge-bg border border-forge-border rounded px-1.5 py-1 text-[10px] font-mono text-forge-text focus:border-forge-cyan outline-none" />
          <span className="text-[10px] font-mono text-forge-text-dim">kHz</span>
        </div>

        <button onClick={sweeping ? stopSweep : startSweep}
          className={`px-3 py-1 text-[10px] font-mono rounded border transition-all ${
            sweeping
              ? 'text-forge-red border-forge-red/30 bg-forge-red/10 hover:bg-forge-red/20'
              : 'text-forge-cyan border-forge-cyan/30 bg-forge-cyan/10 hover:bg-forge-cyan/20'
          }`}>
          {sweeping ? '■ STOP' : '▶ SWEEP'}
        </button>

        <button onClick={() => setShowMaxHold(!showMaxHold)}
          className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${
            showMaxHold ? 'text-forge-amber border-forge-amber/30 bg-forge-amber/10' : 'text-forge-text-dim border-forge-border'
          }`}>
          MAX HOLD
        </button>

        {/* Presets */}
        <div className="ml-auto flex gap-1">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { setStartFreq(p.start.toString()); setEndFreq(p.end.toString()); setStepSize(p.step.toString()); }}
              className="px-2 py-1 text-[8px] font-mono text-forge-text-dim border border-forge-border/30 rounded hover:border-forge-cyan hover:text-forge-cyan transition-all">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef}
          className="w-full h-full"
          onMouseMove={handleCanvasMove}
          onMouseLeave={() => setCursor(null)} />

        {!sweepData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2">📊</div>
              <div className="text-xs font-mono text-forge-text-dim">
                Configure sweep range and click SWEEP to begin
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Signal list */}
      {signals.length > 0 && (
        <div className="border-t border-forge-border bg-forge-surface/30 p-2 max-h-32 overflow-y-auto">
          <div className="text-[10px] font-mono text-forge-text-dim mb-1">
            🎯 DETECTED SIGNALS ({signals.length})
          </div>
          <div className="grid grid-cols-4 gap-1">
            {signals.map((s, i) => (
              <div key={i} className="text-[9px] font-mono px-2 py-1 bg-forge-bg/50 rounded border border-forge-border/30">
                <span className="text-forge-cyan">{(s.frequency / 1e6).toFixed(3)}</span>
                <span className="text-forge-text-dim"> MHz </span>
                <span className="text-forge-amber">{s.power.toFixed(0)}</span>
                <span className="text-forge-text-dim"> dBm</span>
                {s.classification && <span className="text-forge-green ml-1">{s.classification}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
