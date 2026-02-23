import React, { useState, useEffect } from 'react';
import type { BTDevice, BTProximityAlert, BTStatus } from '@signalforge/shared';

const TRACKER_ICONS: Record<string, string> = { airtag: '🍎', tile: '🔲', smarttag: '📱', chipolo: '🔵', none: '', unknown: '❓' };

export const BluetoothView: React.FC = () => {
  const [devices, setDevices] = useState<BTDevice[]>([]);
  const [alerts, setAlerts] = useState<BTProximityAlert[]>([]);
  const [status, setStatus] = useState<BTStatus | null>(null);
  const [tab, setTab] = useState<'all' | 'trackers' | 'alerts'>('all');

  const fetchData = async () => {
    try {
      const [dRes, aRes, sRes] = await Promise.all([fetch('/api/bluetooth/devices'), fetch('/api/bluetooth/alerts?limit=50'), fetch('/api/bluetooth/status')]);
      setDevices(await dRes.json());
      setAlerts(await aRes.json());
      setStatus(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  const trackers = devices.filter(d => d.trackerType !== 'none');
  const shown = tab === 'trackers' ? trackers : tab === 'all' ? devices : [];

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🔵 BLUETOOTH SCANNER</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.scanning ? 'text-green-400' : 'text-red-400'}>{status.scanning ? '● SCANNING' : '○ IDLE'}</span>
            <span>{status.deviceCount} devices</span>
            <span className="text-purple-400">{status.trackerCount} trackers</span>
            {status.locateActive && <span className="text-forge-amber animate-pulse">◎ LOCATE MODE</span>}
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-3">
        {(['all', 'trackers', 'alerts'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
            {t === 'all' ? `All (${devices.length})` : t === 'trackers' ? `Trackers (${trackers.length})` : `Alerts (${alerts.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab !== 'alerts' ? (
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
              <tr><th className="text-left p-2">Device</th><th className="text-left p-2">MAC</th><th className="text-left p-2">Type</th><th className="text-left p-2">RSSI</th><th className="text-left p-2">Tracker</th><th className="text-left p-2">Seen</th><th className="text-left p-2">Last</th></tr>
            </thead>
            <tbody>
              {shown.sort((a, b) => b.rssi - a.rssi).map(dev => (
                <tr key={dev.id} className={`border-t border-forge-border/30 hover:bg-forge-panel/50 ${dev.isTarget ? 'bg-forge-amber/10' : ''}`}>
                  <td className="p-2 text-forge-text font-bold">{dev.name || '<unnamed>'}</td>
                  <td className="p-2 text-forge-text-dim">{dev.mac}</td>
                  <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${dev.type === 'ble' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>{dev.type.toUpperCase()}</span></td>
                  <td className="p-2 text-forge-amber">{dev.rssi.toFixed(0)} dBm</td>
                  <td className="p-2">{dev.trackerType !== 'none' ? `${TRACKER_ICONS[dev.trackerType]} ${dev.trackerType}` : '—'}</td>
                  <td className="p-2">{dev.seenCount}</td>
                  <td className="p-2 text-forge-text-dim">{new Date(dev.lastSeen).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`bg-forge-panel rounded border ${a.acknowledged ? 'border-forge-border' : 'border-red-500/50 bg-red-500/10'} p-3 flex items-center gap-3`}>
                <span className="text-2xl">{TRACKER_ICONS[a.trackerType]}</span>
                <div className="flex-1">
                  <div className="text-sm font-bold text-forge-text">{a.deviceName}</div>
                  <div className="text-[10px] font-mono text-forge-text-dim">{a.trackerType.toUpperCase()} — RSSI: {a.rssi.toFixed(0)} dBm — {new Date(a.timestamp).toLocaleTimeString()}</div>
                </div>
                {!a.acknowledged && (
                  <button onClick={() => fetch(`/api/bluetooth/alerts/${a.id}/ack`, { method: 'POST' }).then(fetchData)}
                    className="px-2 py-1 text-[10px] font-mono bg-forge-cyan/10 text-forge-cyan rounded border border-forge-cyan/30 hover:bg-forge-cyan/20">ACK</button>
                )}
              </div>
            ))}
            {alerts.length === 0 && <div className="text-center py-10 text-forge-text-dim text-sm">No proximity alerts.</div>}
          </div>
        )}
      </div>
    </div>
  );
};
