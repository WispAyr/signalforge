import React, { useRef, useEffect, useCallback, useState } from 'react';
import { COLORMAPS } from '@signalforge/shared';
import type { ColormapName } from '@signalforge/shared';
import { PopOutButton } from './ui/PopOutButton';

// ── Blackman-Harris window ──
function blackmanHarris(N: number): Float32Array {
  const w = new Float32Array(N);
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  for (let i = 0; i < N; i++) {
    const x = (2 * Math.PI * i) / (N - 1);
    w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return w;
}

// ── Radix-2 DIT FFT (in-place) ──
function fftInPlace(re: Float32Array, im: Float32Array) {
  const N = re.length;
  // bit-reversal
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // butterfly
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// ── IQ → power spectrum in dB ──
function iqToPowerDb(iq: Float32Array, fftSize: number, window: Float32Array): Float32Array {
  const offset = iq.length > fftSize * 2 ? iq.length - fftSize * 2 : 0;
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    re[i] = iq[offset + i * 2] * window[i];
    im[i] = iq[offset + i * 2 + 1] * window[i];
  }
  fftInPlace(re, im);
  // fftshift + power in dB
  const out = new Float32Array(fftSize);
  const half = fftSize >> 1;
  for (let i = 0; i < fftSize; i++) {
    const j = (i + half) % fftSize;
    const pwr = re[j] * re[j] + im[j] * im[j];
    out[i] = 10 * Math.log10(pwr + 1e-20);
  }
  return out;
}

export const WaterfallView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const fftHistory = useRef<Float32Array[]>([]);

  const [fftSize, setFftSize] = useState(2048);
  const [colormap, setColormap] = useState<ColormapName>('cyan');
  const [minDb, setMinDb] = useState(-110);
  const [maxDb, setMaxDb] = useState(-40);
  const [centerFreq, setCenterFreq] = useState(100e6);
  const [bandwidth, setBandwidth] = useState(2.4e6);
  const [showSettings, setShowSettings] = useState(false);

  // SDR state
  const [sdrConnected, setSdrConnected] = useState(false);
  const [sdrFreqInput, setSdrFreqInput] = useState('100.0');
  const [sdrGain, setSdrGain] = useState(40);
  const wsRef = useRef<WebSocket | null>(null);
  const latestFftRef = useRef<Float32Array | null>(null);
  const windowRef = useRef<Float32Array>(blackmanHarris(2048));

  // Update window when fftSize changes
  useEffect(() => {
    windowRef.current = blackmanHarris(fftSize);
  }, [fftSize]);

  // WebSocket connection for real IQ data
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {};
    ws.onclose = () => { setSdrConnected(false); latestFftRef.current = null; };
    ws.onerror = () => { setSdrConnected(false); };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const iq = new Float32Array(e.data);
        if (iq.length >= fftSize * 2) {
          latestFftRef.current = iqToPowerDb(iq, fftSize, windowRef.current);
          setSdrConnected(true);
        }
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'iq_meta') {
            if (msg.sampleRate) setBandwidth(msg.sampleRate);
            if (msg.centerFrequency) {
              setCenterFreq(msg.centerFrequency);
              setSdrFreqInput((msg.centerFrequency / 1e6).toFixed(3));
            }
            setSdrConnected(true);
          }
        } catch {}
      }
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [fftSize]);

  // Generate demo FFT data with more realistic signals
  const generateDemoFFT = useCallback((): Float32Array => {
    const data = new Float32Array(fftSize);
    const time = Date.now() / 1000;
    for (let i = 0; i < fftSize; i++) {
      const freq = i / fftSize;
      data[i] = -100 + Math.random() * 6 + (freq - 0.5) * 4;
      const fm1 = Math.exp(-Math.pow((freq - 0.25) * 80, 2));
      data[i] += fm1 * (42 + 3 * Math.sin(time * 0.3));
      const fm2 = Math.exp(-Math.pow((freq - 0.33) * 90, 2));
      data[i] += fm2 * (38 + 4 * Math.sin(time * 0.4 + 1));
      const fm3 = Math.exp(-Math.pow((freq - 0.48) * 85, 2));
      data[i] += fm3 * (35 + 5 * Math.sin(time * 0.5 + 2));
      const nb1 = Math.exp(-Math.pow((freq - 0.55) * 300, 2));
      data[i] += nb1 * (25 + Math.random() * 8);
      const beacon = Math.exp(-Math.pow((freq - 0.65) * 400, 2));
      data[i] += beacon * (30 * Math.max(0, Math.sin(time * 3)));
      if (freq > 0.72 && freq < 0.78) {
        data[i] += (8 + Math.random() * 6) * (0.5 + 0.5 * Math.sin(time * 0.2));
      }
      const sweepPos = 0.15 + 0.08 * Math.sin(time * 0.4);
      const sweep = Math.exp(-Math.pow((freq - sweepPos) * 250, 2));
      data[i] += sweep * 20;
      if (Math.sin(time * 0.8 + 3) > 0.7) {
        const burst = Math.exp(-Math.pow((freq - 0.85) * 150, 2));
        data[i] += burst * 28;
      }
      for (let h = 0; h < 5; h++) {
        const hp = 0.38 + h * 0.012;
        const harm = Math.exp(-Math.pow((freq - hp) * 500, 2));
        data[i] += harm * (15 - h * 2);
      }
    }
    return data;
  }, [fftSize]);

  const getColor = useCallback((db: number, mn: number, mx: number, cmap: ColormapName): [number, number, number] => {
    const t = Math.max(0, Math.min(1, (db - mn) / (mx - mn)));
    const colors = COLORMAPS[cmap].colors;
    const idx = t * (colors.length - 1);
    const i = Math.floor(idx);
    const frac = idx - i;
    const c1 = hexToRgb(colors[Math.min(i, colors.length - 1)]);
    const c2 = hexToRgb(colors[Math.min(i + 1, colors.length - 1)]);
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * frac),
      Math.round(c1[1] + (c2[1] - c1[1]) * frac),
      Math.round(c1[2] + (c2[2] - c1[2]) * frac),
    ];
  }, []);

  const formatFreq = (hz: number): string => {
    if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
    if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
    return `${hz.toFixed(0)} Hz`;
  };

  const handleWaterfallClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const freqOffset = (x - 0.5) * bandwidth;
    setCenterFreq(prev => prev + freqOffset);
  }, [bandwidth]);

  // SDR API helpers
  const connectSdr = async () => {
    try {
      await fetch('/api/sdr/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '127.0.0.1', port: 1234 }),
      });
    } catch {}
  };

  const tuneFrequency = async (mhz: number) => {
    try {
      await fetch('/api/sdr/frequency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: mhz * 1e6 }),
      });
    } catch {}
  };

  const setGain = async (gain: number) => {
    try {
      await fetch('/api/sdr/gain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gain }),
      });
    } catch {}
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const specCanvas = spectrumRef.current;
    if (!canvas || !specCanvas) return;

    const ctx = canvas.getContext('2d');
    const specCtx = specCanvas.getContext('2d');
    if (!ctx || !specCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    const specHeight = Math.floor(rect.height * 0.3);
    const wfHeight = Math.floor(rect.height * 0.7);

    specCanvas.width = rect.width * dpr;
    specCanvas.height = specHeight * dpr;
    specCanvas.style.width = `${rect.width}px`;
    specCanvas.style.height = `${specHeight}px`;

    canvas.width = rect.width * dpr;
    canvas.height = wfHeight * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${wfHeight}px`;

    // Use real FFT data if available, else demo
    const fftData = latestFftRef.current; if (!fftData) return;
    // Consume real data so we don't re-use stale frames
    if (latestFftRef.current) latestFftRef.current = null;

    fftHistory.current.unshift(fftData);
    if (fftHistory.current.length > wfHeight) fftHistory.current.pop();

    // --- Waterfall ---
    ctx.save();
    ctx.scale(dpr, dpr);

    const imgData = ctx.createImageData(rect.width, Math.min(fftHistory.current.length, wfHeight));
    const pixels = imgData.data;

    for (let y = 0; y < Math.min(fftHistory.current.length, wfHeight); y++) {
      const row = fftHistory.current[y];
      for (let x = 0; x < rect.width; x++) {
        const bin = Math.floor((x / rect.width) * fftSize);
        const [r, g, b] = getColor(row[bin], minDb, maxDb, colormap);
        const idx = (y * rect.width + x) * 4;
        pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.fillStyle = 'rgba(6, 6, 16, 0.7)';
    ctx.fillRect(0, 0, 40, wfHeight);
    for (let db = minDb; db <= maxDb; db += 10) {
      const y = wfHeight - ((db - minDb) / (maxDb - minDb)) * wfHeight;
      ctx.fillStyle = 'rgba(0, 229, 255, 0.3)';
      ctx.font = '8px "JetBrains Mono"';
      ctx.fillText(`${db}`, 2, y);
    }
    ctx.restore();

    // --- Spectrum ---
    specCtx.save();
    specCtx.scale(dpr, dpr);
    specCtx.fillStyle = '#060610';
    specCtx.fillRect(0, 0, rect.width, specHeight);

    for (let db = minDb; db <= maxDb; db += 10) {
      const y = specHeight - ((db - minDb) / (maxDb - minDb)) * specHeight;
      specCtx.strokeStyle = 'rgba(0, 229, 255, 0.06)';
      specCtx.lineWidth = 0.5;
      specCtx.beginPath(); specCtx.moveTo(40, y); specCtx.lineTo(rect.width, y); specCtx.stroke();
      specCtx.fillStyle = 'rgba(0, 229, 255, 0.4)';
      specCtx.font = '9px "JetBrains Mono"';
      specCtx.fillText(`${db}`, 4, y - 2);
    }

    const freqStep = bandwidth / 10;
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * rect.width;
      specCtx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
      specCtx.beginPath(); specCtx.moveTo(x, 0); specCtx.lineTo(x, specHeight); specCtx.stroke();
    }

    if (fftHistory.current.length > 5) {
      specCtx.beginPath();
      specCtx.strokeStyle = 'rgba(255, 171, 0, 0.3)';
      specCtx.lineWidth = 1;
      for (let x = 0; x < rect.width; x++) {
        const bin = Math.floor((x / rect.width) * fftSize);
        let maxVal = -999;
        for (let h = 0; h < Math.min(30, fftHistory.current.length); h++) {
          maxVal = Math.max(maxVal, fftHistory.current[h][bin]);
        }
        const y = specHeight - ((maxVal - minDb) / (maxDb - minDb)) * specHeight;
        if (x === 0) specCtx.moveTo(x, y); else specCtx.lineTo(x, y);
      }
      specCtx.stroke();
    }

    specCtx.beginPath();
    specCtx.strokeStyle = COLORMAPS[colormap].colors[6] || '#00e5ff';
    specCtx.lineWidth = 1.5;
    specCtx.shadowColor = COLORMAPS[colormap].colors[6] || '#00e5ff';
    specCtx.shadowBlur = 4;

    for (let x = 0; x < rect.width; x++) {
      const bin = Math.floor((x / rect.width) * fftSize);
      const y = specHeight - ((fftData[bin] - minDb) / (maxDb - minDb)) * specHeight;
      if (x === 0) specCtx.moveTo(x, y); else specCtx.lineTo(x, y);
    }
    specCtx.stroke();
    specCtx.shadowBlur = 0;

    specCtx.lineTo(rect.width, specHeight);
    specCtx.lineTo(0, specHeight);
    specCtx.closePath();
    const gradient = specCtx.createLinearGradient(0, 0, 0, specHeight);
    gradient.addColorStop(0, (COLORMAPS[colormap].colors[6] || '#00e5ff') + '25');
    gradient.addColorStop(1, (COLORMAPS[colormap].colors[6] || '#00e5ff') + '02');
    specCtx.fillStyle = gradient;
    specCtx.fill();

    specCtx.strokeStyle = 'rgba(255, 171, 0, 0.6)';
    specCtx.lineWidth = 1;
    specCtx.setLineDash([4, 4]);
    specCtx.beginPath();
    specCtx.moveTo(rect.width / 2, 0); specCtx.lineTo(rect.width / 2, specHeight);
    specCtx.stroke();
    specCtx.setLineDash([]);

    specCtx.fillStyle = 'rgba(255, 171, 0, 0.9)';
    specCtx.font = '10px "JetBrains Mono"';
    specCtx.fillText(formatFreq(centerFreq), rect.width / 2 + 6, 14);

    specCtx.restore();

    animRef.current = requestAnimationFrame(render);
  }, [generateDemoFFT, getColor, minDb, maxDb, centerFreq, bandwidth, fftSize, colormap]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  const freqLabels: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const f = centerFreq - bandwidth / 2 + (bandwidth * i) / 4;
    freqLabels.push(formatFreq(f));
  }

  return (
    <div className="h-full w-full flex flex-col bg-forge-bg relative">
      {/* Frequency scale */}
      <div className="h-6 flex items-center justify-between px-4 text-[9px] font-mono text-forge-cyan-dim border-b border-forge-border">
        <PopOutButton view="waterfall" className="absolute right-2 top-1 z-10" />
        {/* SDR status indicator */}
        <span className="flex items-center gap-1">
          <span className={`inline-block w-2 h-2 rounded-full ${sdrConnected ? 'bg-green-500 shadow-[0_0_4px_#22c55e]' : 'bg-gray-600'}`} />
          <span className={sdrConnected ? 'text-green-400' : 'text-forge-text-dim'}>{sdrConnected ? 'SDR' : 'DEMO'}</span>
        </span>
        {freqLabels.map((label, i) => (
          <span key={i} className={i === 2 ? 'text-forge-amber' : ''}>{label}</span>
        ))}
      </div>

      {/* Spectrum display */}
      <div className="relative" style={{ height: '30%' }}>
        <canvas ref={spectrumRef} className="absolute inset-0" />
      </div>

      {/* Waterfall display */}
      <div className="flex-1 relative border-t border-forge-border/50">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          onClick={handleWaterfallClick}
        />
      </div>

      {/* Controls overlay */}
      <div className="absolute bottom-3 right-3 flex gap-2 text-[10px] font-mono z-10">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="bg-forge-bg/90 border border-forge-border px-3 py-1.5 rounded text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all"
        >
          ⚙ Settings
        </button>
        <span className="bg-forge-bg/90 border border-forge-border px-2 py-1 rounded text-forge-text-dim">
          FFT: {fftSize} · {COLORMAPS[colormap].name} · {minDb} to {maxDb} dB
        </span>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="absolute bottom-12 right-3 w-72 panel-border rounded-lg p-4 z-20 space-y-3 max-h-[80vh] overflow-y-auto">
          <h3 className="text-xs font-mono tracking-wider text-forge-cyan">WATERFALL SETTINGS</h3>

          {/* SDR Controls */}
          <div className="border border-forge-border/50 rounded p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-forge-text-dim flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sdrConnected ? 'bg-green-500' : 'bg-gray-600'}`} />
                SDR {sdrConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
              <button
                onClick={connectSdr}
                className="text-[9px] font-mono px-2 py-0.5 rounded border border-forge-cyan/30 text-forge-cyan hover:bg-forge-cyan/10 transition-all"
              >
                Connect SDR
              </button>
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim">Frequency (MHz)</label>
              <div className="flex gap-1 mt-1">
                <input
                  type="text"
                  value={sdrFreqInput}
                  onChange={(e) => setSdrFreqInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const v = parseFloat(sdrFreqInput); if (!isNaN(v)) tuneFrequency(v); } }}
                  className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text"
                />
                <button
                  onClick={() => { const v = parseFloat(sdrFreqInput); if (!isNaN(v)) tuneFrequency(v); }}
                  className="text-[9px] font-mono px-2 py-0.5 rounded border border-forge-border text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all"
                >
                  Tune
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim">Gain: {sdrGain}</label>
              <input
                type="range" min="0" max="50" value={sdrGain}
                onChange={(e) => { const g = parseInt(e.target.value); setSdrGain(g); setGain(g); }}
                className="w-full h-1 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">FFT Size</label>
            <select
              value={fftSize}
              onChange={(e) => { setFftSize(parseInt(e.target.value)); fftHistory.current = []; }}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text mt-1"
            >
              {[512, 1024, 2048, 4096, 8192].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">Color Map</label>
            <div className="flex gap-1 mt-1">
              {(Object.keys(COLORMAPS) as ColormapName[]).map(cm => (
                <button
                  key={cm}
                  onClick={() => setColormap(cm)}
                  className={`flex-1 py-1 rounded text-[9px] font-mono border transition-all ${
                    colormap === cm ? 'border-forge-cyan text-forge-cyan' : 'border-forge-border text-forge-text-dim'
                  }`}
                >
                  {COLORMAPS[cm].name.slice(0, 6)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">dB Range: {minDb} to {maxDb}</label>
            <div className="flex gap-2 mt-1">
              <input type="range" min="-140" max="-60" value={minDb} onChange={e => setMinDb(parseInt(e.target.value))} className="flex-1 h-1" />
              <input type="range" min="-80" max="0" value={maxDb} onChange={e => setMaxDb(parseInt(e.target.value))} className="flex-1 h-1" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">Center Frequency</label>
            <input
              type="text"
              value={formatFreq(centerFreq)}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) setCenterFreq(val * 1e6);
              }}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text mt-1"
            />
          </div>

          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">Bandwidth</label>
            <select
              value={bandwidth}
              onChange={(e) => setBandwidth(parseFloat(e.target.value))}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text mt-1"
            >
              {[250e3, 500e3, 1e6, 2e6, 2.4e6, 5e6, 10e6].map(bw => (
                <option key={bw} value={bw}>{formatFreq(bw)}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
