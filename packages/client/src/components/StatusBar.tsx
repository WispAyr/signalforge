import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../stores/location';
import { getGpuDspEngine, type GpuStatus } from '../gpu/engine';

export const StatusBar: React.FC = () => {
  const [time, setTime] = useState(new Date());
  const [fps, setFps] = useState(0);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [serverStatus, setServerStatus] = useState<{ version: string; uptime: number } | null>(null);
  const [solarData, setSolarData] = useState<{ solarFlux: number; kIndex: number; geomagField: string } | null>(null);
  const { observer } = useLocationStore();

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getGpuDspEngine().then(engine => setGpuStatus(engine.status)).catch(() => {});

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

    return () => { clearInterval(healthInterval); clearInterval(solarInterval); };
  }, []);

  const utc = time.toISOString().substring(11, 19);

  return (
    <footer className="h-7 flex items-center px-4 border-t border-forge-border bg-forge-surface/80 text-[10px] font-mono text-forge-text-dim">
      <span className="flex items-center gap-1.5" title={gpuStatus?.available ? `${gpuStatus.adapterName} (${gpuStatus.vendor})` : 'JS Fallback — no WebGPU'}>
        <span className={`w-1.5 h-1.5 rounded-full ${gpuStatus?.available ? 'bg-forge-green' : 'bg-forge-amber'}`} />
        {gpuStatus?.available ? `WebGPU · ${gpuStatus.adapterName}` : 'JS Fallback'}
      </span>
      <span className="mx-3 text-forge-border">│</span>
      <span>{fps} FPS</span>
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
        <span>SignalForge v0.9.0</span>
        <span className="text-forge-cyan">{utc} UTC</span>
      </div>
    </footer>
  );
};
