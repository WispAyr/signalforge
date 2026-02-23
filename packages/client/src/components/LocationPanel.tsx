import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../stores/location';
import type { LocationSource } from '@signalforge/shared';

const SOURCES: { id: LocationSource; label: string; icon: string; desc: string }[] = [
  { id: 'manual', label: 'Manual', icon: '✏️', desc: 'Type coordinates or place name' },
  { id: 'browser', label: 'Browser GPS', icon: '🌐', desc: 'navigator.geolocation' },
  { id: 'gps', label: 'Hardware GPS', icon: '🛰️', desc: 'Serial NMEA / gpsd' },
  { id: 'starlink', label: 'Starlink', icon: '📡', desc: 'Dish GPS via API' },
  { id: 'auto', label: 'Auto', icon: '🔄', desc: 'Try all sources' },
];

interface LocationPanelProps {
  onClose: () => void;
}

export const LocationPanel: React.FC<LocationPanelProps> = ({ onClose }) => {
  const { observer, settings, loaded, fetchSettings, setManualLocation, setSource, updateSettings, useBrowserGPS } = useLocationStore();

  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [manualAlt, setManualAlt] = useState('');
  const [manualName, setManualName] = useState('');
  const [placeSearch, setPlaceSearch] = useState('');
  const [gpsdHost, setGpsdHost] = useState('127.0.0.1');
  const [gpsdPort, setGpsdPort] = useState('2947');
  const [starlinkHost, setStarlinkHost] = useState('192.168.100.1');

  useEffect(() => {
    if (!loaded) fetchSettings();
  }, [loaded, fetchSettings]);

  useEffect(() => {
    if (loaded) {
      setManualLat(observer.latitude.toFixed(6));
      setManualLon(observer.longitude.toFixed(6));
      setManualAlt(observer.altitude.toString());
      setManualName(observer.name || '');
      if (settings.gps.gpsdHost) setGpsdHost(settings.gps.gpsdHost);
      if (settings.gps.gpsdPort) setGpsdPort(settings.gps.gpsdPort.toString());
      if (settings.starlink.host) setStarlinkHost(settings.starlink.host);
    }
  }, [loaded, observer, settings]);

  const handleManualSave = () => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    const alt = parseFloat(manualAlt) || 0;
    if (isNaN(lat) || isNaN(lon)) return;
    setManualLocation(lat, lon, alt, manualName || undefined);
  };

  const handlePlaceSearch = async () => {
    if (!placeSearch.trim()) return;
    try {
      // Use Nominatim for geocoding
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeSearch)}&format=json&limit=1`, {
        headers: { 'User-Agent': 'SignalForge/0.2' },
      });
      const results = await res.json();
      if (results.length > 0) {
        const r = results[0];
        setManualLat(parseFloat(r.lat).toFixed(6));
        setManualLon(parseFloat(r.lon).toFixed(6));
        setManualName(r.display_name.split(',').slice(0, 2).join(','));
      }
    } catch { /* ignore */ }
  };

  const handleGPSConfig = () => {
    updateSettings({
      source: 'gps',
      gps: {
        enabled: true,
        type: 'gpsd',
        gpsdHost: gpsdHost,
        gpsdPort: parseInt(gpsdPort) || 2947,
      },
    });
  };

  const handleStarlinkConfig = () => {
    updateSettings({
      source: 'starlink',
      starlink: {
        enabled: true,
        host: starlinkHost,
        pollIntervalMs: 30000,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] max-h-[80vh] overflow-y-auto panel-border rounded-lg bg-forge-surface p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg tracking-wider text-forge-cyan">📍 OBSERVER LOCATION</h2>
          <button onClick={onClose} className="text-forge-text-dim hover:text-forge-text text-lg">✕</button>
        </div>

        {/* Current location */}
        <div className="bg-forge-bg rounded-lg p-3 border border-forge-border">
          <div className="text-[10px] font-mono text-forge-text-dim tracking-wider mb-1">CURRENT POSITION</div>
          <div className="text-sm font-mono text-forge-text">
            {observer.latitude.toFixed(4)}°{observer.latitude >= 0 ? 'N' : 'S'}, {Math.abs(observer.longitude).toFixed(4)}°{observer.longitude >= 0 ? 'E' : 'W'}
          </div>
          <div className="text-xs font-mono text-forge-text-dim">
            {observer.name || 'Unnamed'} · Alt: {observer.altitude}m · Source: {observer.source}
          </div>
          <div className="text-[9px] font-mono text-forge-text-dim mt-1">
            Updated: {new Date(observer.lastUpdated).toLocaleString()}
          </div>
        </div>

        {/* Source selector */}
        <div>
          <div className="text-[10px] font-mono text-forge-text-dim tracking-wider mb-2">LOCATION SOURCE</div>
          <div className="grid grid-cols-5 gap-1">
            {SOURCES.map((src) => (
              <button
                key={src.id}
                onClick={() => setSource(src.id)}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded border text-center transition-all ${
                  settings.source === src.id
                    ? 'border-forge-cyan/50 bg-forge-cyan/10 text-forge-cyan'
                    : 'border-forge-border text-forge-text-dim hover:border-forge-cyan/20'
                }`}
              >
                <span className="text-lg">{src.icon}</span>
                <span className="text-[9px] font-mono">{src.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Manual input */}
        {(settings.source === 'manual' || settings.source === 'auto') && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-forge-text-dim tracking-wider">MANUAL COORDINATES</div>

            {/* Place search */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search by place name..."
                value={placeSearch}
                onChange={(e) => setPlaceSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePlaceSearch()}
                className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text placeholder-forge-text-dim focus:border-forge-cyan/50 focus:outline-none"
              />
              <button
                onClick={handlePlaceSearch}
                className="px-3 py-1.5 rounded border border-forge-border text-xs font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all"
              >
                🔍
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-mono text-forge-text-dim">Latitude</label>
                <input type="number" step="any" value={manualLat} onChange={(e) => setManualLat(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
              </div>
              <div>
                <label className="text-[9px] font-mono text-forge-text-dim">Longitude</label>
                <input type="number" step="any" value={manualLon} onChange={(e) => setManualLon(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-mono text-forge-text-dim">Altitude (m)</label>
                <input type="number" step="any" value={manualAlt} onChange={(e) => setManualAlt(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
              </div>
              <div>
                <label className="text-[9px] font-mono text-forge-text-dim">Name</label>
                <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
              </div>
            </div>
            <button onClick={handleManualSave}
              className="w-full py-1.5 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
              Save Location
            </button>
          </div>
        )}

        {/* Browser GPS */}
        {settings.source === 'browser' && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-forge-text-dim tracking-wider">BROWSER GEOLOCATION</div>
            <button onClick={useBrowserGPS}
              className="w-full py-2 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
              🌐 Get Current Position
            </button>
            <p className="text-[9px] font-mono text-forge-text-dim">Uses navigator.geolocation API. Browser will request permission.</p>
          </div>
        )}

        {/* GPS Hardware */}
        {(settings.source === 'gps' || settings.source === 'auto') && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-forge-text-dim tracking-wider">HARDWARE GPS (gpsd)</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-mono text-forge-text-dim">gpsd Host</label>
                <input type="text" value={gpsdHost} onChange={(e) => setGpsdHost(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
              </div>
              <div>
                <label className="text-[9px] font-mono text-forge-text-dim">gpsd Port</label>
                <input type="number" value={gpsdPort} onChange={(e) => setGpsdPort(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
              </div>
            </div>
            <button onClick={handleGPSConfig}
              className="w-full py-1.5 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
              Connect to gpsd
            </button>
            <p className="text-[9px] font-mono text-forge-text-dim">Connects to gpsd daemon for NMEA GPS data. Supports USB GPS receivers.</p>
          </div>
        )}

        {/* Starlink */}
        {(settings.source === 'starlink' || settings.source === 'auto') && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-forge-text-dim tracking-wider">STARLINK DISH GPS</div>
            <div>
              <label className="text-[9px] font-mono text-forge-text-dim">Dish IP Address</label>
              <input type="text" value={starlinkHost} onChange={(e) => setStarlinkHost(e.target.value)}
                className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none" />
            </div>
            <button onClick={handleStarlinkConfig}
              className="w-full py-1.5 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
              Connect to Starlink
            </button>
            <p className="text-[9px] font-mono text-forge-text-dim">Polls Starlink dish at 192.168.100.1 for GPS coordinates via HTTP/gRPC API.</p>
          </div>
        )}
      </div>
    </div>
  );
};
