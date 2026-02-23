import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CinematicConfig, CinematicScene } from '@signalforge/shared';

const SCENES: Array<{ id: CinematicScene; label: string; icon: string }> = [
  { id: 'globe', label: 'Globe', icon: '🌍' },
  { id: 'waterfall', label: 'Waterfall', icon: '≋' },
  { id: 'aircraft', label: 'Aircraft', icon: '✈️' },
  { id: 'heatmap', label: 'Heatmap', icon: '🔥' },
  { id: 'spectrum', label: 'Spectrum', icon: '📊' },
  { id: 'satellites', label: 'Satellites', icon: '🛰️' },
];

export const CinematicView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [config, setConfig] = useState<CinematicConfig>({
    enabled: true, scenes: ['globe', 'waterfall', 'spectrum', 'satellites'],
    cycleDurationSec: 15, autoCycle: true, showBranding: true, brandingText: 'SIGNALFORGE',
    showClock: true, showStats: true, transitionEffect: 'fade', idleTimeoutMin: 5,
  });
  const [currentScene, setCurrentScene] = useState<CinematicScene>('globe');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [opacity, setOpacity] = useState(1);

  // Auto-cycle
  useEffect(() => {
    if (!config.autoCycle || config.scenes.length <= 1) return;
    const iv = setInterval(() => {
      setOpacity(0);
      setTimeout(() => {
        setSceneIndex(prev => {
          const next = (prev + 1) % config.scenes.length;
          setCurrentScene(config.scenes[next]);
          return next;
        });
        setOpacity(1);
      }, 500);
    }, config.cycleDurationSec * 1000);
    return () => clearInterval(iv);
  }, [config]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width = canvas.offsetWidth * 2;
      const h = canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
      const cw = w / 2; const ch = h / 2;
      const t = Date.now() * 0.001;

      // Background
      const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, cw);
      bg.addColorStop(0, '#0a0a2a');
      bg.addColorStop(1, '#000008');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      // Scene-specific rendering
      switch (currentScene) {
        case 'globe': {
          // Rotating wireframe globe
          const cx = cw / 2; const cy = ch / 2;
          const r = Math.min(cx, cy) * 0.6;
          // Atmosphere
          const glow = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.2);
          glow.addColorStop(0, 'rgba(0,150,255,0.15)');
          glow.addColorStop(1, 'rgba(0,50,255,0)');
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2); ctx.fill();
          // Earth
          const earth = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
          earth.addColorStop(0, '#1a3a5c'); earth.addColorStop(1, '#040c18');
          ctx.fillStyle = earth;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
          // Grid
          ctx.strokeStyle = 'rgba(0,200,255,0.1)';
          ctx.lineWidth = 0.5;
          for (let lat = -60; lat <= 60; lat += 30) {
            ctx.beginPath();
            for (let lon = -180; lon <= 180; lon += 5) {
              const phi = (90 - lat) * Math.PI / 180;
              const theta = (lon + t * 10) * Math.PI / 180;
              const x = -r * Math.sin(phi) * Math.cos(theta);
              const z = r * Math.sin(phi) * Math.sin(theta);
              const y = r * Math.cos(phi);
              if (z > 0) {
                if (lon === -180) ctx.moveTo(cx + x, cy + y * 0.9);
                else ctx.lineTo(cx + x, cy + y * 0.9);
              }
            }
            ctx.stroke();
          }
          // Orbiting satellites
          for (let i = 0; i < 8; i++) {
            const angle = t * 0.3 + i * Math.PI / 4;
            const orbitR = r * (1.2 + i * 0.08);
            const tilt = 0.3 + i * 0.1;
            const sx = cx + orbitR * Math.cos(angle);
            const sy = cy + orbitR * Math.sin(angle) * Math.cos(tilt);
            const sz = Math.sin(angle) * Math.sin(tilt);
            if (sz > -0.3) {
              ctx.fillStyle = `rgba(255,214,0,${0.5 + sz * 0.5})`;
              ctx.shadowColor = '#ffd600';
              ctx.shadowBlur = 8;
              ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
          break;
        }
        case 'waterfall': {
          // Audio-reactive waterfall simulation
          for (let y = 0; y < ch; y += 2) {
            for (let x = 0; x < cw; x += 2) {
              const freq = x / cw;
              const time = (y + t * 50) / ch;
              const v = Math.sin(freq * 20 + time * 5) * 0.3 + Math.sin(freq * 50 + time * 3) * 0.2 + Math.random() * 0.1;
              const h = 240 - v * 200;
              const s = 80 + v * 20;
              const l = 10 + v * 40;
              ctx.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
              ctx.fillRect(x, y, 2, 2);
            }
          }
          break;
        }
        case 'spectrum': {
          // Animated spectrum analyser
          ctx.strokeStyle = 'rgba(0,229,255,0.1)';
          for (let y = 0; y < ch; y += ch / 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
          const gradient = ctx.createLinearGradient(0, 0, 0, ch);
          gradient.addColorStop(0, '#ff1744');
          gradient.addColorStop(0.5, '#00e5ff');
          gradient.addColorStop(1, '#00e676');
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let x = 0; x < cw; x++) {
            const f = x / cw;
            let v = 0;
            for (let h = 1; h <= 8; h++) {
              v += Math.sin(f * h * 15 + t * (h * 0.5)) / h * 0.3;
            }
            v += Math.random() * 0.02;
            const y = ch / 2 + v * ch * 0.4;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
          break;
        }
        case 'aircraft': {
          // Flight trails
          for (let i = 0; i < 20; i++) {
            const baseX = (Math.sin(i * 7.3 + t * 0.1) * 0.4 + 0.5) * cw;
            const baseY = (Math.cos(i * 5.1 + t * 0.08) * 0.4 + 0.5) * ch;
            // Trail
            ctx.strokeStyle = 'rgba(0,229,255,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let j = 0; j < 30; j++) {
              const tx = baseX - j * Math.cos(i * 2.3) * 3;
              const ty = baseY - j * Math.sin(i * 2.3) * 3;
              if (j === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
            }
            ctx.stroke();
            ctx.fillStyle = '#00e5ff';
            ctx.font = '12px sans-serif';
            ctx.fillText('✈', baseX - 6, baseY + 4);
          }
          break;
        }
        case 'heatmap': {
          for (let y = 0; y < ch; y += 4) {
            for (let x = 0; x < cw; x += 4) {
              const v = Math.sin(x * 0.02 + t) * Math.cos(y * 0.02 + t * 0.7) * 0.5 + 0.5 + Math.random() * 0.1;
              const r = Math.min(255, v * 500);
              const g = Math.min(255, (1 - v) * 300);
              ctx.fillStyle = `rgba(${r},${g},0,0.8)`;
              ctx.fillRect(x, y, 4, 4);
            }
          }
          break;
        }
        case 'satellites': {
          // Star field + satellite paths
          for (let i = 0; i < 300; i++) {
            const sx = ((i * 7919) % cw);
            const sy = ((i * 6271) % ch);
            ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.sin(t + i) * 0.2})`;
            ctx.fillRect(sx, sy, 1, 1);
          }
          for (let i = 0; i < 12; i++) {
            const a = t * 0.2 + i * Math.PI / 6;
            const rx = cw * 0.3 + i * 15;
            const ry = ch * 0.2 + i * 10;
            const sx = cw / 2 + rx * Math.cos(a);
            const sy = ch / 2 + ry * Math.sin(a);
            // Orbit path
            ctx.strokeStyle = 'rgba(255,214,0,0.1)';
            ctx.beginPath();
            for (let j = 0; j < 360; j += 5) {
              const ja = j * Math.PI / 180;
              const jx = cw / 2 + rx * Math.cos(ja);
              const jy = ch / 2 + ry * Math.sin(ja);
              if (j === 0) ctx.moveTo(jx, jy); else ctx.lineTo(jx, jy);
            }
            ctx.stroke();
            ctx.fillStyle = '#ffd600';
            ctx.shadowColor = '#ffd600';
            ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
          }
          break;
        }
      }

      // Scan line effect
      const scanY = (t * 100) % ch;
      ctx.fillStyle = 'rgba(0,229,255,0.03)';
      ctx.fillRect(0, scanY, cw, 2);

      // Branding
      if (config.showBranding) {
        ctx.fillStyle = 'rgba(0,229,255,0.6)';
        ctx.font = 'bold 24px monospace';
        ctx.fillText(config.brandingText, 30, ch - 50);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px monospace';
        ctx.fillText('SIGNALS INTELLIGENCE PLATFORM', 30, ch - 30);
      }

      // Clock
      if (config.showClock) {
        const now = new Date();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '16px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(now.toLocaleTimeString(), cw - 20, 35);
        ctx.font = '10px monospace';
        ctx.fillText(now.toLocaleDateString(), cw - 20, 50);
        ctx.textAlign = 'left';
      }

      // Scene indicator
      const sceneInfo = SCENES.find(s => s.id === currentScene);
      if (sceneInfo) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '10px monospace';
        ctx.fillText(`${sceneInfo.icon} ${sceneInfo.label.toUpperCase()}`, 30, 30);
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [currentScene, config]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Minimal toolbar — fades on hover */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 p-2 bg-gradient-to-b from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500">
        <span className="text-cyan-400 font-mono text-sm font-bold">🎬 Cinematic Mode</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          {SCENES.map(scene => (
            <button key={scene.id} onClick={() => { setCurrentScene(scene.id); setSceneIndex(config.scenes.indexOf(scene.id)); }}
              className={`px-2 py-0.5 rounded text-xs font-mono ${currentScene === scene.id ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500'}`}>
              {scene.icon}
            </button>
          ))}
        </div>
        <button onClick={() => setConfig(prev => ({ ...prev, autoCycle: !prev.autoCycle }))}
          className={`px-2 py-0.5 rounded text-xs font-mono ${config.autoCycle ? 'text-green-400' : 'text-gray-500'}`}>
          {config.autoCycle ? '⏸ Pause' : '▶ Cycle'}
        </button>
        <button onClick={toggleFullscreen} className="px-2 py-0.5 rounded text-xs font-mono text-gray-400">
          {isFullscreen ? '⊡' : '⊞'} Fullscreen
        </button>
      </div>

      <canvas ref={canvasRef} className="w-full h-full"
        style={{ opacity, transition: 'opacity 0.5s ease-in-out' }} />
    </div>
  );
};
