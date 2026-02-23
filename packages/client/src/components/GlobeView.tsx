import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import GlobeGL, { type GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import type { GlobeConfig, Aircraft, Vessel, TLE, SatellitePosition } from '@signalforge/shared';
import { useLocationStore } from '../stores/location';

interface SatWithPos extends TLE { position: SatellitePosition }

interface GlobePoint {
  lat: number;
  lng: number;
  alt: number;
  color: string;
  size: number;
  label: string;
  type: 'satellite' | 'aircraft' | 'vessel' | 'edge-node' | 'observer';
  id: string;
  data?: any;
}

interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string | [string, string];
  stroke: number;
  altitude: number;
  label?: string;
}

const EARTH_RADIUS_KM = 6371;

export const GlobeView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
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
  const [selectedItem, setSelectedItem] = useState<GlobePoint | null>(null);
  const [is3D, setIs3D] = useState(true);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [satRes, acRes, vesRes] = await Promise.all([
          fetch('/api/satellites/positions?limit=200'),
          fetch('/api/aircraft'),
          fetch('/api/vessels'),
        ]);
        if (satRes.ok) setSatellites(await satRes.json());
        if (acRes.ok) setAircraft(await acRes.json());
        if (vesRes.ok) setVessels(await vesRes.json());
      } catch { /* offline OK */ }
    };
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => clearInterval(iv);
  }, []);

  // Build point data
  const pointsData = useMemo(() => {
    const points: GlobePoint[] = [];

    // Observer
    points.push({
      lat: observer.lat, lng: observer.lon, alt: 0.01,
      color: '#ffd700', size: 1.2, label: 'YOU — Observer',
      type: 'observer', id: 'observer',
    });

    // Satellites
    if (config.showSatellites) {
      satellites.slice(0, 200).forEach(sat => {
        if (sat.position) {
          points.push({
            lat: sat.position.latitude, lng: sat.position.longitude,
            alt: (sat.position.altitude || 400) / EARTH_RADIUS_KM,
            color: '#00f0ff', size: 0.4,
            label: `🛰️ ${sat.name}\n${sat.position.altitude?.toFixed(0) ?? '?'} km alt`,
            type: 'satellite', id: `sat-${sat.catalogNumber}`, data: sat,
          });
        }
      });
    }

    // Aircraft
    if (config.showAircraft) {
      aircraft.forEach(ac => {
        if (ac.latitude == null || ac.longitude == null) return;
        points.push({
          lat: ac.latitude, lng: ac.longitude,
          alt: ((ac.altitude ?? 10000) * 0.3048) / EARTH_RADIUS_KM / 1000,
          color: '#ff6b35', size: 0.5,
          label: `✈️ ${ac.callsign || ac.icao}\n${ac.altitude ? `FL${Math.round(ac.altitude / 100)}` : ''}`,
          type: 'aircraft', id: `ac-${ac.icao}`, data: ac,
        });
      });
    }

    // Vessels
    if (config.showVessels) {
      vessels.forEach(v => {
        if (v.latitude == null || v.longitude == null) return;
        points.push({
          lat: v.latitude, lng: v.longitude, alt: 0,
          color: '#4ecdc4', size: 0.5,
          label: `🚢 ${v.shipName || v.mmsi}\n${v.shipTypeName || 'Unknown type'}`,
          type: 'vessel', id: `ves-${v.mmsi}`, data: v,
        });
      });
    }

    return points;
  }, [satellites, aircraft, vessels, observer, config]);

  // Build arcs for satellite orbits & aircraft trails
  const arcsData = useMemo(() => {
    const arcs: GlobeArc[] = [];

    if (config.showOrbits && config.showSatellites) {
      satellites.slice(0, 50).forEach(sat => {
        if (!sat.position) return;
        const alt = (sat.position.altitude || 400) / EARTH_RADIUS_KM;
        const offsetLng = 40;
        arcs.push({
          startLat: sat.position.latitude,
          startLng: sat.position.longitude - offsetLng,
          endLat: sat.position.latitude + (Math.random() - 0.5) * 20,
          endLng: sat.position.longitude + offsetLng,
          color: ['rgba(0,240,255,0.6)', 'rgba(0,240,255,0.05)'],
          stroke: 0.4,
          altitude: alt,
        });
      });
    }

    // Aircraft trails
    if (config.showAircraft) {
      aircraft.forEach(ac => {
        if (ac.heading == null || ac.latitude == null || ac.longitude == null) return;
        const trailLen = 2;
        const rad = (ac.heading * Math.PI) / 180;
        arcs.push({
          startLat: ac.latitude - Math.cos(rad) * trailLen,
          startLng: ac.longitude - Math.sin(rad) * trailLen,
          endLat: ac.latitude,
          endLng: ac.longitude,
          color: ['rgba(255,107,53,0.05)', 'rgba(255,107,53,0.5)'],
          stroke: 0.6,
          altitude: ((ac.altitude ?? 10000) * 0.3048) / EARTH_RADIUS_KM / 1000,
        });
      });
    }

    return arcs;
  }, [satellites, aircraft, config]);

  // Satellite footprints as rings
  const ringsData = useMemo(() => {
    if (!config.showFootprints || !config.showSatellites) return [];
    return satellites.slice(0, 30).filter(s => s.position).map(sat => ({
      lat: sat.position.latitude,
      lng: sat.position.longitude,
      maxR: Math.min(15, (sat.position.altitude || 400) / 50),
      propagationSpeed: 2,
      repeatPeriod: 2000,
      color: () => 'rgba(0,240,255,0.15)',
    }));
  }, [satellites, config]);

  // Initialize globe
  useEffect(() => {
    if (!containerRef.current || !is3D) return;

    const globe = new GlobeGL(containerRef.current);
    globeRef.current = globe;

    // Configure globe appearance
    globe
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(config.showAtmosphere)
      .atmosphereColor('#00f0ff')
      .atmosphereAltitude(0.25)
      .width(containerRef.current.clientWidth)
      .height(containerRef.current.clientHeight);

    // Points layer
    globe
      .pointsData(pointsData)
      .pointLat('lat')
      .pointLng('lng')
      .pointAltitude('alt')
      .pointColor('color')
      .pointRadius('size')
      .pointLabel((d: object) => {
        const p = d as GlobePoint;
        return `<div style="background:rgba(0,0,0,0.85);border:1px solid ${p.color};padding:8px 12px;border-radius:8px;font-family:monospace;font-size:12px;color:#fff;white-space:pre-line;backdrop-filter:blur(10px)">${p.label}</div>`;
      })
      .onPointClick((point: object) => {
        const p = point as GlobePoint;
        setSelectedItem(p);
        globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: p.type === 'satellite' ? 2.5 : 1.5 }, 1000);
      });

    // Arcs layer
    globe
      .arcsData(arcsData)
      .arcStartLat('startLat')
      .arcStartLng('startLng')
      .arcEndLat('endLat')
      .arcEndLng('endLng')
      .arcColor('color')
      .arcStroke('stroke')
      .arcAltitude('altitude')
      .arcDashLength(0.4)
      .arcDashGap(0.2)
      .arcDashAnimateTime(2000);

    // Rings layer
    globe
      .ringsData(ringsData)
      .ringLat('lat')
      .ringLng('lng')
      .ringMaxRadius('maxR')
      .ringPropagationSpeed('propagationSpeed')
      .ringRepeatPeriod('repeatPeriod')
      .ringColor('color');

    // Auto-rotate
    const controls = globe.controls() as any;
    if (controls) {
      controls.autoRotate = config.autoRotate;
      controls.autoRotateSpeed = 0.5;
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
    }

    // Initial camera
    globe.pointOfView({ lat: observer.lat, lng: observer.lon, altitude: 2.5 });

    // Starfield particles
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 2000;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.5, transparent: true, opacity: 0.8, sizeAttenuation: true,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    globe.scene().add(stars);

    // Resize
    const handleResize = () => {
      if (containerRef.current) {
        globe.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    // Pulse animation
    let animFrame: number;
    const animate = () => {
      const t = Date.now() * 0.001;
      globe.pointRadius((d: object) => {
        const p = d as GlobePoint;
        if (p.type === 'satellite') return 0.3 + Math.sin(t * 3 + p.lat) * 0.15;
        if (p.type === 'observer') return 1.0 + Math.sin(t * 2) * 0.3;
        if (p.type === 'edge-node') return 0.7 + Math.sin(t * 2.5) * 0.2;
        return p.size;
      });
      animFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener('resize', handleResize);
      globe._destructor();
    };
  }, [is3D]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update data without re-init
  useEffect(() => { globeRef.current?.pointsData(pointsData); }, [pointsData]);
  useEffect(() => { globeRef.current?.arcsData(arcsData); }, [arcsData]);
  useEffect(() => { globeRef.current?.ringsData(ringsData); }, [ringsData]);
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.showAtmosphere(config.showAtmosphere);
    const controls = globe.controls() as any;
    if (controls) controls.autoRotate = config.autoRotate;
  }, [config.showAtmosphere, config.autoRotate]);

  const toggleConfig = useCallback((key: keyof GlobeConfig) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] } as GlobeConfig));
  }, []);

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-forge-border bg-black/80 backdrop-blur-sm z-10">
        <span className="text-cyan-400 font-mono text-sm font-bold">🌍 3D GLOBE</span>
        <div className="flex-1" />
        {(['showSatellites', 'showAircraft', 'showVessels', 'showEdgeNodes', 'showDayNight', 'showOrbits', 'showAtmosphere', 'showFootprints'] as const).map(key => (
          <button key={key} onClick={() => toggleConfig(key)}
            className={`px-2 py-0.5 rounded text-xs font-mono transition-all ${config[key] ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-forge-bg text-gray-500 border border-forge-border'}`}>
            {key.replace('show', '').replace(/([A-Z])/g, ' $1').trim()}
          </button>
        ))}
        <button onClick={() => toggleConfig('autoRotate')}
          className={`px-2 py-0.5 rounded text-xs font-mono transition-all ${config.autoRotate ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-forge-bg text-gray-500 border border-forge-border'}`}>
          🔄 Auto-Rotate
        </button>
        <button onClick={() => setIs3D(prev => !prev)}
          className="px-2 py-0.5 rounded text-xs font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-all">
          {is3D ? '📍 2D Map' : '🌍 3D Globe'}
        </button>
      </div>

      {/* Globe Container */}
      <div className="flex-1 relative">
        {is3D ? (
          <div ref={containerRef} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 font-mono">
            <p>2D Map view — switch to MapView component</p>
          </div>
        )}

        {/* Selected item info panel */}
        {selectedItem && (
          <div className="absolute top-4 right-4 w-80 bg-black/90 border border-cyan-500/30 rounded-lg p-4 backdrop-blur-md z-20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-cyan-400 font-mono text-sm font-bold">
                {selectedItem.type === 'satellite' && '🛰️'}
                {selectedItem.type === 'aircraft' && '✈️'}
                {selectedItem.type === 'vessel' && '🚢'}
                {selectedItem.type === 'observer' && '📍'}
                {selectedItem.type === 'edge-node' && '🟢'}
                {' '}{selectedItem.label.split('\n')[0]}
              </h3>
              <button onClick={() => setSelectedItem(null)} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="space-y-1 text-xs font-mono text-gray-300">
              <p>Lat: <span className="text-cyan-400">{selectedItem.lat.toFixed(4)}°</span></p>
              <p>Lon: <span className="text-cyan-400">{selectedItem.lng.toFixed(4)}°</span></p>
              {selectedItem.alt > 0.001 && (
                <p>Alt: <span className="text-cyan-400">{(selectedItem.alt * EARTH_RADIUS_KM).toFixed(0)} km</span></p>
              )}
              {selectedItem.data?.catalogNumber && (
                <p>NORAD: <span className="text-cyan-400">{selectedItem.data.catalogNumber}</span></p>
              )}
              {selectedItem.data?.callsign && (
                <p>Callsign: <span className="text-cyan-400">{selectedItem.data.callsign}</span></p>
              )}
              {selectedItem.data?.speed !== undefined && (
                <p>Speed: <span className="text-cyan-400">{selectedItem.data.speed} kn</span></p>
              )}
            </div>
            <button
              onClick={() => {
                globeRef.current?.pointOfView({ lat: selectedItem.lat, lng: selectedItem.lng, altitude: 1.5 }, 1500);
              }}
              className="mt-3 w-full py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-xs font-mono hover:bg-cyan-500/30 transition-all">
              🎯 Focus Camera
            </button>
          </div>
        )}

        {/* Stats overlay */}
        <div className="absolute bottom-4 left-4 bg-black/80 border border-cyan-500/20 rounded-lg px-3 py-2 backdrop-blur-md z-10">
          <div className="flex gap-4 text-xs font-mono">
            <span className="text-cyan-400">🛰️ {satellites.length}</span>
            <span className="text-orange-400">✈️ {aircraft.length}</span>
            <span className="text-teal-400">🚢 {vessels.length}</span>
            <span className="text-amber-400">📍 {observer.lat.toFixed(2)}°, {observer.lon.toFixed(2)}°</span>
          </div>
        </div>
      </div>
    </div>
  );
};
