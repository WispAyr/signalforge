import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { GlobeConfig, Aircraft, Vessel, TLE, SatellitePosition } from '@signalforge/shared';
import { useLocationStore } from '../stores/location';

interface SatWithPos extends TLE { position: SatellitePosition }

export const GlobeView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const { observer: obsStore } = useLocationStore();
  const observer = { lat: obsStore.latitude, lon: obsStore.longitude };

  const [config, setConfig] = useState<GlobeConfig>({
    showSatellites: true, showAircraft: true, showVessels: true, showEdgeNodes: true,
    showDayNight: true, showAtmosphere: true, showFootprints: true, showOrbits: true,
    showGroundStations: true, autoRotate: true, darkMode: true, textureSet: 'dark',
  });

  const [satellites, setSatellites] = useState<SatWithPos[]>([]);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [rotation, setRotation] = useState({ x: 0.4, y: 0, z: 0 });
  const [zoom, setZoom] = useState(1);
  const [is3D, setIs3D] = useState(true);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, rotX: 0, rotY: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [satRes, acRes, vesRes] = await Promise.all([
          fetch('/api/satellites/positions?limit=60'),
          fetch('/api/aircraft'),
          fetch('/api/vessels'),
        ]);
        setSatellites(await satRes.json());
        setAircraft(await acRes.json());
        setVessels(await vesRes.json());
      } catch {}
    };
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => clearInterval(iv);
  }, []);

  const latLonTo3D = useCallback((lat: number, lon: number, radius: number, alt = 0): [number, number, number] => {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    const r = radius + alt;
    return [
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    ];
  }, []);

  const project3D = useCallback((x: number, y: number, z: number, cx: number, cy: number): [number, number, number] => {
    // Rotate around Y axis
    const cosY = Math.cos(rotation.y); const sinY = Math.sin(rotation.y);
    let x1 = x * cosY - z * sinY;
    let z1 = x * sinY + z * cosY;
    // Rotate around X axis
    const cosX = Math.cos(rotation.x); const sinX = Math.sin(rotation.x);
    let y1 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;
    // Perspective
    const fov = 600 * zoom;
    const scale = fov / (fov + z2);
    return [cx + x1 * scale, cy + y1 * scale, z2];
  }, [rotation, zoom]);

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
      const cx = cw / 2; const cy = ch / 2;
      const R = Math.min(cx, cy) * 0.6;

      // Background — deep space
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
      bgGrad.addColorStop(0, '#0a0a1a');
      bgGrad.addColorStop(1, '#000005');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, cw, ch);

      // Stars
      for (let i = 0; i < 200; i++) {
        const sx = ((i * 7919 + i * i * 31) % cw);
        const sy = ((i * 6271 + i * i * 17) % ch);
        const brightness = 0.3 + Math.sin(Date.now() * 0.001 + i) * 0.2;
        ctx.fillStyle = `rgba(255,255,255,${brightness})`;
        ctx.fillRect(sx, sy, 1, 1);
      }

      // Atmospheric glow
      if (config.showAtmosphere) {
        const glowGrad = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.15);
        glowGrad.addColorStop(0, 'rgba(0,150,255,0.15)');
        glowGrad.addColorStop(0.5, 'rgba(0,100,255,0.08)');
        glowGrad.addColorStop(1, 'rgba(0,50,255,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2);
        ctx.fill();
      }

      // Earth sphere
      const earthGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R);
      earthGrad.addColorStop(0, '#1a3a5c');
      earthGrad.addColorStop(0.3, '#0d2847');
      earthGrad.addColorStop(0.7, '#081830');
      earthGrad.addColorStop(1, '#040c18');
      ctx.fillStyle = earthGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // Grid lines (latitude/longitude)
      ctx.strokeStyle = 'rgba(0,200,255,0.08)';
      ctx.lineWidth = 0.5;
      for (let lat = -80; lat <= 80; lat += 20) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 5) {
          const [x3, y3, z3] = latLonTo3D(lat, lon, R);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.3) {
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 5) {
          const [x3, y3, z3] = latLonTo3D(lat, lon, R);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.3) {
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }

      // Coastline approximation (major continents as simplified polylines)
      ctx.strokeStyle = 'rgba(0,229,255,0.3)';
      ctx.lineWidth = 1;
      const continents: Array<Array<[number, number]>> = [
        // Europe simplified
        [[-10,35],[0,36],[3,37],[5,43],[2,47],[-5,48],[5,51],[10,54],[12,56],[15,55],[20,55],[25,60],[30,60],[30,55],[25,50],[20,47],[15,47],[10,45],[12,42],[15,38],[10,35],[0,35],[-10,35]],
        // Africa simplified
        [[-17,15],[-15,10],[-10,5],[-5,5],[5,4],[10,2],[12,5],[15,10],[20,15],[25,20],[32,30],[35,32],[32,20],[35,12],[40,5],[42,0],[40,-5],[35,-10],[30,-15],[25,-20],[20,-25],[18,-30],[20,-35],[25,-34],[30,-30],[32,-28],[35,-25],[40,-20],[45,-15],[50,-12],[42,-12],[35,-20],[28,-33],[20,-34],[15,-30],[12,-25],[10,-20],[8,-10],[5,-5],[2,5],[-5,5],[-10,5],[-17,15]],
        // North America simplified
        [[-170,65],[-165,62],[-150,60],[-140,60],[-130,55],[-125,50],[-125,40],[-120,35],[-115,32],[-110,30],[-105,25],[-100,20],[-95,18],[-90,20],[-85,15],[-80,10],[-80,25],[-82,28],[-85,30],[-90,30],[-95,28],[-98,26],[-97,28],[-95,30],[-90,30],[-85,35],[-80,33],[-78,35],[-75,38],[-72,41],[-70,42],[-67,45],[-65,47],[-60,47],[-55,50],[-60,55],[-65,60],[-70,63],[-80,65],[-90,65],[-100,65],[-110,68],[-130,70],[-145,65],[-170,65]],
        // South America simplified  
        [[-80,10],[-75,12],[-70,12],[-65,10],[-60,5],[-55,3],[-50,0],[-50,-5],[-45,-10],[-40,-15],[-38,-20],[-40,-23],[-45,-25],[-48,-28],[-50,-30],[-52,-33],[-55,-35],[-58,-38],[-65,-40],[-68,-45],[-70,-50],[-75,-52],[-72,-48],[-73,-42],[-72,-35],[-70,-30],[-70,-25],[-75,-15],[-78,-5],[-80,0],[-78,5],[-80,10]],
        // Australia simplified
        [[115,-35],[117,-33],[120,-34],[125,-33],[128,-32],[130,-15],[135,-12],[137,-13],[140,-17],[142,-12],[145,-15],[148,-18],[150,-22],[152,-25],[153,-28],[152,-32],[150,-35],[148,-38],[145,-38],[140,-37],[135,-35],[130,-33],[125,-34],[120,-34],[115,-35]],
      ];
      for (const cont of continents) {
        ctx.beginPath();
        let started = false;
        for (const [lon, lat] of cont) {
          const [x3, y3, z3] = latLonTo3D(lat, lon, R);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.1) {
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
          } else { started = false; }
        }
        ctx.stroke();
      }

      // Day/night terminator
      if (config.showDayNight) {
        const now = new Date();
        const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
        const declination = -23.44 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));
        const hourAngle = (now.getUTCHours() + now.getUTCMinutes() / 60) / 24 * 360 - 180;

        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        let firstPoint = true;
        for (let lon = -180; lon <= 180; lon += 3) {
          const terminatorLat = Math.atan(-Math.cos((lon + hourAngle) * Math.PI / 180) / Math.tan(declination * Math.PI / 180)) * 180 / Math.PI;
          const [x3, y3, z3] = latLonTo3D(terminatorLat, lon, R * 0.99);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.5) {
            if (firstPoint) { ctx.moveTo(px, py); firstPoint = false; }
            else ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }

      // Observer position
      {
        const [x3, y3, z3] = latLonTo3D(observer.lat, observer.lon, R);
        const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
        if (pz > -R * 0.3) {
          ctx.fillStyle = '#00ff88';
          ctx.shadowColor = '#00ff88';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff';
          ctx.font = '9px monospace';
          ctx.fillText('📍 YOU', px + 8, py + 3);
        }
      }

      // Satellites
      if (config.showSatellites) {
        for (const sat of satellites) {
          if (!sat.position) continue;
          const altScale = (sat.position.altitude || 400) / 6371 * R;
          const [x3, y3, z3] = latLonTo3D(sat.position.latitude, sat.position.longitude, R, altScale);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.5) {
            // Orbit ring hint
            if (config.showOrbits) {
              ctx.strokeStyle = 'rgba(255,200,0,0.1)';
              ctx.lineWidth = 0.5;
              ctx.beginPath();
              for (let a = 0; a < 360; a += 10) {
                const oLat = sat.position.latitude + Math.sin(a * Math.PI / 180) * 20;
                const oLon = sat.position.longitude + Math.cos(a * Math.PI / 180) * 20;
                const [ox, oy, oz] = latLonTo3D(oLat, oLon, R, altScale);
                const [opx, opy] = project3D(ox, oy, oz, cx, cy);
                if (a === 0) ctx.moveTo(opx, opy);
                else ctx.lineTo(opx, opy);
              }
              ctx.stroke();
            }

            // Footprint cone
            if (config.showFootprints) {
              ctx.strokeStyle = 'rgba(255,200,0,0.15)';
              ctx.lineWidth = 0.5;
              const [gx, gy, gz] = latLonTo3D(sat.position.latitude, sat.position.longitude, R);
              const [gpx, gpy] = project3D(gx, gy, gz, cx, cy);
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(gpx, gpy);
              ctx.stroke();
            }

            const selected = selectedItem === sat.name;
            ctx.fillStyle = selected ? '#ffab00' : '#ffd600';
            ctx.shadowColor = '#ffd600';
            ctx.shadowBlur = selected ? 12 : 6;
            ctx.beginPath();
            ctx.arc(px, py, selected ? 4 : 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '7px monospace';
            ctx.fillText(sat.name?.substring(0, 12) || '???', px + 6, py - 4);
          }
        }
      }

      // Aircraft
      if (config.showAircraft) {
        for (const ac of aircraft) {
          if (ac.latitude == null || ac.longitude == null) continue;
          const [x3, y3, z3] = latLonTo3D(ac.latitude, ac.longitude, R, 2);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.3) {
            ctx.fillStyle = '#00e5ff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 4;
            ctx.font = '10px sans-serif';
            ctx.fillText('✈', px - 5, py + 4);
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(0,229,255,0.7)';
            ctx.font = '7px monospace';
            ctx.fillText(ac.callsign || ac.icao, px + 8, py + 3);
          }
        }
      }

      // Vessels
      if (config.showVessels) {
        for (const v of vessels) {
          if (v.latitude == null || v.longitude == null) continue;
          const [x3, y3, z3] = latLonTo3D(v.latitude, v.longitude, R);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.3) {
            ctx.fillStyle = '#00e676';
            ctx.font = '8px sans-serif';
            ctx.fillText('🚢', px - 4, py + 4);
          }
        }
      }

      // Edge nodes
      if (config.showEdgeNodes) {
        // Demo nodes
        const nodes = [
          { lat: 51.5, lon: -0.1, name: 'London HQ' },
          { lat: 55.95, lon: -3.19, name: 'Edinburgh' },
          { lat: 53.48, lon: -2.24, name: 'Manchester' },
        ];
        for (const node of nodes) {
          const [x3, y3, z3] = latLonTo3D(node.lat, node.lon, R);
          const [px, py, pz] = project3D(x3, y3, z3, cx, cy);
          if (pz > -R * 0.3) {
            // Pulsing glow
            const pulse = 0.5 + Math.sin(Date.now() * 0.003) * 0.3;
            ctx.fillStyle = `rgba(0,255,136,${pulse})`;
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#00ff88';
            ctx.font = '7px monospace';
            ctx.fillText(node.name, px + 7, py + 3);
          }
        }
      }

      // Title overlay
      ctx.fillStyle = 'rgba(0,229,255,0.8)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('🌍 SIGNALFORGE GLOBE', 15, 25);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '9px monospace';
      ctx.fillText(`SAT: ${satellites.length}  AC: ${aircraft.length}  VES: ${vessels.length}`, 15, 40);
      ctx.fillText(`Zoom: ${zoom.toFixed(1)}x  Rot: ${(rotation.y * 180 / Math.PI).toFixed(0)}°`, 15, 52);

      // Auto-rotate
      if (config.autoRotate && !dragRef.current.dragging) {
        setRotation(prev => ({ ...prev, y: prev.y + 0.002 }));
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [satellites, aircraft, vessels, config, rotation, zoom, observer, selectedItem, latLonTo3D, project3D]);

  // Mouse interaction
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, rotX: rotation.x, rotY: rotation.y };
  }, [rotation]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = (e.clientX - dragRef.current.startX) * 0.005;
    const dy = (e.clientY - dragRef.current.startY) * 0.005;
    setRotation({ x: dragRef.current.rotX + dy, y: dragRef.current.rotY + dx, z: 0 });
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current.dragging = false; }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(prev => Math.max(0.3, Math.min(5, prev - e.deltaY * 0.001)));
  }, []);

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">🌍 3D GLOBE</span>
        <div className="flex-1" />
        {(['showSatellites', 'showAircraft', 'showVessels', 'showEdgeNodes', 'showDayNight', 'showOrbits', 'showAtmosphere'] as const).map(key => (
          <button key={key} onClick={() => setConfig(prev => ({ ...prev, [key]: !prev[key] }))}
            className={`px-2 py-0.5 rounded text-xs font-mono ${config[key] ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-forge-bg text-gray-500 border border-forge-border'}`}>
            {key.replace('show', '').replace(/([A-Z])/g, ' $1').trim()}
          </button>
        ))}
        <button onClick={() => setConfig(prev => ({ ...prev, autoRotate: !prev.autoRotate }))}
          className={`px-2 py-0.5 rounded text-xs font-mono ${config.autoRotate ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-forge-bg text-gray-500 border border-forge-border'}`}>
          Auto-Rotate
        </button>
      </div>

      {/* Globe Canvas */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          onWheel={handleWheel} />
      </div>
    </div>
  );
};
