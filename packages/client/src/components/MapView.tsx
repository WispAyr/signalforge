import React, { useRef, useEffect, useCallback, useState } from 'react';

interface SatelliteMarker {
  name: string;
  lat: number;
  lon: number;
  alt: number;
  color: string;
}

/**
 * Map view with satellite tracking, aircraft positions, and ground station.
 * Uses Canvas for rendering (MapLibre GL integration planned).
 */
export const MapView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [observer] = useState({ lat: 51.5074, lon: -0.1278 }); // London

  // Demo satellites that orbit
  const getSatellites = useCallback((): SatelliteMarker[] => {
    const t = Date.now() / 1000;
    return [
      { name: 'ISS', lat: 30 * Math.sin(t * 0.02), lon: ((t * 4) % 360) - 180, alt: 408, color: '#00e5ff' },
      { name: 'NOAA-18', lat: 80 * Math.sin(t * 0.015 + 1), lon: ((t * 3.8 + 90) % 360) - 180, alt: 854, color: '#00e676' },
      { name: 'NOAA-19', lat: 80 * Math.sin(t * 0.014 + 2), lon: ((t * 3.6 + 180) % 360) - 180, alt: 870, color: '#ffab00' },
      { name: 'METEOR-M2', lat: 80 * Math.sin(t * 0.013 + 3), lon: ((t * 3.5 + 270) % 360) - 180, alt: 830, color: '#ff1744' },
    ];
  }, []);

  const lonLatToScreen = (lon: number, lat: number, width: number, height: number) => ({
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  });

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

    const w = rect.width;
    const h = rect.height;

    // Dark background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // Simple world map grid
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.06)';
    ctx.lineWidth = 0.5;

    // Longitude lines
    for (let lon = -180; lon <= 180; lon += 30) {
      const { x } = lonLatToScreen(lon, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Latitude lines
    for (let lat = -90; lat <= 90; lat += 30) {
      const { y } = lonLatToScreen(0, lat, w, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Equator
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    const eqY = lonLatToScreen(0, 0, w, h).y;
    ctx.beginPath();
    ctx.moveTo(0, eqY);
    ctx.lineTo(w, eqY);
    ctx.stroke();

    // Simple continent outlines (simplified rectangles for now)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.lineWidth = 1;
    const continents = [
      // rough bounding boxes: [lonMin, latMin, lonMax, latMax]
      [-130, 25, -60, 50],   // N America
      [-80, -55, -35, 10],   // S America
      [-10, 35, 40, 70],     // Europe
      [-20, -35, 50, 35],    // Africa
      [60, 5, 140, 55],      // Asia
      [110, -45, 155, -10],  // Australia
    ];

    for (const [lonMin, latMin, lonMax, latMax] of continents) {
      const tl = lonLatToScreen(lonMin, latMax, w, h);
      const br = lonLatToScreen(lonMax, latMin, w, h);
      ctx.fillStyle = 'rgba(0, 229, 255, 0.03)';
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    // Observer position
    const obs = lonLatToScreen(observer.lon, observer.lat, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(obs.x, obs.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(obs.x, obs.y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px "JetBrains Mono"';
    ctx.fillText('📍 Observer', obs.x + 8, obs.y - 8);

    // Satellites
    const sats = getSatellites();
    for (const sat of sats) {
      const pos = lonLatToScreen(sat.lon, sat.lat, w, h);

      // Footprint circle (simplified)
      const footprintRadius = Math.sqrt(sat.alt) * 1.5;
      const rPx = (footprintRadius / 180) * h;
      ctx.strokeStyle = sat.color + '30';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = sat.color + '08';
      ctx.fill();

      // Satellite dot
      ctx.fillStyle = sat.color;
      ctx.shadowColor = sat.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = sat.color;
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(`🛰️ ${sat.name}`, pos.x + 8, pos.y - 8);
      ctx.fillStyle = sat.color + '80';
      ctx.font = '9px "JetBrains Mono"';
      ctx.fillText(`${sat.alt} km`, pos.x + 8, pos.y + 4);
    }

    // Info overlay
    ctx.fillStyle = 'rgba(10, 10, 15, 0.8)';
    ctx.fillRect(10, 10, 180, 80);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 180, 80);

    ctx.fillStyle = '#00e5ff';
    ctx.font = '11px "JetBrains Mono"';
    ctx.fillText('SATELLITE TRACKER', 20, 30);
    ctx.fillStyle = '#6a6a8a';
    ctx.font = '9px "JetBrains Mono"';
    ctx.fillText(`Tracking: ${sats.length} satellites`, 20, 48);
    ctx.fillText(`Observer: ${observer.lat.toFixed(2)}°N ${Math.abs(observer.lon).toFixed(2)}°W`, 20, 62);
    ctx.fillText(`${new Date().toISOString().substring(11, 19)} UTC`, 20, 76);

    animRef.current = requestAnimationFrame(render);
  }, [getSatellites, observer]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  return (
    <div className="h-full w-full relative bg-forge-bg">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
