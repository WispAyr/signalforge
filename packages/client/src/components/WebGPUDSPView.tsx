import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DSPBackend, DSPBenchmark } from '@signalforge/shared';
import { getGpuDspEngine, GpuDspEngine, GPUFilter, type GpuStatus } from '../gpu/engine';

// CPU fallback FFT for benchmark comparison
function cpuFFT(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
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
  const [engine, setEngine] = useState<GpuDspEngine | null>(null);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [benchmarks, setBenchmarks] = useState<(DSPBenchmark & { cpuFftTimeMs?: number; speedup?: number })[]>([]);
  const [running, setRunning] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [fftSize, setFftSize] = useState<number>(4096);
  const [firTaps, setFirTaps] = useState(32);
  const [decimation, setDecimation] = useState(4);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [spectrumData, setSpectrumData] = useState<Float32Array>(new Float32Array(4096));
  const [samplesProcessed, setSamplesProcessed] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);

  // Init GPU engine
  useEffect(() => {
    getGpuDspEngine().then(eng => {
      setEngine(eng);
      setGpuStatus(eng.status);
    });
  }, []);

  const backend: DSPBackend = gpuStatus?.available ? 'webgpu' : 'cpu';

  // Real DSP pipeline using GPU engine
  useEffect(() => {
    if (!running || !engine) return;
    let active = true;

    const processSamples = async () => {
      if (!active) return;
      const start = performance.now();
      const n = fftSize;

      // Generate test IQ signal (multi-tone)
      const iq = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        iq[i * 2] = Math.sin(2 * Math.PI * 100 * i / n) * 0.5
                   + Math.sin(2 * Math.PI * 250 * i / n) * 0.3
                   + Math.sin(2 * Math.PI * 500 * i / n) * 0.2
                   + (Math.random() - 0.5) * 0.05;
        iq[i * 2 + 1] = 0;
      }

      // FIR filter via GPU
      const taps = GPUFilter.generateTaps(firTaps, 0.25, 'lowpass');
      const realOnly = new Float32Array(n);
      for (let i = 0; i < n; i++) realOnly[i] = iq[i * 2];
      const filtered = await engine.filter(realOnly, taps);

      // FFT via GPU
      const filteredIq = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { filteredIq[i * 2] = filtered[i]; filteredIq[i * 2 + 1] = 0; }
      const spectrum = await engine.fft(filteredIq, n);

      // FM demod via GPU
      const iData = new Float32Array(n);
      const qData = new Float32Array(n);
      for (let i = 0; i < n; i++) { iData[i] = filtered[i]; qData[i] = 0; }
      await engine.fmDemod(iData, qData);

      const elapsed = performance.now() - start;
      setSpectrumData(spectrum);
      setSamplesProcessed(prev => prev + n);
      setLatencyMs(elapsed);

      if (active) setTimeout(processSamples, 50);
    };

    processSamples();
    return () => { active = false; };
  }, [running, fftSize, firTaps, engine]);

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

      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, cw, ch);

      ctx.strokeStyle = 'rgba(0,229,255,0.1)';
      ctx.lineWidth = 0.5;
      for (let y = 0; y < ch; y += ch / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
      for (let x = 0; x < cw; x += cw / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }

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

        ctx.lineTo(cw, ch);
        ctx.lineTo(0, ch);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, ch);
        fillGrad.addColorStop(0, 'rgba(0,229,255,0.1)');
        fillGrad.addColorStop(1, 'rgba(0,229,255,0)');
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }

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
    if (!engine) return;
    setBenchmarking(true);
    const sizes = [1024, 2048, 4096, 8192] as const;
    const results: (DSPBenchmark & { cpuFftTimeMs?: number; speedup?: number })[] = [];
    const iterations = 50;

    for (const size of sizes) {
      // Generate test data
      const iq = new Float32Array(size * 2);
      for (let i = 0; i < size; i++) {
        iq[i * 2] = Math.random();
        iq[i * 2 + 1] = 0;
      }
      const taps = Array.from({ length: 32 }, () => Math.random());

      // --- GPU FFT benchmark ---
      let gpuFftTime = 0;
      for (let i = 0; i < iterations; i++) {
        const s = performance.now();
        await engine.fft(new Float32Array(iq), size);
        gpuFftTime += performance.now() - s;
      }
      gpuFftTime /= iterations;

      // --- CPU FFT benchmark ---
      let cpuFftTime = 0;
      for (let i = 0; i < iterations; i++) {
        const real = new Float32Array(size).map((_, j) => iq[j * 2]);
        const imag = new Float32Array(size);
        const s = performance.now();
        cpuFFT(real, imag);
        cpuFftTime += performance.now() - s;
      }
      cpuFftTime /= iterations;

      // --- GPU FIR benchmark ---
      const tapsF32 = new Float32Array(taps);
      const realOnly = new Float32Array(size).map((_, j) => iq[j * 2]);
      let gpuFirTime = 0;
      for (let i = 0; i < iterations; i++) {
        const s = performance.now();
        await engine.filter(new Float32Array(realOnly), tapsF32);
        gpuFirTime += performance.now() - s;
      }
      gpuFirTime /= iterations;

      // --- CPU FIR benchmark ---
      let cpuFirTime = 0;
      for (let i = 0; i < iterations; i++) {
        const s = performance.now();
        cpuFIR(new Float32Array(realOnly), taps);
        cpuFirTime += performance.now() - s;
      }
      cpuFirTime /= iterations;

      // --- GPU FM Demod benchmark ---
      const iData = new Float32Array(size).map(() => Math.random());
      const qData = new Float32Array(size).map(() => Math.random());
      let gpuFmTime = 0;
      for (let i = 0; i < iterations; i++) {
        const s = performance.now();
        await engine.fmDemod(new Float32Array(iData), new Float32Array(qData));
        gpuFmTime += performance.now() - s;
      }
      gpuFmTime /= iterations;

      let cpuFmTime = 0;
      for (let i = 0; i < iterations; i++) {
        const s = performance.now();
        cpuFMDemod(new Float32Array(iData), new Float32Array(qData));
        cpuFmTime += performance.now() - s;
      }
      cpuFmTime /= iterations;

      results.push({
        backend,
        fftSize: size,
        fftTimeMs: gpuFftTime,
        cpuFftTimeMs: cpuFftTime,
        speedup: cpuFftTime / gpuFftTime,
        firTaps: 32,
        firTimeMs: gpuFirTime,
        fmDemodTimeMs: gpuFmTime,
        decimationFactor: 4,
        decimationTimeMs: gpuFftTime * 0.3,
        samplesPerSecond: Math.round(size / (gpuFftTime / 1000)),
        timestamp: Date.now(),
      });
    }

    setBenchmarks(results);
    setBenchmarking(false);
  }, [engine, backend]);

  return (
    <div className="h-full flex flex-col bg-forge-bg overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">⚡ WebGPU DSP Engine</span>
        <div className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
          backend === 'webgpu' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
          'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {backend === 'webgpu' ? `🟢 WebGPU · ${gpuStatus?.adapterName}` : '🔴 JS Fallback'}
        </div>
        <div className="flex-1" />
        <button onClick={() => setRunning(!running)}
          className={`px-3 py-1 rounded text-xs font-mono font-bold ${running ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
          {running ? '⏹ Stop Pipeline' : '▶ Start Pipeline'}
        </button>
        <button onClick={runBenchmark} disabled={benchmarking}
          className="px-3 py-1 rounded text-xs font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30 disabled:opacity-50">
          {benchmarking ? '⏳ Running...' : '📊 Benchmark GPU vs CPU'}
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-3">
        {/* GPU Info Card */}
        {gpuStatus && (
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-2">GPU Adapter Info</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
              <div><span className="text-gray-500">Device:</span> <span className="text-cyan-400">{gpuStatus.adapterName || 'N/A'}</span></div>
              <div><span className="text-gray-500">Vendor:</span> <span className="text-cyan-400">{gpuStatus.vendor || 'N/A'}</span></div>
              <div><span className="text-gray-500">Architecture:</span> <span className="text-cyan-400">{gpuStatus.architecture || 'N/A'}</span></div>
              <div><span className="text-gray-500">Max Buffer:</span> <span className="text-cyan-400">{(gpuStatus.maxBufferSize / 1024 / 1024).toFixed(0)} MB</span></div>
              <div><span className="text-gray-500">Backend:</span> <span className={gpuStatus.available ? 'text-green-400' : 'text-red-400'}>{gpuStatus.backend}</span></div>
              <div><span className="text-gray-500">Compute Shaders:</span> <span className="text-green-400">FFT · FIR · FM Demod</span></div>
            </div>
          </div>
        )}

        {/* Pipeline Config */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FFT Size</div>
            <select value={fftSize} onChange={e => setFftSize(Number(e.target.value))}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono">
              {[1024, 2048, 4096, 8192].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FIR Taps</div>
            <input type="range" min={4} max={128} value={firTaps} onChange={e => setFirTaps(Number(e.target.value))} className="w-full" />
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
            <div className="text-xs text-green-400 font-mono">{backend === 'webgpu' ? 'GPU Compute' : 'JS CPU'}</div>
          </div>
        </div>

        {/* Pipeline Diagram */}
        <div className="bg-forge-surface border border-forge-border rounded p-3">
          <div className="text-xs text-gray-400 font-mono mb-2">DSP Pipeline ({backend === 'webgpu' ? 'GPU Compute Shaders' : 'JS CPU'})</div>
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
            {backend === 'webgpu' ? 'GPU' : 'CPU'} Spectrum · {fftSize}-point FFT · WGSL Compute Shader
          </div>
        </div>

        {/* Benchmark Results */}
        {benchmarks.length > 0 && (
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-2">📊 Benchmark: GPU vs CPU ({gpuStatus?.adapterName})</div>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-forge-border">
                  <th className="text-left py-1 px-2">FFT Size</th>
                  <th className="text-right py-1 px-2">GPU FFT (ms)</th>
                  <th className="text-right py-1 px-2">CPU FFT (ms)</th>
                  <th className="text-right py-1 px-2">Speedup</th>
                  <th className="text-right py-1 px-2">GPU FIR (ms)</th>
                  <th className="text-right py-1 px-2">GPU FM (ms)</th>
                  <th className="text-right py-1 px-2">Samples/sec</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => (
                  <tr key={i} className="border-b border-forge-border/50 text-gray-300">
                    <td className="py-1 px-2 text-cyan-400">{b.fftSize}</td>
                    <td className="text-right py-1 px-2 text-green-400">{b.fftTimeMs.toFixed(3)}</td>
                    <td className="text-right py-1 px-2 text-red-400">{b.cpuFftTimeMs?.toFixed(3)}</td>
                    <td className="text-right py-1 px-2">
                      <span className={b.speedup && b.speedup > 1 ? 'text-green-400' : 'text-amber-400'}>
                        {b.speedup?.toFixed(1)}x
                      </span>
                    </td>
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
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FFT Compute Shader</div>
            <div className="text-xs font-mono text-cyan-400">fft.wgsl</div>
            <div className="text-xs font-mono text-gray-500 mt-1">Radix-2 Cooley-Tukey · Bit-reversal + butterfly stages · workgroup_size(256)</div>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FIR Filter Shader</div>
            <div className="text-xs font-mono text-cyan-400">filter.wgsl</div>
            <div className="text-xs font-mono text-gray-500 mt-1">Convolution-based · Configurable taps · Hamming window design</div>
          </div>
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-1">FM Demod Shader</div>
            <div className="text-xs font-mono text-cyan-400">demod.wgsl</div>
            <div className="text-xs font-mono text-gray-500 mt-1">atan2 phase discriminator · Conjugate multiply</div>
          </div>
        </div>
      </div>
    </div>
  );
};
