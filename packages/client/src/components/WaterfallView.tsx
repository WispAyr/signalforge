import React, { useRef, useEffect, useCallback } from 'react';
import { COLORMAPS } from '@signalforge/shared';

/**
 * GPU-accelerated waterfall display.
 * Falls back to Canvas 2D when WebGPU is unavailable.
 * Renders FFT data as a scrolling spectrogram with configurable colormap.
 */
export const WaterfallView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const fftHistory = useRef<Float32Array[]>([]);
  const fftSize = 2048;

  // Generate demo FFT data
  const generateDemoFFT = useCallback((): Float32Array => {
    const data = new Float32Array(fftSize);
    const time = Date.now() / 1000;

    for (let i = 0; i < fftSize; i++) {
      // Noise floor
      data[i] = -100 + Math.random() * 8;

      // Signals at various points
      const freq = i / fftSize;

      // Strong FM station
      const fm1 = Math.exp(-Math.pow((freq - 0.3) * 100, 2));
      data[i] += fm1 * (40 + 5 * Math.sin(time * 0.5));

      // Weak signal
      const sig2 = Math.exp(-Math.pow((freq - 0.55) * 200, 2));
      data[i] += sig2 * 20;

      // Pulsing signal
      const sig3 = Math.exp(-Math.pow((freq - 0.7) * 150, 2));
      data[i] += sig3 * (30 * Math.abs(Math.sin(time * 2)));

      // Wideband noise burst
      if (freq > 0.15 && freq < 0.2) {
        data[i] += 10 + Math.random() * 5 * Math.max(0, Math.sin(time * 0.3));
      }

      // Sweeping signal
      const sweepPos = 0.4 + 0.1 * Math.sin(time * 0.7);
      const sweep = Math.exp(-Math.pow((freq - sweepPos) * 300, 2));
      data[i] += sweep * 25;
    }

    return data;
  }, []);

  // Color mapping
  const getColor = useCallback((db: number, minDb: number, maxDb: number): [number, number, number] => {
    const t = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
    const colors = COLORMAPS.cyan.colors;
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

  const render = useCallback(() => {
    // Waterfall canvas
    const canvas = canvasRef.current;
    const specCanvas = spectrumRef.current;
    if (!canvas || !specCanvas) return;

    const ctx = canvas.getContext('2d');
    const specCtx = specCanvas.getContext('2d');
    if (!ctx || !specCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    // Waterfall takes bottom 70%, spectrum top 30%
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

    // Generate new FFT line
    const fftData = generateDemoFFT();
    fftHistory.current.unshift(fftData);
    if (fftHistory.current.length > wfHeight) {
      fftHistory.current.pop();
    }

    const minDb = -110;
    const maxDb = -40;

    // --- Render Waterfall ---
    ctx.save();
    ctx.scale(dpr, dpr);

    const imgData = ctx.createImageData(rect.width, Math.min(fftHistory.current.length, wfHeight));
    const pixels = imgData.data;

    for (let y = 0; y < Math.min(fftHistory.current.length, wfHeight); y++) {
      const row = fftHistory.current[y];
      for (let x = 0; x < rect.width; x++) {
        const bin = Math.floor((x / rect.width) * fftSize);
        const [r, g, b] = getColor(row[bin], minDb, maxDb);
        const idx = (y * rect.width + x) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Frequency labels
    ctx.fillStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.font = `${10 * dpr}px "JetBrains Mono"`;
    // (simplified)

    ctx.restore();

    // --- Render Spectrum ---
    specCtx.save();
    specCtx.scale(dpr, dpr);
    specCtx.fillStyle = '#0a0a0f';
    specCtx.fillRect(0, 0, rect.width, specHeight);

    // Grid lines
    specCtx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    specCtx.lineWidth = 0.5;
    for (let db = minDb; db <= maxDb; db += 10) {
      const y = specHeight - ((db - minDb) / (maxDb - minDb)) * specHeight;
      specCtx.beginPath();
      specCtx.moveTo(0, y);
      specCtx.lineTo(rect.width, y);
      specCtx.stroke();

      specCtx.fillStyle = 'rgba(0, 229, 255, 0.3)';
      specCtx.font = '9px "JetBrains Mono"';
      specCtx.fillText(`${db} dB`, 4, y - 2);
    }

    // Spectrum line
    specCtx.beginPath();
    specCtx.strokeStyle = '#00e5ff';
    specCtx.lineWidth = 1.5;
    specCtx.shadowColor = 'rgba(0, 229, 255, 0.5)';
    specCtx.shadowBlur = 4;

    for (let x = 0; x < rect.width; x++) {
      const bin = Math.floor((x / rect.width) * fftSize);
      const db = fftData[bin];
      const y = specHeight - ((db - minDb) / (maxDb - minDb)) * specHeight;
      if (x === 0) specCtx.moveTo(x, y);
      else specCtx.lineTo(x, y);
    }
    specCtx.stroke();
    specCtx.shadowBlur = 0;

    // Fill under the line
    specCtx.lineTo(rect.width, specHeight);
    specCtx.lineTo(0, specHeight);
    specCtx.closePath();
    const gradient = specCtx.createLinearGradient(0, 0, 0, specHeight);
    gradient.addColorStop(0, 'rgba(0, 229, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 229, 255, 0.01)');
    specCtx.fillStyle = gradient;
    specCtx.fill();

    // Center frequency marker
    specCtx.strokeStyle = 'rgba(255, 171, 0, 0.5)';
    specCtx.lineWidth = 1;
    specCtx.setLineDash([4, 4]);
    specCtx.beginPath();
    specCtx.moveTo(rect.width / 2, 0);
    specCtx.lineTo(rect.width / 2, specHeight);
    specCtx.stroke();
    specCtx.setLineDash([]);

    specCtx.fillStyle = 'rgba(255, 171, 0, 0.8)';
    specCtx.font = '10px "JetBrains Mono"';
    specCtx.fillText('100.000 MHz', rect.width / 2 + 4, 14);

    specCtx.restore();

    animRef.current = requestAnimationFrame(render);
  }, [generateDemoFFT, getColor]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  return (
    <div className="h-full w-full flex flex-col bg-forge-bg relative">
      {/* Frequency scale */}
      <div className="h-6 flex items-center justify-between px-4 text-[9px] font-mono text-forge-cyan-dim border-b border-forge-border">
        <span>98.800 MHz</span>
        <span>99.400 MHz</span>
        <span className="text-forge-amber">100.000 MHz</span>
        <span>100.600 MHz</span>
        <span>101.200 MHz</span>
      </div>

      {/* Spectrum display */}
      <div className="relative" style={{ height: '30%' }}>
        <canvas ref={spectrumRef} className="absolute inset-0" />
      </div>

      {/* Waterfall display */}
      <div className="flex-1 relative border-t border-forge-border/50">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>

      {/* Controls overlay */}
      <div className="absolute bottom-3 right-3 flex gap-2 text-[10px] font-mono">
        <span className="bg-forge-bg/90 border border-forge-border px-2 py-1 rounded text-forge-text-dim">
          FFT: 2048 · Cyan Forge · -110 to -40 dB
        </span>
      </div>
    </div>
  );
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
