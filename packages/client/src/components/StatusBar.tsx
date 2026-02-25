import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../stores/location';
import { getGpuDspEngine, type GpuStatus, type DspMetrics } from '../gpu/engine';

function formatRate(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export const StatusBar: React.FC = () => {
  const [time, setTime] = useState(new Date());
  const [fps, setFps] = useState(0);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [dspMetrics, setDspMetrics] = useState<DspMetrics | null>(null);
  const [serverStatus, setServerStatus] = useState<{ version: string; uptime: number } | null>(null);
  const [solarData, setSolarData] = useState<{ solarFlux: number; kIndex: number; geomagField: string } | null>(null);
  const { observer } = useLocationStore();

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getGpuDspEngine().then(engine => setGpuStatus(engine.status)).catch(() => {});

    // DSP metrics — poll every second
    const metricsInterval = setInterval(async () => {
      try {
        const engine = await getGpuDspEngine();
        setDspMetrics({ ...engine.metrics });
        engine.resetMetricsWindow();
      } catch { /* ignore */ }
    }, 1000);

    let frames = 0;
    let lastTime = performance.now();
    const countFrame = () => {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frames);
        frames = 0;
        lastTime = now;
      }
      requestAnimationFrame(countFrame);
    };
    requestAnimationFrame(countFrame);

    // Server health check
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        setServerStatus(await res.json());
      } catch { /* ignore */ }
    };
    checkHealth();
    const healthInterval = setInterval(checkHealth, 30000);

    // Fetch solar data
    const fetchSolar = async () => {
      try {
        const res = await fetch('/api/propagation/solar');
        setSolarData(await res.json());
      } catch { /* ignore */ }
    };
    fetchSolar();
    const solarInterval = setInterval(fetchSolar, 300000);

    return () => { clearInterval(healthInterval); clearInterval(solarInterval); clearInterval(metricsInterval); };
  }, []);

  const utc = time.toISOString().substring(11, 19);

  return (
    <footer className="h-7 flex items-center px-4 border-t border-forge-border bg-forge-surface/80 text-[10px] font-mono text-forge-text-dim">
      <span className="flex items-center gap-1.5" title={gpuStatus?.available
        ? `WebGPU: Active — ${gpuStatus.adapterName} (${gpuStatus.vendor})\nArchitecture: ${gpuStatus.architecture}`
        : 'WebGPU: Unavailable (using JS fallback)'}>
        <span className={`w-1.5 h-1.5 rounded-full ${gpuStatus?.available ? 'bg-forge-green' : 'bg-forge-amber'}`} />
        {gpuStatus?.available ? `WebGPU: Active · ${gpuStatus.adapterName}` : 'WebGPU: Unavailable (JS fallback)'}
      </span>
      <span className="mx-3 text-forge-border">│</span>
      <span>{fps} FPS</span>
      {dspMetrics && dspMetrics.samplesPerSec > 0 && (
        <>
          <span className="mx-3 text-forge-border">│</span>
          <span title={`FFT: ${dspMetrics.lastFftMs.toFixed(1)}ms | ${dspMetrics.fftCount} FFTs/window`}>
            DSP: {formatRate(dspMetrics.samplesPerSec)} samp/s
          </span>
          {dspMetrics.lastFftMs > 0 && (
            <span className="ml-1 text-forge-text-dim">({dspMetrics.lastFftMs.toFixed(1)}ms/FFT)</span>
          )}
        </>
      )}
      <span className="mx-3 text-forge-border">│</span>
      <span>📍 {observer.latitude.toFixed(2)}°, {observer.longitude.toFixed(2)}° ({observer.source})</span>
      <span className="mx-3 text-forge-border">│</span>
      <span className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${serverStatus ? 'bg-forge-green' : 'bg-forge-red'}`} />
        Server {serverStatus ? 'OK' : '—'}
      </span>

      <div className="ml-auto flex items-center gap-3">
        {solarData && (
          <>
            <span>SFI:{solarData.solarFlux}</span>
            <span>K:{solarData.kIndex}</span>
            <span className={solarData.geomagField === 'quiet' ? 'text-green-400' : solarData.geomagField === 'unsettled' ? 'text-yellow-400' : 'text-red-400'}>
              {solarData.geomagField?.toUpperCase()}
            </span>
            <span className="text-forge-border">│</span>
          </>
        )}
        {serverStatus && <span>Uptime: {Math.floor(serverStatus.uptime / 3600)}h{Math.floor((serverStatus.uptime % 3600) / 60)}m</span>}
        <span>SignalForge v0.10.0</span>
        <span className="text-forge-cyan">{utc} UTC</span>
      </div>
    </footer>
  );
};
