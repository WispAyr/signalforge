import React, { useState, useEffect } from 'react';

export const StatusBar: React.FC = () => {
  const [time, setTime] = useState(new Date());
  const [fps, setFps] = useState(0);
  const [gpuAvailable, setGpuAvailable] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Check WebGPU availability
    if ('gpu' in navigator) {
      (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu
        .requestAdapter()
        .then((adapter: unknown) => setGpuAvailable(!!adapter))
        .catch(() => setGpuAvailable(false));
    }

    // FPS counter
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
  }, []);

  const utc = time.toISOString().substring(11, 19);

  return (
    <footer className="h-7 flex items-center px-4 border-t border-forge-border bg-forge-surface/80 text-[10px] font-mono text-forge-text-dim">
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${gpuAvailable ? 'bg-forge-green' : 'bg-forge-amber'}`} />
        {gpuAvailable ? 'WebGPU' : 'Canvas2D'}
      </span>
      <span className="mx-3 text-forge-border">│</span>
      <span>{fps} FPS</span>
      <span className="mx-3 text-forge-border">│</span>
      <span>Nodes: 0</span>
      <span className="mx-3 text-forge-border">│</span>
      <span>Connections: 0</span>

      <div className="ml-auto flex items-center gap-3">
        <span>SignalForge v0.1.0</span>
        <span className="text-forge-cyan">{utc} UTC</span>
      </div>
    </footer>
  );
};
