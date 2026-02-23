import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';

// Lazy-load real components for each scene
const GlobeView = lazy(() => import('./GlobeView').then(m => ({ default: m.GlobeView })));
const WaterfallView = lazy(() => import('./WaterfallView').then(m => ({ default: m.WaterfallView })));
const MapView = lazy(() => import('./MapView').then(m => ({ default: m.MapView })));
const Dashboard = lazy(() => import('./Dashboard').then(m => ({ default: m.Dashboard })));
const SpectrumAnalyzer = lazy(() => import('./SpectrumAnalyzer').then(m => ({ default: m.SpectrumAnalyzer })));

interface Scene {
  id: string;
  label: string;
  icon: string;
  description: string;
  component: React.ReactNode;
}

const SCENES: Scene[] = [
  { id: 'globe', label: 'Orbital View', icon: '🌍', description: 'Satellite tracking & orbital paths', component: <Suspense fallback={null}><GlobeView /></Suspense> },
  { id: 'waterfall', label: 'Signal Waterfall', icon: '≋', description: 'RF spectrum waterfall display', component: <Suspense fallback={null}><WaterfallView /></Suspense> },
  { id: 'map', label: 'Tactical Map', icon: '🗺️', description: 'Aircraft, vessel & APRS tracking', component: <Suspense fallback={null}><MapView /></Suspense> },
  { id: 'dashboard', label: 'Operations Dashboard', icon: '📊', description: 'Live metrics & system status', component: <Suspense fallback={null}><Dashboard onNavigate={() => {}} /></Suspense> },
  { id: 'spectrum', label: 'Spectrum Analysis', icon: '📈', description: 'Wideband spectrum analyzer', component: <Suspense fallback={null}><SpectrumAnalyzer /></Suspense> },
];

const CYCLE_DURATION = 18000; // 18 seconds per scene

export const CinematicView: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ambient, setAmbient] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scene = SCENES[currentIndex];
  const nextScene = nextIndex !== null ? SCENES[nextIndex] : null;

  const goToScene = useCallback((index: number) => {
    if (index === currentIndex || transitioning) return;
    setNextIndex(index);
    setTransitioning(true);
    // After crossfade completes, swap
    setTimeout(() => {
      setCurrentIndex(index);
      setNextIndex(null);
      setTransitioning(false);
    }, 1200);
  }, [currentIndex, transitioning]);

  const nextSceneFn = useCallback(() => {
    goToScene((currentIndex + 1) % SCENES.length);
  }, [currentIndex, goToScene]);

  const prevScene = useCallback(() => {
    goToScene((currentIndex - 1 + SCENES.length) % SCENES.length);
  }, [currentIndex, goToScene]);

  // Auto-cycle
  useEffect(() => {
    if (paused || transitioning) return;
    timerRef.current = setTimeout(nextSceneFn, CYCLE_DURATION);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [paused, transitioning, currentIndex, nextSceneFn]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          setPaused(p => !p);
          break;
        case 'ArrowRight':
          nextSceneFn();
          break;
        case 'ArrowLeft':
          prevScene();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'a':
        case 'A':
          setAmbient(a => !a);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextSceneFn, prevScene]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Progress bar
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (paused || transitioning) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(elapsed / CYCLE_DURATION, 1));
      if (elapsed < CYCLE_DURATION) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, transitioning, currentIndex]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative bg-black overflow-hidden select-none"
      style={{ cursor: 'none' }}
      onMouseMove={(e) => {
        // Show cursor briefly on movement
        const el = e.currentTarget;
        el.style.cursor = 'default';
        clearTimeout((el as any)._cursorTimer);
        (el as any)._cursorTimer = setTimeout(() => { el.style.cursor = 'none'; }, 2000);
      }}
    >
      {/* Current scene */}
      <div
        className="absolute inset-0 w-full h-full"
        style={{
          opacity: transitioning ? 0 : 1,
          transition: 'opacity 1.2s ease-in-out',
          pointerEvents: transitioning ? 'none' : 'auto',
        }}
      >
        {scene.component}
      </div>

      {/* Next scene (fades in during transition) */}
      {nextScene && (
        <div
          className="absolute inset-0 w-full h-full"
          style={{
            opacity: transitioning ? 1 : 0,
            transition: 'opacity 1.2s ease-in-out',
          }}
        >
          {nextScene.component}
        </div>
      )}

      {/* Ambient overlay — dims chrome */}
      {ambient && (
        <>
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent pointer-events-none z-20" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-20" />
        </>
      )}

      {/* Toolbar — appears on hover */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center gap-2 p-3 opacity-0 hover:opacity-100 transition-opacity duration-500">
        <span className="text-cyan-400 font-mono text-sm font-bold tracking-wider">🎬 CINEMATIC</span>
        <div className="flex gap-1 ml-3">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => goToScene(i)}
              className={`px-2 py-1 rounded text-xs font-mono transition-all ${
                currentIndex === i
                  ? 'bg-cyan-500/30 text-cyan-400 border border-cyan-500/40'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`}
            >
              {s.icon}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setPaused(p => !p)}
          className={`px-3 py-1 rounded text-xs font-mono ${paused ? 'text-amber-400 bg-amber-500/20' : 'text-green-400 bg-green-500/20'}`}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button onClick={() => setAmbient(a => !a)}
          className={`px-3 py-1 rounded text-xs font-mono ${ambient ? 'text-cyan-400' : 'text-gray-500'}`}>
          {ambient ? '☀ Ambient' : '☾ Normal'}
        </button>
        <button onClick={toggleFullscreen}
          className="px-3 py-1 rounded text-xs font-mono text-gray-400 hover:text-white">
          {isFullscreen ? '⊡ Exit' : '⊞ Fullscreen'}
        </button>
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-4">
        {/* Progress bar */}
        <div className="w-full h-0.5 bg-white/10 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-cyan-500/60 rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{scene.icon}</span>
              <div>
                <div className="text-white font-mono text-lg font-bold tracking-wide">{scene.label}</div>
                <div className="text-gray-400 font-mono text-xs">{scene.description}</div>
              </div>
            </div>
          </div>

          <div className="text-right font-mono">
            <div className="text-white/80 text-sm tabular-nums">
              {new Date().toLocaleTimeString('en-GB', { hour12: false })}
            </div>
            <div className="text-gray-500 text-[10px]">
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            <div className="text-cyan-400/60 text-[10px] mt-0.5">
              SIGNALFORGE • {paused ? 'PAUSED' : 'LIVE'} • {currentIndex + 1}/{SCENES.length}
            </div>
          </div>
        </div>
      </div>

      {/* Scene dots */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex gap-2">
        {SCENES.map((_, i) => (
          <button
            key={i}
            onClick={() => goToScene(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              currentIndex === i ? 'bg-cyan-400 scale-125' : 'bg-white/20 hover:bg-white/40'
            }`}
          />
        ))}
      </div>
    </div>
  );
};
