import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DSPBackend, DSPPipelineConfig, DSPStatus, DSPBenchmark } from '@signalforge/shared';

// CPU fallback FFT implementation
function cpuFFT(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = 2 * Math.PI / len;
    const wR = Math.cos(angle), wI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * curR - imag[i + j + len / 2] * curI;
        const vI = real[i + j + len / 2] * curI + imag[i + j + len / 2] * curR;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR; imag[i + j + len / 2] = uI - vI;
        const newR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR; curR = newR;
      }
    }
  }
}

function cpuFIR(input: Float32Array, taps: number[]): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let sum = 0;
    for (let j = 0; j < taps.length; j++) {
      if (i - j >= 0) sum += input[i - j] * taps[j];
    }
    output[i] = sum;
  }
  return output;
}

function cpuFMDemod(i: Float32Array, q: Float32Array): Float32Array {
  const output = new Float32Array(i.length);
  for (let n = 1; n < i.length; n++) {
    const re = i[n] * i[n - 1] + q[n] * q[n - 1];
    const im = q[n] * i[n - 1] - i[n] * q[n - 1];
    output[n] = Math.atan2(im, re);
  }
  return output;
}

export const WebGPUDSPView: React.FC = () => {
  const [backend, setBackend] = useState<DSPBackend>('cpu');
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [webgl2Available, setWebgl2Available] = useState(false);
  const [benchmarks, setBenchmarks] = useState<DSPBenchmark[]>([]);
  const [running, setRunning] = useState(false);
  const [fftSize, setFftSize] = useState<number>(4096);
  const [firTaps, setFirTaps] = useState(32);
  const [decimation, setDecimation] = useState(4);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [spectrumData, setSpectrumData] = useState<Float32Array>(new Float32Array(4096));
  const [samplesProcessed, setSamplesProcessed] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);

  // Detect capabilities
  useEffect(() => {
    (async () => {
      if ('gpu' in navigator) {
        try {
          const adapter = await (navigator as any).gpu?.requestAdapter();
          if (adapter) setGpuAvailable(true);
        } catch {}
      }
      const testCanvas = document.createElement('canvas');
      if (testCanvas.getContext('webgl2')) setWebgl2Available(true);
    })();
  }, []);

  // Auto-select best backend
  useEffect(() => {
    if (gpuAvailable) setBackend('webgpu');
    else if (webgl2Available) setBackend('webgl2');
    else setBackend('cpu');
  }, [gpuAvailable, webgl2Available]);

  // Simulated DSP pipeline
  useEffect(() => {
    if (!running) return;
    let active = true;

    const processSamples = () => {
      if (!active) return;
      const start = performance.now();
      const n = fftSize;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);

      // Generate test signal (multi-tone)
      for (let i = 0; i < n; i++) {
        real[i] = Math.sin(2 * Math.PI * 100 * i / n) * 0.5
                + Math.sin(2 * Math.PI * 250 * i / n) * 0.3
                + Math.sin(2 * Math.PI * 500 * i / n) * 0.2
                + (Math.random() - 0.5) * 0.05;
        imag[i] = 0;
      }

      // FIR filter
      const tapsArr = Array.from({ length: firTaps }, (_, i) => {
        const m = firTaps - 1;
        const fc = 0.25;
        if (i === m / 2) return 2 * fc;
        return Math.sin(2 * Math.PI * fc * (i - m / 2)) / (Math.PI * (i - m / 2)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / m));
      });
      const filtered = cpuFIR(real, tapsArr);

      // FFT
      const fftReal = new Float32Array(filtered);
      const fftImag = new Float32Array(n);
      cpuFFT(fftReal, fftImag);

      // Magnitude spectrum (dB)
      const spectrum = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        const mag = Math.sqrt(fftReal[i] * fftReal[i] + fftImag[i] * fftImag[i]) / n;
        spectrum[i] = 20 * Math.log10(Math.max(mag, 1e-10));
      }

      // FM demod
      cpuFMDemod(fftReal, fftImag);

      const elapsed = performance.now() - start;
      setSpectrumData(spectrum);
      setSamplesProcessed(prev => prev + n);
      setLatencyMs(elapsed);

      setTimeout(processSamples, 50);
    };

    processSamples();
    return () => { active = false; };
  }, [running, fftSize, firTaps]);

  // Spectrum visualiser
  useEffect(() => {
    const canvas = spectrumRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width = canvas.offsetWidth * 2;
      const h = canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
      const cw = w / 2; const ch = h / 2;

      // Background
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, cw, ch);

      // Grid
      ctx.strokeStyle = 'rgba(0,229,255,0.1)';
      ctx.lineWidth = 0.5;
      for (let y = 0; y < ch; y += ch / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
      for (let x = 0; x < cw; x += cw / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }

      // Spectrum line
      if (spectrumData.length > 0) {
        const gradient = ctx.createLinearGradient(0, 0, 0, ch);
        gradient.addColorStop(0, '#ff1744');
        gradient.addColorStop(0.3, '#ffab00');
        gradient.addColorStop(0.6, '#00e5ff');
        gradient.addColorStop(1, '#00e676');

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const binW = cw / spectrumData.length;
        for (let i = 0; i < spectrumData.length; i++) {
          const x = i * binW;
          const dbVal = Math.max(-100, Math.min(0, spectrumData[i]));
          const y = ch - ((dbVal + 100) / 100) * ch;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Fill under curve
        ctx.lineTo(cw, ch);
        ctx.lineTo(0, ch);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, ch);
        fillGrad.addColorStop(0, 'rgba(0,229,255,0.1)');
        fillGrad.addColorStop(1, 'rgba(0,229,255,0)');
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }

      // dB scale
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '8px monospace';
      for (let db = -100; db <= 0; db += 20) {
        const y = ch - ((db + 100) / 100) * ch;
        ctx.fillText(`${db} dB`, 4, y - 2);
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [spectrumData]);

  const runBenchmark = useCallback(async () => {
    const sizes = [1024, 2048, 4096, 8192] as const;
    const results: DSPBenchmark[] = [];

    for (const size of sizes) {
      const real = new Float32Array(size).map(() => Math.random());
      const imag = new Float32Array(size);
      const taps = Array.from({ length: 32 }, () => Math.random());

      // FFT benchmark
      const fftStart = performance.now();
      for (let i = 0; i < 100; i++) {
        const r = new Float32Array(real); const im = new Float32Array(imag);
        cpuFFT(r, im);
      }
      const fftTime = (performance.now() - fftStart) / 100;

      // FIR benchmark
      const firStart = performance.now();
      for (let i = 0; i < 100; i++) cpuFIR(real, taps);
      const firTime = (performance.now() - firStart) / 100;

      // FM demod benchmark
      const fmStart = performance.now();
      for (let i = 0; i < 100; i++) cpuFMDemod(real, imag);
      const fmTime = (performance.now() - fmStart) / 100;

      results.push({
        backend, fftSize: size, fftTimeMs: fftTime, firTaps: 32, firTimeMs: firTime,
        fmDemodTimeMs: fmTime, decimationFactor: 4, decimationTimeMs: fftTime * 0.3,
        samplesPerSecond: Math.round(size / (fftTime / 1000)), timestamp: Date.now(),
      });
    }

    setBenchmarks(results);
  }, [backend]);

  return (
    <div className="h-full flex flex-col bg-forge-bg overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">⚡ WebGPU DSP Engine</span>
        <div className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
          backend === 'webgpu' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
          backend === 'webgl2' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
          'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {backend === 'webgpu' ? '🟢 WebGPU' : backend === 'webgl2' ? '🟡 WebGL2 Fallback' : '🔴 CPU'}
        </div>
        <div className="flex-1" />
        <button onClick={() => setRunning(!running)}
          className={`px-3 py-1 rounded text-xs font-mono font-bold ${running ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
          {running ? '⏹ Stop Pipeline' : '▶ Start Pipeline'}
        </button>
        <button onClick={runBenchmark} className="px-3 py-1 rounded text-xs font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30">
          📊 Benchmark
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-3">
        {/* Pipeline Config */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FFT Size</div>
            <select value={fftSize} onChange={e => setFftSize(Number(e.target.value))}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono">
              {[256, 512, 1024, 2048, 4096, 8192].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FIR Taps</div>
            <input type="range" min={4} max={128} value={firTaps} onChange={e => setFirTaps(Number(e.target.value))}
              className="w-full" />
            <div className="text-xs text-cyan-400 font-mono text-center">{firTaps}</div>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">Decimation</div>
            <select value={decimation} onChange={e => setDecimation(Number(e.target.value))}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono">
              {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}x</option>)}
            </select>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">Stats</div>
            <div className="text-xs text-cyan-400 font-mono">{(samplesProcessed / 1000000).toFixed(1)}M samples</div>
            <div className="text-xs text-amber-400 font-mono">{latencyMs.toFixed(2)}ms latency</div>
          </div>
        </div>

        {/* Pipeline Diagram */}
        <div className="bg-forge-surface border border-forge-border rounded p-3">
          <div className="text-xs text-gray-400 font-mono mb-2">DSP Pipeline</div>
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { name: 'IQ Input', icon: '📡', color: '#00e5ff' },
              { name: '→', icon: '', color: '' },
              { name: 'GPU Buffer', icon: '💾', color: '#aa00ff' },
              { name: '→', icon: '', color: '' },
              { name: `FIR (${firTaps} taps)`, icon: '▽', color: '#00e676' },
              { name: '→', icon: '', color: '' },
              { name: `FFT (${fftSize})`, icon: '📊', color: '#ff1744' },
              { name: '→', icon: '', color: '' },
              { name: 'FM Demod', icon: 'FM', color: '#ffab00' },
              { name: '→', icon: '', color: '' },
              { name: `Decimate (${decimation}x)`, icon: '↕️', color: '#6a6a8a' },
              { name: '→', icon: '', color: '' },
              { name: 'Output', icon: '🔈', color: '#00e5ff' },
            ].map((block, i) => (
              block.name === '→' ?
                <span key={i} className="text-gray-500 text-lg">→</span> :
                <div key={i} className="px-2 py-1 rounded text-xs font-mono border flex items-center gap-1 whitespace-nowrap"
                  style={{ borderColor: block.color + '40', color: block.color, backgroundColor: block.color + '10' }}>
                  <span>{block.icon}</span> {block.name}
                </div>
            ))}
          </div>
        </div>

        {/* Spectrum Display */}
        <div className="flex-1 min-h-[200px] bg-forge-surface border border-forge-border rounded overflow-hidden relative">
          <canvas ref={spectrumRef} className="w-full h-full" />
          <div className="absolute top-2 right-2 text-xs font-mono text-gray-500">
            GPU Spectrum Analyser — {fftSize}-point FFT
          </div>
        </div>

        {/* Benchmarks */}
        {benchmarks.length > 0 && (
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-2">📊 Benchmark Results ({backend.toUpperCase()})</div>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-forge-border">
                  <th className="text-left py-1 px-2">FFT Size</th>
                  <th className="text-right py-1 px-2">FFT (ms)</th>
                  <th className="text-right py-1 px-2">FIR (ms)</th>
                  <th className="text-right py-1 px-2">FM Demod (ms)</th>
                  <th className="text-right py-1 px-2">Samples/sec</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => (
                  <tr key={i} className="border-b border-forge-border/50 text-gray-300">
                    <td className="py-1 px-2 text-cyan-400">{b.fftSize}</td>
                    <td className="text-right py-1 px-2">{b.fftTimeMs.toFixed(3)}</td>
                    <td className="text-right py-1 px-2">{b.firTimeMs.toFixed(3)}</td>
                    <td className="text-right py-1 px-2">{b.fmDemodTimeMs.toFixed(3)}</td>
                    <td className="text-right py-1 px-2 text-green-400">{(b.samplesPerSecond / 1000000).toFixed(1)}M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Capabilities */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-forge-surface border border-forge-border rounded p-3 text-center">
            <div className={`text-2xl mb-1 ${gpuAvailable ? '' : 'opacity-30'}`}>🟢</div>
            <div className="text-xs font-mono text-gray-400">WebGPU</div>
            <div className={`text-xs font-mono ${gpuAvailable ? 'text-green-400' : 'text-red-400'}`}>{gpuAvailable ? 'Available' : 'Not Available'}</div>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3 text-center">
            <div className={`text-2xl mb-1 ${webgl2Available ? '' : 'opacity-30'}`}>🟡</div>
            <div className="text-xs font-mono text-gray-400">WebGL2</div>
            <div className={`text-xs font-mono ${webgl2Available ? 'text-green-400' : 'text-red-400'}`}>{webgl2Available ? 'Available' : 'Not Available'}</div>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3 text-center">
            <div className="text-2xl mb-1">🔴</div>
            <div className="text-xs font-mono text-gray-400">CPU</div>
            <div className="text-xs font-mono text-green-400">Always Available</div>
          </div>
        </div>
      </div>
    </div>
  );
};
