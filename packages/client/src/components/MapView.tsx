import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Aircraft, Vessel, APRSStation, TLE, SatellitePosition } from '@signalforge/shared';
import { useLocationStore } from '../stores/location';
import { PopOutButton } from './ui/PopOutButton';
import { MapRenderer, lonToMercX, latToMercY, type MarkerData, type LineData, type TextEntry } from './MapRenderer';

interface SatWithPos extends TLE {
  position: SatellitePosition;
}

type MapLayer = 'satellites' | 'aircraft' | 'vessels' | 'aprs';

export const MapView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const animRef = useRef<number>(0);
  const { observer: obsStore } = useLocationStore();
  const observer = { lat: obsStore.latitude, lon: obsStore.longitude };
  const [layers, setLayers] = useState<Set<MapLayer>>(new Set(['satellites', 'aircraft', 'vessels', 'aprs']));
  const [satellites, setSatellites] = useState<SatWithPos[]>([]);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [aprsStations, setAprsStations] = useState<APRSStation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // Pan/zoom state — stored as refs for perf, with state for re-render triggers
  const [zoom, setZoom] = useState(4);
  const [pan, setPan] = useState(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const initZoom = 4;
    return {
      x: w / 2 - lonToMercX(-4.63) * w * initZoom,
      y: h / 2 - latToMercY(55.46) * w * initZoom,
    };
  });

  // Smooth zoom animation
  const targetZoomRef = useRef(4);
  const targetPanRef = useRef({ x: pan.x, y: pan.y });
  const currentZoomRef = useRef(4);
  const currentPanRef = useRef({ x: pan.x, y: pan.y });

  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; panX: number; panY: number }>({
    dragging: false, startX: 0, startY: 0, panX: 0, panY: 0,
  });

  // Init WebGL renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false });
    if (!gl) {
      console.error('WebGL2 not supported');
      return;
    }
    rendererRef.current = new MapRenderer(gl);
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Fetch data
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [satRes, acRes, vesRes, aprsRes] = await Promise.all([
          fetch(`/api/satellites/positions?limit=80&search=${encodeURIComponent(searchQuery)}`),
          fetch('/api/aircraft'),
          fetch('/api/vessels'),
          fetch('/api/aprs'),
        ]);
        setSatellites(await satRes.json());
        setAircraft(await acRes.json());
        setVessels(await vesRes.json());
        setAprsStations(await aprsRes.json());
      } catch { /* retry next interval */ }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [searchQuery]);

  // WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'adsb') setAircraft(msg.aircraft);
          if (msg.type === 'ais') setVessels(msg.vessels);
          if (msg.type === 'aprs') setAprsStations(msg.stations);
          if (msg.type === 'aprs_update' && msg.station) {
            setAprsStations(prev => {
              const idx = prev.findIndex(s => s.callsign === msg.station.callsign);
              if (idx >= 0) { const n = [...prev]; n[idx] = msg.station; return n; }
              return [...prev, msg.station];
            });
          }
          if (msg.type === 'ais_update' && msg.vessel) {
            setVessels(prev => {
              const idx = prev.findIndex(v => v.mmsi === msg.vessel.mmsi);
              if (idx >= 0) { const n = [...prev]; n[idx] = msg.vessel; return n; }
              return prev.length >= 5000 ? prev : [...prev, msg.vessel];
            });
          }
        } catch { /* ignore binary */ }
      };
    } catch { /* ignore */ }
    return () => ws?.close();
  }, []);

  const toggleLayer = (layer: MapLayer) => {
    setLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer); else next.add(layer);
      return next;
    });
  };

  // Convert lon/lat to screen coords using Web Mercator
  const toScreen = useCallback((lon: number, lat: number, w: number, h: number, z: number, px: number, py: number) => ({
    x: lonToMercX(lon) * w * z + px,
    y: latToMercY(lat) * w * z + py,
  }), []);

  // Render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width * dpr;
    const h = rect.height * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    renderer.resize(w, h);

    // Smooth zoom interpolation
    const lerpFactor = 0.15;
    currentZoomRef.current += (targetZoomRef.current - currentZoomRef.current) * lerpFactor;
    currentPanRef.current.x += (targetPanRef.current.x - currentPanRef.current.x) * lerpFactor;
    currentPanRef.current.y += (targetPanRef.current.y - currentPanRef.current.y) * lerpFactor;

    const cz = currentZoomRef.current;
    const cpx = currentPanRef.current.x * dpr;
    const cpy = currentPanRef.current.y * dpr;

    renderer.beginFrame();
    renderer.renderBackground();
    renderer.renderGrid(cpx, cpy, cz);
    renderer.renderTiles(cpx, cpy, cz);

    // Observer
    const obs = toScreen(observer.lon, observer.lat, w, h, cz, cpx, cpy);

    // Range circles
    for (const r of [200, 500, 1000]) {
      const rDeg = r / 111;
      const obsTopY = latToMercY(observer.lat + rDeg) * w * cz + cpy;
      const rPx = Math.abs(obs.y - obsTopY);
      renderer.renderCircle(obs.x, obs.y, rPx, [1, 1, 1, 0.06], 0.5, true);
    }

    // Observer dot
    const obsMarker: MarkerData[] = [{
      x: obs.x, y: obs.y, size: 5 * dpr, r: 1, g: 1, b: 1, a: 1, shape: 0, rotation: 0,
    }];
    renderer.renderMarkers(obsMarker);
    renderer.renderCircle(obs.x, obs.y, 12 * dpr, [1, 1, 1, 0.4], 1.5);

    const allMarkers: MarkerData[] = [];
    const allTexts: TextEntry[] = [];
    const allTrails: { lines: LineData[]; color: [number, number, number, number] }[] = [];

    const time = Date.now() / 1000;

    // Satellites
    if (layers.has('satellites')) {
      for (const sat of satellites) {
        if (!sat.position) continue;
        const pos = toScreen(sat.position.longitude, sat.position.latitude, w, h, cz, cpx, cpy);
        if (pos.x < -50 || pos.x > w + 50 || pos.y < -50 || pos.y > h + 50) continue;
        const isSelected = selectedItem === `sat-${sat.catalogNumber}`;

        // Footprint circle
        const footR = Math.sqrt(sat.position.altitude) * 1.2;
        const footRDeg = footR / 111;
        const topY = latToMercY(sat.position.latitude + footRDeg) * w * cz + cpy;
        const rPx = Math.abs(pos.y - topY);
        renderer.renderCircle(pos.x, pos.y, rPx,
          isSelected ? [0, 0.898, 1, 0.3] : [0, 0.898, 1, 0.08], isSelected ? 1.5 : 0.5);

        allMarkers.push({
          x: pos.x, y: pos.y, size: (isSelected ? 4 : 2.5) * dpr,
          r: 0, g: 0.898, b: 1, a: 1, shape: 0, rotation: 0,
        });

        if (isSelected || sat.name.includes('ISS') || satellites.indexOf(sat) < 15) {
          allTexts.push({
            text: sat.name.slice(0, 20), x: pos.x + 6 * dpr, y: pos.y - 5 * dpr,
            color: isSelected ? '#00e5ff' : 'rgba(0, 229, 255, 0.6)',
            fontSize: (isSelected ? 10 : 8) * dpr,
          });
        }
      }
    }

    // Aircraft
    if (layers.has('aircraft')) {
      const acTrails: LineData[] = [];
      for (const ac of aircraft) {
        if (ac.latitude === undefined || ac.longitude === undefined) continue;
        const pos = toScreen(ac.longitude, ac.latitude, w, h, cz, cpx, cpy);
        if (pos.x < -100 || pos.x > w + 100 || pos.y < -100 || pos.y > h + 100) continue;
        const isSelected = selectedItem === `ac-${ac.icao}`;

        if (ac.trail && ac.trail.length > 1) {
          const pts = ac.trail.map((t: { lat: number; lon: number }, i: number) => {
            const tp = toScreen(t.lon, t.lat, w, h, cz, cpx, cpy);
            return { x: tp.x, y: tp.y, alpha: (i + 1) / ac.trail.length };
          });
          acTrails.push({ points: pts });
        }

        allMarkers.push({
          x: pos.x, y: pos.y, size: 6 * dpr,
          r: 0, g: 0.902, b: 0.463, a: isSelected ? 1 : 0.8,
          shape: 1, rotation: ((ac.heading || 0) * Math.PI) / 180,
        });

        allTexts.push({
          text: ac.callsign || ac.icao, x: pos.x + 8 * dpr, y: pos.y - 4 * dpr,
          color: isSelected ? '#00e676' : 'rgba(0, 230, 118, 0.7)',
          fontSize: (isSelected ? 10 : 9) * dpr,
        });
        if (isSelected && ac.altitude) {
          allTexts.push({
            text: `FL${Math.round(ac.altitude / 100)} ${ac.speed || 0}kts`,
            x: pos.x + 8 * dpr, y: pos.y + 8 * dpr,
            color: 'rgba(0, 230, 118, 0.5)', fontSize: 8 * dpr,
          });
        }
      }
      if (acTrails.length > 0) {
        allTrails.push({ lines: acTrails, color: [0, 0.902, 0.463, 0.3] });
      }
    }

    // Vessels
    if (layers.has('vessels')) {
      const vesTrails: LineData[] = [];
      for (const v of vessels) {
        if (v.latitude === undefined || v.longitude === undefined) continue;
        const pos = toScreen(v.longitude, v.latitude, w, h, cz, cpx, cpy);
        if (pos.x < -100 || pos.x > w + 100 || pos.y < -100 || pos.y > h + 100) continue;
        const isSelected = selectedItem === `v-${v.mmsi}`;

        if (v.trail && v.trail.length > 1) {
          const pts = v.trail.map((t: { lat: number; lon: number }, i: number) => {
            const tp = toScreen(t.lon, t.lat, w, h, cz, cpx, cpy);
            return { x: tp.x, y: tp.y, alpha: (i + 1) / v.trail.length };
          });
          vesTrails.push({ points: pts });
        }

        allMarkers.push({
          x: pos.x, y: pos.y, size: 5 * dpr,
          r: 1, g: 0.671, b: 0, a: isSelected ? 1 : 0.8,
          shape: 2, rotation: ((v.heading || v.cog || 0) * Math.PI) / 180,
        });

        allTexts.push({
          text: v.shipName || String(v.mmsi), x: pos.x + 7 * dpr, y: pos.y - 4 * dpr,
          color: isSelected ? '#ffab00' : 'rgba(255, 171, 0, 0.6)',
          fontSize: (isSelected ? 10 : 8) * dpr,
        });
        if (isSelected) {
          allTexts.push({
            text: `${v.sog?.toFixed(1) || 0} kts → ${v.destination || '?'}`,
            x: pos.x + 7 * dpr, y: pos.y + 8 * dpr,
            color: 'rgba(255, 171, 0, 0.5)', fontSize: 8 * dpr,
          });
        }
      }
      if (vesTrails.length > 0) {
        allTrails.push({ lines: vesTrails, color: [1, 0.671, 0, 0.3] });
      }
    }

    // APRS stations
    if (layers.has('aprs')) {
      for (const st of aprsStations) {
        if (st.latitude === undefined || st.longitude === undefined) continue;
        const pos = toScreen(st.longitude, st.latitude, w, h, cz, cpx, cpy);
        if (pos.x < -50 || pos.x > w + 50 || pos.y < -50 || pos.y > h + 50) continue;
        const isSelected = selectedItem === `aprs-${st.callsign || 'unknown'}`;
        const age = Date.now() - st.lastSeen;
        const alpha = Math.max(0.3, 1 - age / 3600000);

        allMarkers.push({
          x: pos.x, y: pos.y, size: (isSelected ? 5 : 3.5) * dpr,
          r: 1, g: 0.09, b: 0.267, a: isSelected ? 1 : alpha * 0.8,
          shape: 0, rotation: 0,
        });

        // Pulse for recent
        if (age < 30000) {
          const pulse = (time % 2) / 2;
          renderer.renderCircle(pos.x, pos.y, (4 + pulse * 12) * dpr,
            [1, 0.09, 0.267, (1 - pulse) * 0.5]);
        }

        allTexts.push({
          text: st.callsign || 'Unknown', x: pos.x + 7 * dpr, y: pos.y - 3 * dpr,
          color: `rgba(255, 23, 68, ${isSelected ? 1 : alpha * 0.7})`,
          fontSize: (isSelected ? 10 : 8) * dpr,
        });
        if (isSelected && st.comment) {
          allTexts.push({
            text: st.comment, x: pos.x + 7 * dpr, y: pos.y + 8 * dpr,
            color: 'rgba(255, 23, 68, 0.5)', fontSize: 8 * dpr,
          });
        }
      }
    }

    // Render trails
    renderer.enableNormalBlend();
    for (const t of allTrails) {
      renderer.renderLines(t.lines, t.color);
    }

    // Render markers with additive blending for glow
    renderer.enableAdditiveBlend();
    renderer.renderMarkers(allMarkers);
    renderer.enableNormalBlend();

    // Observer label
    allTexts.push({
      text: `📍 ${obsStore.name || `${observer.lat.toFixed(2)}°`}`,
      x: obs.x + 16 * dpr, y: obs.y + 4 * dpr,
      color: '#ffffff', fontSize: 10 * dpr,
    });

    // Render text
    renderer.renderTexts(allTexts);

    // Info panel — rendered as text overlay on a dark quad
    const panelTexts: TextEntry[] = [
      { text: 'GLOBAL OPERATIONS', x: 20 * dpr, y: 30 * dpr, color: '#00e5ff', fontSize: 11 * dpr },
      { text: `🛰️ ${satellites.length} satellites`, x: 20 * dpr, y: 48 * dpr, color: '#6a6a8a', fontSize: 9 * dpr },
      { text: `✈️ ${aircraft.length} aircraft`, x: 20 * dpr, y: 62 * dpr, color: '#6a6a8a', fontSize: 9 * dpr },
      { text: `🚢 ${vessels.length} vessels`, x: 20 * dpr, y: 76 * dpr, color: '#6a6a8a', fontSize: 9 * dpr },
      { text: `📍 ${aprsStations.length} APRS stations`, x: 20 * dpr, y: 90 * dpr, color: '#6a6a8a', fontSize: 9 * dpr },
      { text: `${new Date().toISOString().substring(11, 19)} UTC`, x: 20 * dpr, y: 108 * dpr, color: '#6a6a8a', fontSize: 9 * dpr },
    ];

    // Dark panel background as a filled quad via markers
    const panelBg: MarkerData[] = [{
      x: 110 * dpr, y: 65 * dpr, size: 110 * dpr,
      r: 0.024, g: 0.024, b: 0.063, a: 0.85,
      shape: 2, rotation: 0,
    }];
    renderer.enableNormalBlend();
    renderer.renderMarkers(panelBg);
    renderer.renderTexts(panelTexts);

    animRef.current = requestAnimationFrame(render);
  }, [toScreen, satellites, aircraft, vessels, aprsStations, observer, layers, selectedItem, zoom, pan, obsStore.name]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  // Sync zoom/pan state to refs
  useEffect(() => {
    targetZoomRef.current = zoom;
    targetPanRef.current = { x: pan.x, y: pan.y };
  }, [zoom, pan]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newZoom = Math.max(0.3, Math.min(64, zoom * factor));
    const scale = newZoom / zoom;
    setPan(p => ({
      x: mx - scale * (mx - p.x),
      y: my - scale * (my - p.y),
    }));
    setZoom(newZoom);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };

  const handleMouseUp = () => { dragRef.current.dragging = false; };

  return (
    <div className="h-full w-full relative bg-forge-bg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Pop out */}
      <div className="absolute top-3 right-3 z-20">
        <PopOutButton view="map" />
      </div>

      {/* Search bar */}
      <div className="absolute top-3 left-[220px] flex gap-2 z-10">
        <input
          type="text"
          placeholder="Search satellites..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-forge-bg/90 border border-forge-border rounded px-3 py-1.5 text-xs font-mono text-forge-text placeholder-forge-text-dim w-48 focus:border-forge-cyan/50 focus:outline-none"
        />
      </div>

      {/* Layer toggles */}
      <div className="absolute top-3 right-3 flex gap-1 z-10">
        {([
          { id: 'satellites' as MapLayer, icon: '🛰️', color: '#00e5ff' },
          { id: 'aircraft' as MapLayer, icon: '✈️', color: '#00e676' },
          { id: 'vessels' as MapLayer, icon: '🚢', color: '#ffab00' },
          { id: 'aprs' as MapLayer, icon: '📍', color: '#ff1744' },
        ]).map(l => (
          <button
            key={l.id}
            onClick={() => toggleLayer(l.id)}
            className={`px-2 py-1 rounded text-xs font-mono border transition-all ${
              layers.has(l.id)
                ? 'border-opacity-50 bg-opacity-20'
                : 'border-forge-border bg-forge-bg/80 opacity-40'
            }`}
            style={{ borderColor: layers.has(l.id) ? l.color : undefined, backgroundColor: layers.has(l.id) ? l.color + '15' : undefined }}
          >
            {l.icon}
          </button>
        ))}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
        <button onClick={() => { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; const cx = rect.width/2; const cy = rect.height/2; const newZ = Math.min(64, zoom * 1.3); const s = newZ/zoom; setPan(p => ({ x: cx - s*(cx-p.x), y: cy - s*(cy-p.y) })); setZoom(newZ); }} className="w-7 h-7 bg-forge-bg/90 border border-forge-border rounded text-forge-text-dim hover:text-forge-text text-xs">+</button>
        <button onClick={() => { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; const cx = rect.width/2; const cy = rect.height/2; const newZ = Math.max(0.3, zoom / 1.3); const s = newZ/zoom; setPan(p => ({ x: cx - s*(cx-p.x), y: cy - s*(cy-p.y) })); setZoom(newZ); }} className="w-7 h-7 bg-forge-bg/90 border border-forge-border rounded text-forge-text-dim hover:text-forge-text text-xs">−</button>
        <button onClick={() => { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; const w = rect.width; const h = rect.height; setZoom(4); setPan({ x: w/2 - lonToMercX(-4.63)*w*4, y: h/2 - latToMercY(55.46)*w*4 }); }} className="w-7 h-7 bg-forge-bg/90 border border-forge-border rounded text-forge-text-dim hover:text-forge-text text-[9px]">⌂</button>
      </div>
    </div>
  );
};
