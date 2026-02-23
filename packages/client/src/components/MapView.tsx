import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Aircraft, Vessel, APRSStation, TLE, SatellitePosition } from '@signalforge/shared';
import { useLocationStore } from '../stores/location';
import { PopOutButton } from './ui/PopOutButton';

interface SatWithPos extends TLE {
  position: SatellitePosition;
}

type MapLayer = 'satellites' | 'aircraft' | 'vessels' | 'aprs';

// ── Tile cache for CartoDB dark matter tiles ──
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];
const tileCache = new Map<string, HTMLImageElement>();
const tilePending = new Set<string>();

function getTile(z: number, x: number, y: number): HTMLImageElement | null {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached && cached.complete && cached.naturalWidth > 0) return cached;
  if (tilePending.has(key)) return null;
  tilePending.add(key);
  const s = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
  const url = TILE_URL.replace('{s}', s).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { tileCache.set(key, img); tilePending.delete(key); };
  img.onerror = () => { tilePending.delete(key); };
  img.src = url;
  return null;
}

export const MapView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const [pan, setPan] = useState(() => { const w = window.innerWidth; const h = window.innerHeight; const initZoom = 4; return { x: w/2 - ((-4.63 + 180) / 360) * w * initZoom, y: h/2 - ((90 - 55.46) / 180) * h * initZoom }; });
  const [zoom, setZoom] = useState(4);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; panX: number; panY: number }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 });

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

  // Also listen to WS for real-time updates
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
        } catch { /* ignore binary */ }
      };
    } catch { /* ignore */ }
    return () => ws?.close();
  }, []);

  const lonLatToScreen = useCallback((lon: number, lat: number, width: number, height: number) => ({
    x: ((lon + 180) / 360) * width * zoom + pan.x,
    y: ((90 - lat) / 180) * height * zoom + pan.y,
  }), [zoom, pan]);

  const toggleLayer = (layer: MapLayer) => {
    setLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer); else next.add(layer);
      return next;
    });
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;

    // Background
    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.lineWidth = 0.5;
    for (let lon = -180; lon <= 180; lon += 15) {
      const { x } = lonLatToScreen(lon, 0, w, h);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let lat = -90; lat <= 90; lat += 15) {
      const { y } = lonLatToScreen(0, lat, w, h);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Equator & prime meridian
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
    const eqY = lonLatToScreen(0, 0, w, h).y;
    ctx.beginPath(); ctx.moveTo(0, eqY); ctx.lineTo(w, eqY); ctx.stroke();
    const pmX = lonLatToScreen(0, 0, w, h).x;
    ctx.beginPath(); ctx.moveTo(pmX, 0); ctx.lineTo(pmX, h); ctx.stroke();

    // ── Map tiles (CartoDB dark matter) ──
    {
      // Calculate appropriate zoom level from our zoom factor
      const tileZoom = Math.max(0, Math.min(18, Math.floor(Math.log2(zoom * 2))));
      const numTiles = Math.pow(2, tileZoom);
      const tileSize = 256;

      // Determine visible tile range
      for (let tx = 0; tx < numTiles; tx++) {
        for (let ty = 0; ty < numTiles; ty++) {
          // Tile bounds in lon/lat
          const tileLonMin = (tx / numTiles) * 360 - 180;
          const tileLonMax = ((tx + 1) / numTiles) * 360 - 180;
          // Mercator lat from tile y
          const tileLatMax = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / numTiles))) * 180 / Math.PI;
          const tileLatMin = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + 1) / numTiles))) * 180 / Math.PI;

          const tl = lonLatToScreen(tileLonMin, tileLatMax, w, h);
          const br = lonLatToScreen(tileLonMax, tileLatMin, w, h);

          // Skip tiles completely off screen
          if (br.x < 0 || tl.x > w || br.y < 0 || tl.y > h) continue;

          const tile = getTile(tileZoom, tx, ty);
          if (tile) {
            ctx.globalAlpha = 0.85;
            ctx.drawImage(tile, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    // Observer
    const obs = lonLatToScreen(observer.lon, observer.lat, w, h);
    // Range circles
    for (const r of [200, 500, 1000]) {
      const rPx = (r / (180 * 111)) * h * zoom;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(obs.x, obs.y, rPx, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(obs.x, obs.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(obs.x, obs.y, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px "JetBrains Mono"';
    ctx.fillText(`📍 ${obsStore.name || `${observer.lat.toFixed(2)}°`}`, obs.x + 16, obs.y + 4);

    const time = Date.now() / 1000;

    // Satellites
    if (layers.has('satellites')) {
      for (const sat of satellites) {
        if (!sat.position) continue;
        const pos = lonLatToScreen(sat.position.longitude, sat.position.latitude, w, h);
        const isSelected = selectedItem === `sat-${sat.catalogNumber}`;

        // Footprint
        const footR = Math.sqrt(sat.position.altitude) * 1.2;
        const rPx = (footR / 180) * h * zoom;
        ctx.strokeStyle = isSelected ? 'rgba(0, 229, 255, 0.3)' : 'rgba(0, 229, 255, 0.08)';
        ctx.lineWidth = isSelected ? 1.5 : 0.5;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, rPx, 0, Math.PI * 2); ctx.stroke();

        // Dot
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = isSelected ? 15 : 5;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, isSelected ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Label (only for selected or first 20 or ISS)
        if (isSelected || sat.name.includes('ISS') || satellites.indexOf(sat) < 15) {
          ctx.fillStyle = isSelected ? '#00e5ff' : 'rgba(0, 229, 255, 0.6)';
          ctx.font = `${isSelected ? 10 : 8}px "JetBrains Mono"`;
          ctx.fillText(sat.name.slice(0, 20), pos.x + 6, pos.y - 5);
        }
      }
    }

    // Aircraft
    if (layers.has('aircraft')) {
      for (const ac of aircraft) {
        if (ac.latitude === undefined || ac.longitude === undefined) continue;
        const pos = lonLatToScreen(ac.longitude, ac.latitude, w, h);
        const isSelected = selectedItem === `ac-${ac.icao}`;

        // Trail
        if (ac.trail.length > 1) {
          ctx.strokeStyle = 'rgba(0, 230, 118, 0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < ac.trail.length; i++) {
            const tp = lonLatToScreen(ac.trail[i].lon, ac.trail[i].lat, w, h);
            if (i === 0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y);
          }
          ctx.stroke();
        }

        // Aircraft icon (rotated triangle)
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(((ac.heading || 0) * Math.PI) / 180);
        ctx.fillStyle = isSelected ? '#00e676' : 'rgba(0, 230, 118, 0.8)';
        ctx.shadowColor = '#00e676';
        ctx.shadowBlur = isSelected ? 12 : 4;
        ctx.beginPath();
        ctx.moveTo(0, -6); ctx.lineTo(-4, 4); ctx.lineTo(4, 4); ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();

        // Label
        ctx.fillStyle = isSelected ? '#00e676' : 'rgba(0, 230, 118, 0.7)';
        ctx.font = `${isSelected ? 10 : 9}px "JetBrains Mono"`;
        ctx.fillText(`${ac.callsign || ac.icao}`, pos.x + 8, pos.y - 4);
        if (isSelected && ac.altitude) {
          ctx.fillStyle = 'rgba(0, 230, 118, 0.5)';
          ctx.font = '8px "JetBrains Mono"';
          ctx.fillText(`FL${Math.round(ac.altitude / 100)} ${ac.speed || 0}kts`, pos.x + 8, pos.y + 8);
        }
      }
    }

    // Vessels
    if (layers.has('vessels')) {
      for (const v of vessels) {
        if (v.latitude === undefined || v.longitude === undefined) continue;
        const pos = lonLatToScreen(v.longitude, v.latitude, w, h);
        const isSelected = selectedItem === `v-${v.mmsi}`;

        // Trail
        if (v.trail.length > 1) {
          ctx.strokeStyle = 'rgba(255, 171, 0, 0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < v.trail.length; i++) {
            const tp = lonLatToScreen(v.trail[i].lon, v.trail[i].lat, w, h);
            if (i === 0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y);
          }
          ctx.stroke();
        }

        // Vessel icon (diamond)
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(((v.heading || v.cog || 0) * Math.PI) / 180);
        ctx.fillStyle = isSelected ? '#ffab00' : 'rgba(255, 171, 0, 0.8)';
        ctx.shadowColor = '#ffab00';
        ctx.shadowBlur = isSelected ? 10 : 3;
        ctx.beginPath();
        ctx.moveTo(0, -5); ctx.lineTo(-3, 0); ctx.lineTo(0, 5); ctx.lineTo(3, 0); ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();

        // Label
        ctx.fillStyle = isSelected ? '#ffab00' : 'rgba(255, 171, 0, 0.6)';
        ctx.font = `${isSelected ? 10 : 8}px "JetBrains Mono"`;
        ctx.fillText(v.shipName || v.mmsi, pos.x + 7, pos.y - 4);
        if (isSelected) {
          ctx.fillStyle = 'rgba(255, 171, 0, 0.5)';
          ctx.font = '8px "JetBrains Mono"';
          ctx.fillText(`${v.sog?.toFixed(1) || 0} kts → ${v.destination || '?'}`, pos.x + 7, pos.y + 8);
        }
      }
    }

    // APRS stations
    if (layers.has('aprs')) {
      for (const st of aprsStations) {
        if (st.latitude === undefined || st.longitude === undefined) continue;
        const pos = lonLatToScreen(st.longitude, st.latitude, w, h);
        const isSelected = selectedItem === `aprs-${st.callsign}`;
        const age = Date.now() - st.lastSeen;
        const alpha = Math.max(0.3, 1 - age / 3600000);

        // APRS marker (circle with cross)
        ctx.fillStyle = `rgba(255, 23, 68, ${isSelected ? 1 : alpha * 0.8})`;
        ctx.shadowColor = '#ff1744';
        ctx.shadowBlur = isSelected ? 12 : 4;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, isSelected ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Pulse animation for recent
        if (age < 30000) {
          const pulse = (time % 2) / 2;
          ctx.strokeStyle = `rgba(255, 23, 68, ${(1 - pulse) * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(pos.x, pos.y, 4 + pulse * 12, 0, Math.PI * 2); ctx.stroke();
        }

        // Label
        ctx.fillStyle = `rgba(255, 23, 68, ${isSelected ? 1 : alpha * 0.7})`;
        ctx.font = `${isSelected ? 10 : 8}px "JetBrains Mono"`;
        ctx.fillText(st.callsign, pos.x + 7, pos.y - 3);
        if (isSelected && st.comment) {
          ctx.fillStyle = 'rgba(255, 23, 68, 0.5)';
          ctx.font = '8px "JetBrains Mono"';
          ctx.fillText(st.comment, pos.x + 7, pos.y + 8);
        }
      }
    }

    // Info panel (top-left)
    ctx.fillStyle = 'rgba(6, 6, 16, 0.85)';
    ctx.fillRect(10, 10, 200, 110);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 200, 110);

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 11px "JetBrains Mono"';
    ctx.fillText('GLOBAL OPERATIONS', 20, 30);
    ctx.fillStyle = '#6a6a8a';
    ctx.font = '9px "JetBrains Mono"';
    ctx.fillText(`🛰️ ${satellites.length} satellites`, 20, 48);
    ctx.fillText(`✈️ ${aircraft.length} aircraft`, 20, 62);
    ctx.fillText(`🚢 ${vessels.length} vessels`, 20, 76);
    ctx.fillText(`📍 ${aprsStations.length} APRS stations`, 20, 90);
    ctx.fillText(`${new Date().toISOString().substring(11, 19)} UTC`, 20, 108);

    animRef.current = requestAnimationFrame(render);
  }, [lonLatToScreen, satellites, aircraft, vessels, aprsStations, observer, layers, selectedItem, zoom, pan]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

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
        <button onClick={() => { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; const w = rect.width; const h = rect.height; setZoom(4); setPan({ x: w/2 - ((-4.63+180)/360)*w*4, y: h/2 - ((90-55.46)/180)*h*4 }); }} className="w-7 h-7 bg-forge-bg/90 border border-forge-border rounded text-forge-text-dim hover:text-forge-text text-[9px]">⌂</button>
      </div>
    </div>
  );
};
