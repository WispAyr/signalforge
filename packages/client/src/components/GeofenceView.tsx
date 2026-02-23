import React, { useState, useEffect } from 'react';
import type { GeoZone, GeoAlert } from '@signalforge/shared';

export const GeofenceView: React.FC = () => {
  const [zones, setZones] = useState<GeoZone[]>([]);
  const [alerts, setAlerts] = useState<GeoAlert[]>([]);
  const [tab, setTab] = useState<'zones' | 'alerts'>('zones');
  const [showAdd, setShowAdd] = useState(false);
  const [newZone, setNewZone] = useState({ name: '', type: 'circle' as GeoZone['type'], centerLat: 51.5, centerLng: -0.1, radius: 50000, color: '#00e5ff', alertOnEnter: true, alertOnExit: true, trackedTypes: ['aircraft', 'vessel'] as string[] });

  const fetchData = async () => {
    try {
      const [zRes, aRes] = await Promise.all([fetch('/api/geofence/zones'), fetch('/api/geofence/alerts')]);
      setZones(await zRes.json());
      setAlerts(await aRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, []);

  // Listen for WS alerts
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'geo_alert') setAlerts(prev => [msg.alert, ...prev].slice(0, 100));
      } catch { /* binary */ }
    };
    return () => ws.close();
  }, []);

  const addZone = async () => {
    try {
      await fetch('/api/geofence/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newZone.name,
          type: newZone.type,
          enabled: true,
          color: newZone.color,
          opacity: 0.3,
          center: { lat: newZone.centerLat, lng: newZone.centerLng },
          radius: newZone.radius,
          alertOnEnter: newZone.alertOnEnter,
          alertOnExit: newZone.alertOnExit,
          trackedTypes: newZone.trackedTypes,
        }),
      });
      setShowAdd(false);
      fetchData();
    } catch { /* ignore */ }
  };

  const deleteZone = async (id: string) => {
    await fetch(`/api/geofence/zones/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const ackAlert = async (id: string) => {
    await fetch(`/api/geofence/alerts/${id}/ack`, { method: 'POST' });
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🔲 GEO-FENCING</h2>
        <div className="flex gap-1 ml-4">
          {(['zones', 'alerts'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
              {t.toUpperCase()}
              {t === 'alerts' && alerts.filter(a => !a.acknowledged).length > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[8px] rounded-full px-1">{alerts.filter(a => !a.acknowledged).length}</span>
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="ml-auto px-3 py-1 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20">
          + ADD ZONE
        </button>
      </div>

      {showAdd && (
        <div className="panel-border rounded p-4 mb-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <input value={newZone.name} onChange={e => setNewZone({ ...newZone, name: e.target.value })} placeholder="Zone name"
              className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <select value={newZone.type} onChange={e => setNewZone({ ...newZone, type: e.target.value as any })}
              className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text">
              <option value="circle">Circle</option>
              <option value="polygon">Polygon</option>
              <option value="corridor">Corridor</option>
            </select>
            <input value={newZone.centerLat} type="number" step="0.01" onChange={e => setNewZone({ ...newZone, centerLat: parseFloat(e.target.value) })}
              placeholder="Lat" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
            <input value={newZone.centerLng} type="number" step="0.01" onChange={e => setNewZone({ ...newZone, centerLng: parseFloat(e.target.value) })}
              placeholder="Lng" className="bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs font-mono text-forge-text" />
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-xs font-mono text-forge-text-dim flex items-center gap-1">
              Radius (m): <input value={newZone.radius} type="number" onChange={e => setNewZone({ ...newZone, radius: parseInt(e.target.value) })}
                className="w-20 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text" />
            </label>
            <input type="color" value={newZone.color} onChange={e => setNewZone({ ...newZone, color: e.target.value })} className="w-8 h-6" />
            <label className="text-xs font-mono text-forge-text-dim flex items-center gap-1">
              <input type="checkbox" checked={newZone.alertOnEnter} onChange={e => setNewZone({ ...newZone, alertOnEnter: e.target.checked })} /> Enter
            </label>
            <label className="text-xs font-mono text-forge-text-dim flex items-center gap-1">
              <input type="checkbox" checked={newZone.alertOnExit} onChange={e => setNewZone({ ...newZone, alertOnExit: e.target.checked })} /> Exit
            </label>
            <button onClick={addZone} className="px-3 py-1 text-xs font-mono bg-forge-green/20 text-forge-green rounded hover:bg-forge-green/30">CREATE</button>
          </div>
        </div>
      )}

      {tab === 'zones' && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {zones.map(z => (
            <div key={z.id} className="panel-border rounded p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color }} />
                <div>
                  <div className="text-sm font-mono text-forge-text">{z.name}</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">
                    {z.type.toUpperCase()} • {z.trackedTypes.join(', ')} • {z.alertOnEnter ? '↓' : ''}{z.alertOnExit ? '↑' : ''}
                    {z.radius && ` • ${(z.radius / 1000).toFixed(1)}km`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded ${z.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {z.enabled ? 'ACTIVE' : 'DISABLED'}
                </span>
                <button onClick={() => deleteZone(z.id)} className="text-forge-text-dim hover:text-red-400 text-xs">✕</button>
              </div>
            </div>
          ))}
          {zones.length === 0 && <p className="text-center text-forge-text-dim text-xs font-mono py-8">No zones defined. Click + ADD ZONE.</p>}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="flex-1 overflow-y-auto space-y-1">
          {alerts.map(a => (
            <div key={a.id} className={`panel-border rounded px-3 py-2 flex items-center justify-between ${!a.acknowledged ? 'border-l-2 border-red-500' : ''}`}>
              <div>
                <div className="text-xs font-mono text-forge-text">
                  {a.event === 'enter' ? '🔴' : '🟢'} {a.entityName} — {a.event.toUpperCase()} "{a.zoneName}"
                </div>
                <div className="text-[10px] font-mono text-forge-text-dim">
                  {a.entityType} • {a.position.lat.toFixed(4)}°, {a.position.lng.toFixed(4)}° • {new Date(a.timestamp).toLocaleTimeString()}
                </div>
              </div>
              {!a.acknowledged && (
                <button onClick={() => ackAlert(a.id)} className="px-2 py-0.5 text-[10px] font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20">ACK</button>
              )}
            </div>
          ))}
          {alerts.length === 0 && <p className="text-center text-forge-text-dim text-xs font-mono py-8">No alerts triggered</p>}
        </div>
      )}
    </div>
  );
};
