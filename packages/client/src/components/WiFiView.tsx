import React, { useState, useEffect } from 'react';
import type { WiFiAP, WiFiDeauthEvent, WiFiStatus } from '@signalforge/shared';

const ENC_COLORS: Record<string, string> = { OPEN: 'text-red-400', WEP: 'text-orange-400', WPA: 'text-yellow-400', WPA2: 'text-green-400', WPA3: 'text-forge-cyan', 'WPA2-Enterprise': 'text-blue-400' };

export const WiFiView: React.FC = () => {
  const [aps, setAPs] = useState<WiFiAP[]>([]);
  const [deauths, setDeauths] = useState<WiFiDeauthEvent[]>([]);
  const [status, setStatus] = useState<WiFiStatus | null>(null);
  const [tab, setTab] = useState<'aps' | 'clients' | 'deauth'>('aps');

  const fetchData = async () => {
    try {
      const [aRes, dRes, sRes] = await Promise.all([fetch('/api/wifi/aps'), fetch('/api/wifi/deauth?limit=50'), fetch('/api/wifi/status')]);
      setAPs(await aRes.json());
      setDeauths(await dRes.json());
      setStatus(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  const signalBar = (rssi: number) => {
    const bars = rssi > -50 ? 4 : rssi > -60 ? 3 : rssi > -70 ? 2 : 1;
    return '█'.repeat(bars) + '░'.repeat(4 - bars);
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📶 WiFi SCANNER</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.scanning ? 'text-green-400' : 'text-red-400'}>{status.scanning ? '● SCANNING' : '○ IDLE'}</span>
            <span>{status.apCount} APs</span>
            <span>{status.clientCount} clients</span>
            {status.deauthEvents > 0 && <span className="text-red-400">⚠ {status.deauthEvents} deauths</span>}
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-3">
        {(['aps', 'clients', 'deauth'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs font-mono rounded ${tab === t ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'text-forge-text-dim hover:text-forge-text'}`}>
            {t === 'aps' ? 'Access Points' : t === 'clients' ? 'Clients' : 'Deauth Events'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'aps' && (
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
              <tr><th className="text-left p-2">SSID</th><th className="text-left p-2">BSSID</th><th className="text-left p-2">CH</th><th className="text-left p-2">Signal</th><th className="text-left p-2">Enc</th><th className="text-left p-2">Clients</th><th className="text-left p-2">Vendor</th></tr>
            </thead>
            <tbody>
              {aps.sort((a, b) => b.signalStrength - a.signalStrength).map(ap => (
                <tr key={ap.bssid} className="border-t border-forge-border/30 hover:bg-forge-panel/50">
                  <td className="p-2 text-forge-text font-bold">{ap.ssid || '<hidden>'}</td>
                  <td className="p-2 text-forge-text-dim">{ap.bssid}</td>
                  <td className="p-2 text-forge-amber">{ap.channel}</td>
                  <td className="p-2"><span className={ap.signalStrength > -60 ? 'text-green-400' : ap.signalStrength > -75 ? 'text-yellow-400' : 'text-red-400'}>{signalBar(ap.signalStrength)} {ap.signalStrength.toFixed(0)}</span></td>
                  <td className={`p-2 ${ENC_COLORS[ap.encryption] || 'text-forge-text-dim'}`}>{ap.encryption}</td>
                  <td className="p-2">{ap.clients.length}</td>
                  <td className="p-2 text-forge-text-dim">{ap.manufacturer || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'clients' && (
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
              <tr><th className="text-left p-2">MAC</th><th className="text-left p-2">AP</th><th className="text-left p-2">Signal</th><th className="text-left p-2">Frames</th><th className="text-left p-2">Probes</th><th className="text-left p-2">Vendor</th></tr>
            </thead>
            <tbody>
              {aps.flatMap(ap => ap.clients.map(c => ({ ...c, apSsid: ap.ssid, apBssid: ap.bssid }))).map((c, i) => (
                <tr key={`${c.mac}-${i}`} className="border-t border-forge-border/30 hover:bg-forge-panel/50">
                  <td className="p-2 text-forge-text">{c.mac}</td>
                  <td className="p-2 text-forge-cyan">{c.apSsid || c.apBssid}</td>
                  <td className="p-2 text-forge-amber">{c.signalStrength.toFixed(0)} dBm</td>
                  <td className="p-2">{c.dataFrames}</td>
                  <td className="p-2 text-forge-text-dim">{c.probeRequests.join(', ') || '—'}</td>
                  <td className="p-2 text-forge-text-dim">{c.manufacturer || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'deauth' && (
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface text-forge-text-dim">
              <tr><th className="text-left p-2">Time</th><th className="text-left p-2">Source</th><th className="text-left p-2">Target</th><th className="text-left p-2">BSSID</th><th className="text-left p-2">Reason</th><th className="text-left p-2">Count</th></tr>
            </thead>
            <tbody>
              {deauths.map(d => (
                <tr key={d.id} className="border-t border-forge-border/30 hover:bg-forge-panel/50 bg-red-500/5">
                  <td className="p-2 text-forge-text-dim">{new Date(d.timestamp).toLocaleTimeString()}</td>
                  <td className="p-2 text-red-400">{d.sourceMac}</td>
                  <td className="p-2 text-forge-text">{d.targetMac}</td>
                  <td className="p-2 text-forge-text-dim">{d.bssid}</td>
                  <td className="p-2">{d.reason}</td>
                  <td className="p-2 text-forge-amber">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
