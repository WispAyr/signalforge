import React, { useState, useEffect } from 'react';
import { useLocationStore } from '../stores/location';
import type { LocationSource } from '@signalforge/shared';

const SOURCES: { id: LocationSource; label: string; icon: string; desc: string }[] = [
  { id: 'manual', label: 'Manual', icon: '✏️', desc: 'Type coordinates or search by place name' },
  { id: 'browser', label: 'Browser GPS', icon: '🌐', desc: 'navigator.geolocation API' },
  { id: 'gps', label: 'Hardware GPS', icon: '🛰️', desc: 'Serial NMEA / gpsd daemon' },
  { id: 'starlink', label: 'Starlink', icon: '📡', desc: 'Query dish at 192.168.100.1' },
  { id: 'auto', label: 'Auto', icon: '🔄', desc: 'Best available with fallback' },
];

import { useTheme } from './ThemeProvider';
import { THEMES as THEME_DEFS } from '@signalforge/shared';

const ThemeSelector: React.FC = () => {
  const { themeId, setTheme, customAccent, setCustomAccent } = useTheme();
  const themes = Object.values(THEME_DEFS);
  return (
    <div className="panel-border rounded-lg p-5">
      <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">🎨 THEME</h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {themes.map(t => (
          <button key={t.id} onClick={() => setTheme(t.id)}
            className={`p-4 rounded-lg border text-left transition-colors ${themeId === t.id ? 'border-current bg-current/10' : 'border-forge-border hover:border-forge-text-dim'}`}
            style={{ borderColor: themeId === t.id ? t.colors.primary : undefined }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex gap-1">
                {[t.colors.primary, t.colors.secondary, t.colors.accent, t.colors.success].map((c, i) => (
                  <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div className="text-sm font-mono" style={{ color: themeId === t.id ? t.colors.primary : undefined }}>{t.name}</div>
            <div className="text-[10px] font-mono text-forge-text-dim mt-0.5">{t.description}</div>
          </button>
        ))}
      </div>
      <div>
        <label className="text-[10px] font-mono text-forge-text-dim">Custom Accent Colour</label>
        <div className="flex items-center gap-2 mt-1">
          <input type="color" value={customAccent || THEME_DEFS[themeId]?.colors.primary || '#00e5ff'}
            onChange={e => setCustomAccent(e.target.value)}
            className="w-8 h-8 rounded border border-forge-border bg-forge-bg cursor-pointer" />
          <span className="text-xs font-mono text-forge-text-dim">{customAccent || 'Default'}</span>
          {customAccent && (
            <button onClick={() => setCustomAccent('')} className="text-[10px] font-mono text-forge-red hover:underline">Reset</button>
          )}
        </div>
      </div>
    </div>
  );
};

export const SettingsPage: React.FC = () => {
  const { observer, settings, loaded, fetchSettings, setManualLocation, setSource, updateSettings, useBrowserGPS } = useLocationStore();
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [manualAlt, setManualAlt] = useState('');
  const [manualName, setManualName] = useState('');
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeResults, setPlaceResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [gpsdHost, setGpsdHost] = useState('127.0.0.1');
  const [gpsdPort, setGpsdPort] = useState('2947');
  const [starlinkHost, setStarlinkHost] = useState('192.168.100.1');
  const [gpsStatus, setGpsStatus] = useState<string>('');
  const [activeSection, setActiveSection] = useState('location');

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
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(placeSearch)}`);
      const results = await res.json();
      setPlaceResults(results);
      if (results.length > 0) {
        const r = results[0];
        setManualLat(parseFloat(r.lat).toFixed(6));
        setManualLon(parseFloat(r.lon).toFixed(6));
        setManualName(r.display_name.split(',').slice(0, 2).join(',').trim());
      }
    } catch { /* ignore */ }
  };

  const handleBrowserGPS = () => {
    setGpsStatus('Requesting position...');
    if (!navigator.geolocation) {
      setGpsStatus('Browser geolocation not available');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGpsStatus(`Got position: ${pos.coords.latitude.toFixed(4)}°, ${pos.coords.longitude.toFixed(4)}°`);
        await setManualLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.altitude || 0, 'Browser GPS');
        setSource('browser');
      },
      (err) => setGpsStatus(`Error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleGPSConfig = () => {
    updateSettings({
      source: 'gps',
      gps: { enabled: true, type: 'gpsd', gpsdHost: gpsdHost, gpsdPort: parseInt(gpsdPort) || 2947 },
    });
  };

  const handleStarlinkConfig = () => {
    updateSettings({
      source: 'starlink',
      starlink: { enabled: true, host: starlinkHost, pollIntervalMs: 30000 },
    });
  };

  const sections = [
    { id: 'location', label: '📍 Location', icon: '📍' },
    { id: 'display', label: '🎨 Display', icon: '🎨' },
    { id: 'notifications', label: '🔔 Notifications', icon: '🔔' },
    { id: 'about', label: 'ℹ️ About', icon: 'ℹ️' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h2 className="font-display text-2xl tracking-wider text-forge-cyan">⚙ SETTINGS</h2>

        {/* Section tabs */}
        <div className="flex gap-2">
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`px-4 py-2 rounded text-xs font-mono tracking-wider transition-all ${
                activeSection === s.id
                  ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30'
                  : 'text-forge-text-dim hover:text-forge-text border border-forge-border hover:border-forge-cyan/20'
              }`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Location Section ─────────────────────────────────────── */}
        {activeSection === 'location' && (
          <div className="space-y-4">
            {/* Current Position */}
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">CURRENT OBSERVER POSITION</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-forge-bg rounded p-3 border border-forge-border">
                  <div className="text-[9px] font-mono text-forge-text-dim">LATITUDE</div>
                  <div className="text-lg font-display text-forge-cyan">{observer.latitude.toFixed(4)}°</div>
                </div>
                <div className="bg-forge-bg rounded p-3 border border-forge-border">
                  <div className="text-[9px] font-mono text-forge-text-dim">LONGITUDE</div>
                  <div className="text-lg font-display text-forge-cyan">{observer.longitude.toFixed(4)}°</div>
                </div>
                <div className="bg-forge-bg rounded p-3 border border-forge-border">
                  <div className="text-[9px] font-mono text-forge-text-dim">ALTITUDE</div>
                  <div className="text-lg font-display text-forge-cyan">{observer.altitude}m</div>
                </div>
                <div className="bg-forge-bg rounded p-3 border border-forge-border">
                  <div className="text-[9px] font-mono text-forge-text-dim">SOURCE</div>
                  <div className="text-lg font-display text-forge-amber">{observer.source}</div>
                </div>
              </div>
              {observer.name && (
                <div className="text-sm font-mono text-forge-text mt-2">{observer.name}</div>
              )}
              <div className="text-[9px] font-mono text-forge-text-dim mt-1">
                Last updated: {new Date(observer.lastUpdated).toLocaleString()}
              </div>
            </div>

            {/* Source Selector */}
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">LOCATION SOURCE</h3>
              <div className="grid grid-cols-5 gap-2">
                {SOURCES.map(src => (
                  <button key={src.id} onClick={() => setSource(src.id)}
                    className={`flex flex-col items-center gap-2 px-3 py-3 rounded-lg border transition-all ${
                      settings.source === src.id
                        ? 'border-forge-cyan/50 bg-forge-cyan/10 text-forge-cyan glow-cyan'
                        : 'border-forge-border text-forge-text-dim hover:border-forge-cyan/20 hover:bg-forge-panel/50'
                    }`}>
                    <span className="text-2xl">{src.icon}</span>
                    <span className="text-[10px] font-mono font-bold">{src.label}</span>
                    <span className="text-[8px] font-mono opacity-60 text-center">{src.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Location */}
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">✏️ MANUAL LOCATION</h3>

              {/* Place search */}
              <div className="flex gap-2 mb-3">
                <input type="text" placeholder="Search by place name (e.g. Glasgow, London, New York)..."
                  value={placeSearch} onChange={e => setPlaceSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePlaceSearch()}
                  className="flex-1 bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text placeholder-forge-text-dim focus:border-forge-cyan/50 focus:outline-none" />
                <button onClick={handlePlaceSearch}
                  className="px-4 py-2 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10">
                  🔍 Search
                </button>
              </div>

              {placeResults.length > 1 && (
                <div className="mb-3 space-y-1">
                  {placeResults.slice(0, 5).map((r, i) => (
                    <button key={i} onClick={() => {
                      setManualLat(parseFloat(r.lat).toFixed(6));
                      setManualLon(parseFloat(r.lon).toFixed(6));
                      setManualName(r.display_name.split(',').slice(0, 2).join(',').trim());
                      setPlaceResults([]);
                    }}
                      className="w-full text-left px-3 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:bg-forge-panel/50 hover:text-forge-text truncate">
                      📍 {r.display_name}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Latitude</label>
                  <input type="number" step="any" value={manualLat} onChange={e => setManualLat(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Longitude</label>
                  <input type="number" step="any" value={manualLon} onChange={e => setManualLon(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Altitude (m)</label>
                  <input type="number" step="any" value={manualAlt} onChange={e => setManualAlt(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Place Name</label>
                  <input type="text" value={manualName} onChange={e => setManualName(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
                </div>
              </div>
              <button onClick={handleManualSave}
                className="mt-3 w-full py-2 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
                💾 Save Location
              </button>
            </div>

            {/* Browser GPS */}
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">🌐 BROWSER GPS</h3>
              <button onClick={handleBrowserGPS}
                className="w-full py-3 rounded border border-forge-cyan/30 text-sm font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
                📡 Get Current Position from Browser
              </button>
              {gpsStatus && <p className="text-[10px] font-mono text-forge-amber mt-2">{gpsStatus}</p>}
              <p className="text-[9px] font-mono text-forge-text-dim mt-2">Uses navigator.geolocation API. Your browser will ask for permission.</p>
            </div>

            {/* Hardware GPS */}
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">🛰️ HARDWARE GPS (gpsd)</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">gpsd Host</label>
                  <input type="text" value={gpsdHost} onChange={e => setGpsdHost(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">gpsd Port</label>
                  <input type="number" value={gpsdPort} onChange={e => setGpsdPort(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
                </div>
              </div>
              <button onClick={handleGPSConfig}
                className="w-full py-2 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
                🔌 Connect to gpsd
              </button>
              <p className="text-[9px] font-mono text-forge-text-dim mt-2">
                Connects to gpsd daemon (default: localhost:2947). Supports USB GPS receivers like u-blox, BU-353, etc.
                Install gpsd: <code className="text-forge-cyan">sudo apt install gpsd gpsd-clients</code>
              </p>
            </div>

            {/* Starlink */}
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">📡 STARLINK DISH GPS</h3>
              <div className="mb-3">
                <label className="text-[10px] font-mono text-forge-text-dim">Dish IP Address</label>
                <input type="text" value={starlinkHost} onChange={e => setStarlinkHost(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text focus:border-forge-cyan/50 focus:outline-none mt-1" />
              </div>
              <button onClick={handleStarlinkConfig}
                className="w-full py-2 rounded border border-forge-cyan/30 text-xs font-mono text-forge-cyan hover:bg-forge-cyan/10 transition-all">
                📡 Connect to Starlink Dish
              </button>
              <p className="text-[9px] font-mono text-forge-text-dim mt-2">
                Polls Starlink dish via HTTP API for GPS coordinates. Requires being on the Starlink network.
                Full gRPC support planned (requires SpaceX protobuf definitions from starlink-grpc-tools).
              </p>
            </div>
          </div>
        )}

        {/* ── Display Section ──────────────────────────────────────── */}
        {activeSection === 'display' && (
          <div className="space-y-4">
            <ThemeSelector />

            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">📐 UNITS</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Distance</label>
                  <select className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text mt-1">
                    <option>Metric (km)</option>
                    <option>Imperial (mi)</option>
                    <option>Nautical (nm)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Temperature</label>
                  <select className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text mt-1">
                    <option>Celsius (°C)</option>
                    <option>Fahrenheit (°F)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Coordinates</label>
                  <select className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text mt-1">
                    <option>Decimal Degrees</option>
                    <option>DMS (° ′ ″)</option>
                    <option>Maidenhead Grid</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim">Time</label>
                  <select className="w-full bg-forge-bg border border-forge-border rounded px-3 py-2 text-xs font-mono text-forge-text mt-1">
                    <option>UTC</option>
                    <option>Local</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">⌨️ KEYBOARD SHORTCUTS</h3>
              <div className="space-y-1">
                {[
                  ['1', 'Dashboard / OPS view'],
                  ['2', 'Flow Editor'],
                  ['3', 'Spectrum / Waterfall'],
                  ['4', 'Map View'],
                  ['5', 'Split View'],
                  ['6', 'Signal Guide'],
                  ['7', 'Settings'],
                  ['S', 'Toggle settings panel'],
                  ['Space', 'Start/stop recording'],
                  ['Esc', 'Close panels'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3 py-1">
                    <kbd className="px-2 py-0.5 rounded bg-forge-bg border border-forge-border text-[10px] font-mono text-forge-cyan min-w-[32px] text-center">{key}</kbd>
                    <span className="text-[11px] font-mono text-forge-text-dim">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Notifications Section ────────────────────────────────── */}
        {activeSection === 'notifications' && (
          <div className="space-y-4">
            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">🔔 NOTIFICATION RULES</h3>
              <div className="space-y-2">
                {[
                  { label: 'Satellite pass (>20° elevation)', type: 'satellite_pass', enabled: true },
                  { label: 'Specific aircraft callsign detected', type: 'aircraft_detected', enabled: false },
                  { label: 'Signal detected on frequency', type: 'signal_detected', enabled: false },
                ].map((rule, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded bg-forge-bg border border-forge-border">
                    <span className="text-xs font-mono text-forge-text">{rule.label}</span>
                    <div className={`w-10 h-5 rounded-full transition-all cursor-pointer ${rule.enabled ? 'bg-forge-cyan/30' : 'bg-forge-border'}`}>
                      <div className={`w-4 h-4 rounded-full mt-0.5 transition-all ${rule.enabled ? 'ml-5 bg-forge-cyan' : 'ml-0.5 bg-forge-text-dim'}`} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] font-mono text-forge-text-dim mt-3">
                Browser notifications require permission. Toast notifications always show in-app.
              </p>
            </div>
          </div>
        )}

        {/* ── About Section ────────────────────────────────────────── */}
        {activeSection === 'about' && (
          <div className="space-y-4">
            <div className="panel-border rounded-lg p-5 text-center">
              <div className="text-4xl mb-3">⚡</div>
              <h3 className="font-display text-xl tracking-wider bg-gradient-to-r from-forge-cyan to-forge-amber bg-clip-text text-transparent">
                SIGNALFORGE
              </h3>
              <p className="text-xs font-mono text-forge-text-dim mt-1">Universal Radio Platform</p>
              <p className="text-xs font-mono text-forge-cyan mt-3">Version 0.3.0</p>
              <p className="text-[10px] font-mono text-forge-text-dim mt-1">
                Browser-based, GPU-accelerated, flow-based signal processing
              </p>
            </div>

            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">🙏 ACKNOWLEDGEMENTS & INSPIRED BY</h3>
              <div className="space-y-3">
                <a href="https://github.com/sgoudelis/ground-station" target="_blank" rel="noopener"
                  className="block p-3 rounded bg-forge-bg border border-forge-border hover:border-forge-cyan/30 transition-all">
                  <div className="text-sm font-mono text-forge-cyan">Ground Station</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">by sgoudelis — Satellite monitoring suite that inspired satellite tracking, SDR integration, and observation scheduling</div>
                </a>
                <a href="https://github.com/aspect-build/cyberether" target="_blank" rel="noopener"
                  className="block p-3 rounded bg-forge-bg border border-forge-border hover:border-forge-cyan/30 transition-all">
                  <div className="text-sm font-mono text-forge-cyan">CyberEther</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">Browser-based GPU-accelerated flowgraph engine inspiring the flow-based visual pipeline architecture</div>
                </a>
                <a href="https://celestrak.org" target="_blank" rel="noopener"
                  className="block p-3 rounded bg-forge-bg border border-forge-border hover:border-forge-cyan/30 transition-all">
                  <div className="text-sm font-mono text-forge-cyan">CelesTrak</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">TLE satellite data provider — essential for orbital tracking and pass predictions</div>
                </a>
                <a href="https://www.openstreetmap.org" target="_blank" rel="noopener"
                  className="block p-3 rounded bg-forge-bg border border-forge-border hover:border-forge-cyan/30 transition-all">
                  <div className="text-sm font-mono text-forge-cyan">OpenStreetMap / Nominatim</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">Open geocoding API for place name search — no API key needed</div>
                </a>
                <a href="http://websdr.org" target="_blank" rel="noopener"
                  className="block p-3 rounded bg-forge-bg border border-forge-border hover:border-forge-cyan/30 transition-all">
                  <div className="text-sm font-mono text-forge-cyan">WebSDR</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">Public WebSDR receivers worldwide — listen to radio without your own hardware</div>
                </a>
              </div>
            </div>

            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">🔗 LINKS</h3>
              <div className="space-y-2">
                <a href="https://github.com/WispAyr/signalforge" target="_blank" rel="noopener"
                  className="flex items-center gap-2 text-xs font-mono text-forge-text hover:text-forge-cyan transition-colors">
                  <span>📦</span> GitHub Repository
                </a>
                <a href="https://github.com/WispAyr/signalforge/issues" target="_blank" rel="noopener"
                  className="flex items-center gap-2 text-xs font-mono text-forge-text hover:text-forge-cyan transition-colors">
                  <span>🐛</span> Report Issues
                </a>
              </div>
            </div>

            <div className="panel-border rounded-lg p-5">
              <h3 className="text-xs font-mono tracking-wider text-forge-cyan mb-3">📝 LICENSE</h3>
              <p className="text-xs font-mono text-forge-text-dim">MIT © WispAyr</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
