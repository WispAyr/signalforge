import React, { useState, useEffect, useCallback, useRef } from 'react';

const API = `http://${window.location.hostname}:3401`;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

interface AirportChannel {
  freq: number;
  label: string;
  mode: string;
  squelch: number;
  color: string;
  category?: string;
  enabled: boolean;
  signalLevel: number;
  squelchOpen: boolean;
  lastActivity: number;
  recording: boolean;
}

interface Recording {
  id: string;
  freq: number;
  label: string;
  timestamp: number;
  duration: number;
  filename: string;
  size: number;
}

interface DiscoveredSignal {
  freq: number;
  power: number;
  burstCount: number;
  firstSeen: number;
  lastSeen: number;
}

interface ScannerStatus {
  running: boolean;
  name: string;
  icao: string;
  centerFreq: number;
  channelCount: number;
  activeChannels: number;
  recordingCount: number;
  discoveredCount: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  emergency: '#ff4444',
  atc: '#44ff44',
  ground: '#44aaff',
  handling: '#4488ff',
  security: '#ffaa44',
  maintenance: '#aa88ff',
  ops: '#cccccc',
  pmr: '#666688',
};

function timeAgo(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 3000) return 'LIVE';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function formatFreq(freq: number): string {
  return (freq / 1e6).toFixed(4);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function SignalBar({ level, squelchOpen, color }: { level: number; squelchOpen: boolean; color: string }) {
  // Map -120..-40 dBm to 0-100%
  const pct = Math.max(0, Math.min(100, ((level + 120) / 80) * 100));
  const barColor = squelchOpen ? color : '#333';
  return (
    <div className="w-full h-3 bg-black/40 rounded-sm overflow-hidden border border-white/10">
      <div
        className="h-full transition-all duration-100"
        style={{ width: `${pct}%`, background: squelchOpen ? `linear-gradient(90deg, ${barColor}, ${barColor}cc)` : '#333' }}
      />
    </div>
  );
}

function ChannelCard({ ch, now }: { ch: AirportChannel; now: number }) {
  const isLive = ch.squelchOpen;
  const catColor = CATEGORY_COLORS[ch.category || 'ops'] || '#cccccc';

  return (
    <div
      className={`relative rounded-lg border p-3 transition-all duration-200 ${
        isLive
          ? 'border-green-400/60 bg-green-900/20 shadow-lg shadow-green-500/10'
          : ch.enabled
          ? 'border-white/10 bg-white/[0.03]'
          : 'border-white/5 bg-white/[0.01] opacity-50'
      }`}
      style={isLive ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}}
    >
      {/* Recording indicator */}
      {ch.recording && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-red-400 font-mono">REC</span>
        </div>
      )}

      {/* Category color strip */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ background: catColor }} />

      <div className="pl-2">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-sm font-bold" style={{ color: ch.color }}>
            {formatFreq(ch.freq)}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            isLive ? 'bg-green-500/30 text-green-300' : ch.enabled ? 'bg-white/10 text-white/40' : 'bg-red-500/20 text-red-400'
          }`}>
            {isLive ? '● ACTIVE' : ch.enabled ? '○ IDLE' : '✕ OFF'}
          </span>
        </div>

        <div className="text-xs text-white/60 mb-2 truncate">{ch.label}</div>

        <SignalBar level={ch.signalLevel} squelchOpen={ch.squelchOpen} color={ch.color} />

        <div className="flex justify-between items-center mt-1.5">
          <span className="text-[10px] text-white/30 font-mono">{ch.signalLevel.toFixed(0)} dBm</span>
          <span className={`text-[10px] font-mono ${isLive ? 'text-green-400' : 'text-white/30'}`}>
            {timeAgo(ch.lastActivity)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AirportScannerView() {
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [channels, setChannels] = useState<AirportChannel[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredSignal[]>([]);
  const [showRecordings, setShowRecordings] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [s, c, r, d] = await Promise.all([
        fetch(`${API}/api/scanner/airport/status`).then(r => r.json()),
        fetch(`${API}/api/scanner/airport/channels`).then(r => r.json()),
        fetch(`${API}/api/scanner/airport/recordings`).then(r => r.json()),
        fetch(`${API}/api/scanner/airport/discovered`).then(r => r.json()),
      ]);
      setStatus(s);
      setChannels(c);
      setRecordings(r);
      setDiscovered(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // WebSocket for real-time updates
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'scanner_channel_update') {
            setChannels(prev => {
              const updated = [...prev];
              for (const upd of msg.channels) {
                const idx = updated.findIndex(c => c.freq === upd.freq);
                if (idx >= 0) {
                  updated[idx] = { ...updated[idx], ...upd };
                }
              }
              return updated;
            });
          } else if (msg.type === 'scanner_recording') {
            setRecordings(prev => [msg.recording, ...prev].slice(0, 100));
          } else if (msg.type === 'scanner_discovery') {
            setDiscovered(prev => {
              const idx = prev.findIndex(d => d.freq === msg.signal.freq);
              if (idx >= 0) { const u = [...prev]; u[idx] = msg.signal; return u; }
              return [msg.signal, ...prev];
            });
          } else if (msg.type === 'scanner_status') {
            setStatus(msg.status);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => { setTimeout(connect, 3000); };
    };
    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  const toggleScanner = async () => {
    const endpoint = status?.running ? 'stop' : 'start';
    await fetch(`${API}/api/scanner/airport/${endpoint}`, { method: 'POST' });
    fetchStatus();
  };

  const playRecording = (id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(`${API}/api/scanner/airport/recordings/${id}/audio`);
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(id);
  };

  const deleteRecording = async (id: string) => {
    await fetch(`${API}/api/scanner/airport/recordings/${id}`, { method: 'DELETE' });
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

  const activeCount = channels.filter(c => c.squelchOpen).length;
  const recCount = channels.filter(c => c.recording).length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-forge-bg">
      {/* Pulse animation */}
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.85; } }
        @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(100%); } }
      `}</style>

      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✈️</span>
          <div>
            <h1 className="text-lg font-bold font-mono tracking-wider text-forge-cyan">
              PRESTWICK AIRPORT SCANNER
            </h1>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span className="font-mono">EGPK</span>
              <span>•</span>
              <span>{status ? `${(status.centerFreq / 1e6).toFixed(3)} MHz` : '—'}</span>
              <span>•</span>
              <span>{channels.length} channels</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status badges */}
          {activeCount > 0 && (
            <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-mono animate-pulse">
              {activeCount} ACTIVE
            </span>
          )}
          {recCount > 0 && (
            <span className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {recCount} REC
            </span>
          )}

          {/* Status indicator */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${
            status?.running ? 'bg-green-500/20' : 'bg-white/5'
          }`}>
            <div className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-500 animate-pulse' : 'bg-white/20'}`} />
            <span className="text-xs font-mono text-white/60">{status?.running ? 'SCANNING' : 'STOPPED'}</span>
          </div>

          {/* Controls */}
          <button
            onClick={toggleScanner}
            className={`px-4 py-1.5 rounded font-mono text-sm transition-all ${
              status?.running
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                : 'bg-forge-cyan/20 text-forge-cyan hover:bg-forge-cyan/30 border border-forge-cyan/30'
            }`}
          >
            {status?.running ? '■ STOP' : '▶ START'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Channel Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {channels.map(ch => (
            <ChannelCard key={ch.freq} ch={ch} now={now} />
          ))}
        </div>

        {/* Panels */}
        <div className="flex gap-3">
          {/* Recordings Panel */}
          <div className="flex-1">
            <button
              onClick={() => setShowRecordings(!showRecordings)}
              className="w-full flex items-center justify-between px-3 py-2 rounded bg-white/[0.03] border border-white/10 hover:bg-white/[0.05] transition-colors"
            >
              <span className="text-sm font-mono text-white/60">
                📼 RECORDINGS ({recordings.length})
              </span>
              <span className="text-white/30">{showRecordings ? '▼' : '▶'}</span>
            </button>
            {showRecordings && (
              <div className="mt-2 space-y-1 max-h-64 overflow-auto">
                {recordings.length === 0 ? (
                  <div className="text-center text-white/20 text-sm py-4">No recordings yet</div>
                ) : recordings.map(rec => (
                  <div key={rec.id} className="flex items-center gap-2 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-xs font-mono">
                    <button
                      onClick={() => playRecording(rec.id)}
                      className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                        playingId === rec.id ? 'bg-green-500/30 text-green-400' : 'bg-white/10 text-white/40 hover:bg-white/20'
                      }`}
                    >
                      {playingId === rec.id ? '■' : '▶'}
                    </button>
                    <span className="text-forge-cyan">{formatFreq(rec.freq)}</span>
                    <span className="text-white/40 truncate flex-1">{rec.label}</span>
                    <span className="text-white/30">{rec.duration}s</span>
                    <span className="text-white/20">{formatSize(rec.size)}</span>
                    <span className="text-white/20">{new Date(rec.timestamp).toLocaleTimeString()}</span>
                    <a
                      href={`${API}/api/scanner/airport/recordings/${rec.id}/audio`}
                      download
                      className="text-white/30 hover:text-white/60"
                    >↓</a>
                    <button
                      onClick={() => deleteRecording(rec.id)}
                      className="text-red-400/40 hover:text-red-400"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Discovery Panel */}
          <div className="flex-1">
            <button
              onClick={() => setShowDiscovery(!showDiscovery)}
              className="w-full flex items-center justify-between px-3 py-2 rounded bg-white/[0.03] border border-white/10 hover:bg-white/[0.05] transition-colors"
            >
              <span className="text-sm font-mono text-white/60">
                🔍 DISCOVERED ({discovered.length})
              </span>
              <span className="text-white/30">{showDiscovery ? '▼' : '▶'}</span>
            </button>
            {showDiscovery && (
              <div className="mt-2 space-y-1 max-h-64 overflow-auto">
                {discovered.length === 0 ? (
                  <div className="text-center text-white/20 text-sm py-4">No unknown signals detected</div>
                ) : discovered.map(sig => (
                  <div key={sig.freq} className="flex items-center gap-2 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-xs font-mono">
                    <span className="text-forge-amber">{formatFreq(sig.freq)}</span>
                    <span className="text-white/40">{sig.power.toFixed(0)} dBm</span>
                    <span className="text-white/30">{sig.burstCount} bursts</span>
                    <span className="text-white/20 flex-1 text-right">{timeAgo(sig.lastSeen)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
