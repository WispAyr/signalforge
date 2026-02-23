import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { APRSStation, APRSPacket } from '@signalforge/shared';

// APRS symbol decode helper
const SYMBOL_MAP: Record<string, string> = {
  '/!': '🚔 Police', '/"': '📍 No Symbol', '/#': '🔢 Digi', '/$': '📞 Phone',
  '/%': '🔺 DX Cluster', '/&': '♦ Gateway', "/'": '✈️ Aircraft', '/(': '☁️ Cloudy',
  '/)': '📡 Firenet', '/*': '❄️ Snow', '/+': '✚ Red Cross', '/,': '🏕️ Scout',
  '/-': '🏠 House QTH', '/.': '❓ Unknown', '//': '🔴 Red Dot', '/0': '⭕ Circle',
  '/1': '⭕ Circle', '/2': '⭕ Circle', '/3': '⭕ Circle', '/4': '⭕ Circle',
  '/5': '⭕ Circle', '/6': '⭕ Circle', '/7': '⭕ Circle', '/8': '⭕ Circle',
  '/9': '⭕ Circle', '/:': '🔥 Fire', '/;': '🏕️ Campground', '/<': '🏍️ Motorcycle',
  '/=': '🚂 Train', '/>': '🚗 Car', '/?': '❓ Server', '/@': '🌀 Hurricane',
  '/A': '📧 Aid Station', '/B': '🏦 BBS', '/C': '🛶 Canoe', '/D': '📍 Destination',
  '/E': '👁️ Eyeball', '/F': '🚜 Farm', '/G': '🏗️ Grid Square', '/H': '🏨 Hotel',
  '/I': '📡 TCP/IP', '/J': '🏫 School', '/K': '📻 HF Gateway', '/L': '💻 Laptop',
  '/M': '📡 MacAPRS', '/N': '📡 NTS', '/O': '🎈 Balloon', '/P': '👮 Police',
  '/Q': '🌊 Quake', '/R': '🚐 RV', '/S': '🚀 Shuttle', '/T': '⛈️ Thunderstorm',
  '/U': '🚌 Bus', '/V': '📡 VORTAC', '/W': '💧 Water', '/X': '❌ Wreck',
  '/Y': '📡 Yagi', '/Z': '🏠 Shelter', '/[': '🏃 Runner', '/\\': '🔺 Triangle',
  '/]': '📬 Mailbox', '/^': '✈️ Aircraft Lg', '/_': '🌤️ Weather', '/`': '📡 Dish',
  '/a': '🚑 Ambulance', '/b': '🚲 Bike', '/c': '🩹 ICP', '/d': '🔥 Fire Station',
  '/e': '🐴 Horse', '/f': '🚒 Fire Truck', '/g': '🏔️ Glider', '/h': '🏥 Hospital',
  '/i': '📡 IOTA', '/j': '🚙 Jeep', '/k': '🚛 Truck', '/l': '💻 Laptop',
  '/m': '📡 Mic-E', '/n': '📍 Node', '/o': '🔘 EOC', '/p': '🐾 Rover',
  '/q': '🔲 Grid Sq', '/r': '📻 Repeater', '/s': '⛵ Boat', '/t': '🚚 Truck',
  '/u': '📻 Radio', '/v': '🚐 Van', '/w': '💧 Water Station', '/x': '📡 xAPRS',
  '/y': '📡 Yagi', '/z': '🏡 Shelter',
};

function decodeSymbol(sym?: string): string {
  if (!sym || sym.length < 2) return '📍';
  return SYMBOL_MAP[sym]?.split(' ')[0] || '📡';
}

function decodeSymbolLabel(sym?: string): string {
  if (!sym || sym.length < 2) return 'Unknown';
  return SYMBOL_MAP[sym]?.split(' ').slice(1).join(' ') || sym;
}

function formatCoord(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir} ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ageClass(ts: number): string {
  const age = Date.now() - ts;
  if (age < 30_000) return 'text-green-400 font-bold';
  if (age < 120_000) return 'text-forge-text';
  if (age < 600_000) return 'text-forge-text-dim';
  return 'text-forge-text-dim/40';
}

type SortKey = 'callsign' | 'lastSeen' | 'altitude' | 'speed' | 'packetCount' | 'dataType';

export const APRSView: React.FC = () => {
  const [stations, setStations] = useState<APRSStation[]>([]);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('lastSeen');
  const [sortAsc, setSortAsc] = useState(false);
  const [, setTick] = useState(0);

  // Refresh relative times every second
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/aprs');
      if (res.ok) setStations(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, [fetchData]);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'aprs') {
          const station = msg.station as APRSStation;
          setStations(prev => {
            const idx = prev.findIndex(s => s.callsign === station.callsign);
            if (idx >= 0) { const next = [...prev]; next[idx] = station; return next; }
            return [station, ...prev];
          });
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'callsign'); }
  };

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    let list = stations;
    if (q) list = list.filter(s =>
      s.callsign.toLowerCase().includes(q) ||
      s.comment?.toLowerCase().includes(q) ||
      s.lastPacket?.dataType?.toLowerCase().includes(q) ||
      s.lastPacket?.path?.join(',').toLowerCase().includes(q)
    );
    return list.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'callsign': av = a.callsign; bv = b.callsign; break;
        case 'lastSeen': av = a.lastSeen; bv = b.lastSeen; break;
        case 'altitude': av = a.altitude ?? -1; bv = b.altitude ?? -1; break;
        case 'speed': av = a.lastPacket?.speed ?? -1; bv = b.lastPacket?.speed ?? -1; break;
        case 'packetCount': av = a.packetCount; bv = b.packetCount; break;
        case 'dataType': av = a.lastPacket?.dataType ?? ''; bv = b.lastPacket?.dataType ?? ''; break;
        default: av = a.lastSeen; bv = b.lastSeen;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }, [stations, filter, sortKey, sortAsc]);

  const stats = useMemo(() => {
    const total = stations.length;
    const withPos = stations.filter(s => s.latitude != null).length;
    const weather = stations.filter(s => s.lastPacket?.dataType === 'weather').length;
    const mobile = stations.filter(s => (s.lastPacket?.speed ?? 0) > 0).length;
    const messages = stations.filter(s => s.lastPacket?.dataType === 'message').length;
    return { total, withPos, weather, mobile, messages };
  }, [stations]);

  const SortHeader: React.FC<{ label: string; k: SortKey; className?: string }> = ({ label, k, className }) => (
    <th
      className={`px-2 py-1.5 text-left cursor-pointer hover:text-forge-cyan select-none whitespace-nowrap ${className || ''}`}
      onClick={() => handleSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">
          📍 APRS Stations
          <span className="ml-2 px-2 py-0.5 text-xs font-mono rounded bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20">
            {stats.total}
          </span>
        </h2>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search callsign, comment, type..."
          className="px-3 py-1 text-sm font-mono bg-forge-panel border border-forge-border rounded text-forge-text placeholder-forge-text-dim/50 focus:border-forge-cyan/50 focus:outline-none w-64"
        />
        <div className="flex gap-3 text-[10px] font-mono text-forge-text-dim ml-auto">
          <span>📍 {stats.withPos} pos</span>
          <span>🌤️ {stats.weather} wx</span>
          <span>🚗 {stats.mobile} mobile</span>
          <span>💬 {stats.messages} msg</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border border-forge-border rounded-lg">
        <table className="w-full text-xs font-mono">
          <thead className="bg-forge-panel text-forge-text-dim sticky top-0 z-10 border-b border-forge-border">
            <tr>
              <SortHeader label="Callsign" k="callsign" />
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Sym</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Position</th>
              <SortHeader label="Alt(m)" k="altitude" />
              <SortHeader label="Spd(km/h)" k="speed" />
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Crs°</th>
              <SortHeader label="Type" k="dataType" />
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Weather</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Comment</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Path</th>
              <SortHeader label="Pkts" k="packetCount" />
              <SortHeader label="Last Seen" k="lastSeen" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-forge-text-dim">
                {stations.length === 0 ? 'No APRS stations received yet — listening...' : 'No stations match filter'}
              </td></tr>
            ) : filtered.map(s => {
              const p = s.lastPacket;
              const hasWeather = p && (p.temperature != null || p.humidity != null || p.pressure != null || p.windSpeed != null);
              return (
                <tr
                  key={s.callsign}
                  className={`border-b border-forge-border/30 hover:bg-forge-cyan/5 cursor-pointer transition-colors ${ageClass(s.lastSeen)}`}
                >
                  <td className="px-2 py-1 font-bold text-forge-cyan whitespace-nowrap">{s.callsign}</td>
                  <td className="px-2 py-1" title={decodeSymbolLabel(s.symbol)}>{decodeSymbol(s.symbol)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatCoord(s.latitude, s.longitude)}</td>
                  <td className="px-2 py-1 text-right">{s.altitude != null ? s.altitude.toFixed(0) : '—'}</td>
                  <td className="px-2 py-1 text-right">{p?.speed != null ? p.speed.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1 text-right">{p?.course != null ? `${p.course}°` : '—'}</td>
                  <td className="px-2 py-1">
                    <span className={`px-1 py-0.5 rounded text-[9px] ${
                      p?.dataType === 'weather' ? 'bg-blue-500/20 text-blue-300' :
                      p?.dataType === 'position' ? 'bg-green-500/20 text-green-300' :
                      p?.dataType === 'message' ? 'bg-purple-500/20 text-purple-300' :
                      p?.dataType === 'telemetry' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-forge-border text-forge-text-dim'
                    }`}>
                      {p?.dataType || '?'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap">
                    {hasWeather ? (
                      <span className="flex gap-1.5">
                        {p!.temperature != null && <span title="Temperature">🌡{p!.temperature.toFixed(1)}°</span>}
                        {p!.humidity != null && <span title="Humidity">💧{p!.humidity}%</span>}
                        {p!.pressure != null && <span title="Pressure">📊{p!.pressure.toFixed(0)}</span>}
                        {p!.windSpeed != null && <span title="Wind">💨{p!.windSpeed.toFixed(0)}@{p!.windDirection ?? '?'}°</span>}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-1 max-w-[200px] truncate" title={s.comment || ''}>{s.comment || '—'}</td>
                  <td className="px-2 py-1 text-[10px] text-forge-text-dim max-w-[120px] truncate" title={p?.path?.join(' → ') || ''}>
                    {p?.path?.join('→') || '—'}
                  </td>
                  <td className="px-2 py-1 text-right">{s.packetCount}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{relativeTime(s.lastSeen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default APRSView;
