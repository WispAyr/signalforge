import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ============================================================================
// Types
// ============================================================================
interface ScannerChannel {
  id: number;
  frequency: number;
  label: string;
  category: string;
  mode: 'NFM' | 'AM';
  priority: number;
  enabled: boolean;
}

interface ScannerHit {
  id: number;
  timestamp: number;
  frequency: number;
  signal_strength_db: number;
  duration_ms: number;
  channel_id: number | null;
  audio_clip_path: string | null;
}

interface Recording {
  id: number;
  timestamp: number;
  frequency: number;
  signal_strength_db: number;
  duration_ms: number;
  channel_id: number | null;
  audio_clip_path: string;
  filename: string;
  url: string;
  size: number;
}

interface ScanRange {
  start: number;
  end: number;
}

interface ScannerConfig {
  ranges: ScanRange[];
  dwellMs: number;
  thresholdDb: number;
  squelchTimeoutMs: number;
  maxParkMs: number;
  sampleRate: number;
  gain: number;
}

interface ScannerStatus {
  state: 'IDLE' | 'SCANNING' | 'SIGNAL_DETECTED' | 'PARKED';
  currentFrequency: number;
  signalStrengthDb: number;
  noiseFloorDb: number;
  parkedChannel: ScannerChannel | null;
  config: ScannerConfig;
  sweepPosition: number;
  hits: number;
  uptime: number;
}

interface FFTData {
  type: 'scanner_fft';
  magnitudes: number[];
  centerFrequency: number;
  sampleRate: number;
  fftSize: number;
  peakBin: number;
  peakDb: number;
  noiseFloor: number;
  signalDetected: boolean;
}

interface ScannerMeta {
  type: 'scanner_meta';
  state: string;
  frequency: number;
  signalStrengthDb: number;
  noiseFloorDb: number;
  channel: ScannerChannel | null;
}

interface ScannerStats {
  totalHits: number;
  uniqueFreqs: number;
  busiestFrequency: number | null;
  busiestFrequencyHits: number;
  recordingCount: number;
  totalScanTime: number;
  hourlyHits: { hour: number; count: number }[];
  categoryBreakdown: { category: string; count: number }[];
}

// ============================================================================
// Constants
// ============================================================================
const CATEGORY_COLORS: Record<string, string> = {
  airport: '#00e5ff',
  fire: '#ff3d00',
  ambulance: '#00e676',
  police: '#448aff',
  pmr: '#ffd600',
  utility: '#9e9e9e',
  unknown: '#ffffff',
};

const CATEGORY_OPTIONS = ['airport', 'fire', 'ambulance', 'police', 'pmr', 'utility', 'unknown'];

const SCAN_PRESETS: Record<string, ScanRange[]> = {
  'Airport UHF': [{ start: 455.0e6, end: 456.0e6 }],
  'Fire': [{ start: 453.0e6, end: 453.3e6 }, { start: 456.0e6, end: 456.2e6 }],
  'PMR446': [{ start: 446.0e6, end: 446.2e6 }],
  'Full UHF': [{ start: 440.0e6, end: 470.0e6 }],
};

function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat] || CATEGORY_COLORS.unknown;
}

// ============================================================================
// Helpers
// ============================================================================
function fmtFreq(hz: number): string { return (hz / 1e6).toFixed(4); }
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
function dbToSMeter(db: number): string {
  if (db < -121) return 'S0';
  if (db < -115) return 'S1';
  if (db < -109) return 'S2';
  if (db < -103) return 'S3';
  if (db < -97) return 'S4';
  if (db < -91) return 'S5';
  if (db < -85) return 'S6';
  if (db < -79) return 'S7';
  if (db < -73) return 'S8';
  if (db < -63) return 'S9';
  if (db < -53) return 'S9+10';
  if (db < -43) return 'S9+20';
  return 'S9+30';
}

// ============================================================================
// Main Component
// ============================================================================
export function UHFScannerView() {
  // State
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [channels, setChannels] = useState<ScannerChannel[]>([]);
  const [hits, setHits] = useState<ScannerHit[]>([]);
  const [lockouts, setLockouts] = useState<any[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [stats, setStats] = useState<ScannerStats | null>(null);
  
  // UI state
  const [activeTab, setActiveTab] = useState<'channels' | 'lockouts' | 'recordings' | 'stats'>('channels');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ScannerChannel | null>(null);
  const [mode, setMode] = useState<'SCANNER' | 'PAGER'>('SCANNER');
  
  // Audio state
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [audioConnected, setAudioConnected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [noiseReduction, setNoiseReduction] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  
  // Config state (mirrors server config)
  const [thresholdDb, setThresholdDb] = useState(10);
  const [dwellMs, setDwellMs] = useState(100);
  const [squelchTimeout, setSquelchTimeout] = useState(3000);
  const [maxParkMs, setMaxParkMs] = useState(15000);
  const [gain, setGain] = useState(40);
  const [scanRanges, setScanRanges] = useState<ScanRange[]>([]);
  
  // Recording playback
  const [playingRecording, setPlayingRecording] = useState<string | null>(null);
  
  // FFT/Spectrum
  const [fftData, setFftData] = useState<FFTData | null>(null);
  
  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);
  
  // Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nrBufferRef = useRef<Float32Array[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // ── Data fetching ──
  const fetchStatus = useCallback(async () => {
    try { const r = await fetch('/api/scanner/uhf/status'); setStatus(await r.json()); } catch {}
  }, []);
  const fetchChannels = useCallback(async () => {
    try { const r = await fetch('/api/scanner/uhf/channels'); setChannels(await r.json()); } catch {}
  }, []);
  const fetchHits = useCallback(async () => {
    try { const r = await fetch('/api/scanner/uhf/hits?limit=100'); setHits(await r.json()); } catch {}
  }, []);
  const fetchLockouts = useCallback(async () => {
    try { const r = await fetch('/api/scanner/uhf/lockouts'); setLockouts(await r.json()); } catch {}
  }, []);
  const fetchRecordings = useCallback(async () => {
    try { const r = await fetch('/api/scanner/uhf/recordings?limit=50'); setRecordings(await r.json()); } catch {}
  }, []);
  const fetchStats = useCallback(async () => {
    try { const r = await fetch('/api/scanner/uhf/stats'); setStats(await r.json()); } catch {}
  }, []);

  // Initial load + polling fallback
  useEffect(() => {
    fetchStatus(); fetchChannels(); fetchHits(); fetchLockouts(); fetchRecordings();
    // Fallback polling (slow, WS is primary)
    pollFallbackRef.current = setInterval(() => {
      if (!wsConnected) { fetchStatus(); fetchHits(); }
    }, 2000);
    return () => { if (pollFallbackRef.current) clearInterval(pollFallbackRef.current); };
  }, []);

  // Update config from status
  useEffect(() => {
    if (status?.config) {
      setThresholdDb(status.config.thresholdDb);
      setDwellMs(status.config.dwellMs);
      setSquelchTimeout(status.config.squelchTimeoutMs);
      setMaxParkMs(status.config.maxParkMs);
      setGain(status.config.gain);
      setScanRanges(status.config.ranges);
    }
  }, [status?.config]);

  // ── WebSocket for audio + real-time data ──
  const connectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState < 2) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/scanner-audio`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setAudioConnected(true);
      showToast('WebSocket connected', 'info');
    };
    ws.onclose = () => {
      setWsConnected(false);
      setAudioConnected(false);
      wsRef.current = null;
      // Auto-reconnect
      reconnectTimerRef.current = setTimeout(() => connectWs(), 3000);
    };
    ws.onerror = () => {};
    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        // Binary PCM audio
        const floats = new Float32Array(evt.data);
        if (noiseReduction) {
          nrBufferRef.current.push(floats);
          if (nrBufferRef.current.length > 3) nrBufferRef.current.shift();
          // Average last 3 frames
          if (nrBufferRef.current.length >= 2) {
            const avg = new Float32Array(floats.length);
            for (let i = 0; i < floats.length; i++) {
              let s = 0;
              for (const b of nrBufferRef.current) s += (b[i] || 0);
              avg[i] = s / nrBufferRef.current.length;
            }
            audioQueueRef.current.push(avg);
          } else {
            audioQueueRef.current.push(floats);
          }
        } else {
          audioQueueRef.current.push(floats);
        }
        while (audioQueueRef.current.length > 20) audioQueueRef.current.shift();
      } else {
        // JSON message
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'scanner_meta') {
            setStatus(prev => prev ? {
              ...prev,
              state: data.state,
              currentFrequency: data.frequency,
              signalStrengthDb: data.signalStrengthDb,
              noiseFloorDb: data.noiseFloorDb,
              parkedChannel: data.channel,
            } : prev);
          } else if (data.type === 'scanner_fft') {
            setFftData(data);
          }
        } catch {}
      }
    };
  }, [noiseReduction]);

  const disconnectWs = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setWsConnected(false);
    setAudioConnected(false);
  }, []);

  // Setup AudioContext
  const setupAudio = useCallback(() => {
    if (audioCtxRef.current) return;
    const ctx = new AudioContext({ sampleRate: 8000 });
    ctx.resume();
    audioCtxRef.current = ctx;
    const g = ctx.createGain();
    g.gain.value = muted ? 0 : volume;
    g.connect(ctx.destination);
    gainNodeRef.current = g;

    const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      const output = e.outputBuffer.getChannelData(0);
      output.fill(0);
      const queue = audioQueueRef.current;
      let written = 0;
      while (written < output.length && queue.length > 0) {
        const chunk = queue[0];
        const needed = output.length - written;
        if (chunk.length <= needed) {
          output.set(chunk, written);
          written += chunk.length;
          queue.shift();
        } else {
          output.set(chunk.subarray(0, needed), written);
          queue[0] = chunk.subarray(needed);
          written = output.length;
        }
      }
      let peak = 0;
      for (let i = 0; i < output.length; i++) {
        const a = Math.abs(output[i]);
        if (a > peak) peak = a;
      }
      setAudioLevel(peak);
    };
    const silentSource = ctx.createBufferSource();
    silentSource.buffer = ctx.createBuffer(1, 2048, 8000);
    silentSource.loop = true;
    silentSource.connect(scriptNode);
    scriptNode.connect(g);
    silentSource.start();
    scriptNodeRef.current = scriptNode;
  }, [volume, muted]);

  // Update gain
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = muted ? 0 : volume;
  }, [volume, muted]);

  // ── Spectrum canvas drawing ──
  useEffect(() => {
    if (!fftData || !spectrumCanvasRef.current) return;
    const canvas = spectrumCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);
    
    const mags = fftData.magnitudes;
    const len = mags.length;
    const step = len / w;
    const minDb = -120;
    const maxDb = -20;
    const range = maxDb - minDb;
    
    // Draw spectrum
    ctx.beginPath();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x++) {
      const idx = Math.floor(x * step);
      const db = mags[idx] || minDb;
      const y = h - ((db - minDb) / range) * h;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Fill under
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 229, 255, 0.05)';
    ctx.fill();
    
    // Threshold line
    const threshY = h - ((fftData.noiseFloor + thresholdDb - minDb) / range) * h;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 171, 0, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Noise floor line
    const nfY = h - ((fftData.noiseFloor - minDb) / range) * h;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([2, 6]);
    ctx.moveTo(0, nfY);
    ctx.lineTo(w, nfY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Signal markers
    if (fftData.signalDetected) {
      const peakX = (fftData.peakBin / len) * w;
      const peakY = h - ((fftData.peakDb - minDb) / range) * h;
      ctx.beginPath();
      ctx.arc(peakX, peakY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff1744';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(peakX, peakY, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.4)';
      ctx.stroke();
    }
    
    // Parked channel bandwidth highlight
    if (status?.state === 'PARKED' && status.parkedChannel) {
      const cf = fftData.centerFrequency;
      const sr = fftData.sampleRate;
      const freq = status.currentFrequency;
      const bwHz = 12500; // NFM bandwidth
      const xCenter = ((freq - cf + sr / 2) / sr) * w;
      const xWidth = (bwHz / sr) * w;
      ctx.fillStyle = 'rgba(255, 23, 68, 0.15)';
      ctx.fillRect(xCenter - xWidth / 2, 0, xWidth, h);
    }
    
    // Freq labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px monospace';
    const cf = fftData.centerFrequency;
    const sr = fftData.sampleRate;
    for (let i = 0; i <= 4; i++) {
      const f = cf - sr / 2 + (sr * i) / 4;
      const x = (w * i) / 4;
      ctx.fillText(fmtFreq(f), x + 2, h - 3);
    }
  }, [fftData, thresholdDb, status?.state, status?.currentFrequency, status?.parkedChannel]);

  // ── Actions ──
  const showToast = (msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const startScanner = async () => {
    try {
      const r = await fetch('/api/scanner/uhf/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholdDb, dwellMs, squelchTimeoutMs: squelchTimeout }),
      });
      const data = await r.json();
      if (data.error) { showToast(data.error, 'error'); return; }
      setupAudio();
      connectWs();
      fetchStatus();
      showToast('Scanner started', 'info');
    } catch (e: any) { showToast('Failed to start: ' + e.message, 'error'); }
  };

  const stopScanner = async () => {
    await fetch('/api/scanner/uhf/stop', { method: 'POST' });
    disconnectWs();
    if (scriptNodeRef.current) { scriptNodeRef.current.disconnect(); scriptNodeRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    gainNodeRef.current = null;
    fetchStatus();
    showToast('Scanner stopped', 'info');
  };

  const lockFreq = async (freq: number) => {
    await fetch('/api/scanner/uhf/lock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frequency: freq }),
    });
    fetchStatus();
  };

  const unlockFreq = async () => {
    await fetch('/api/scanner/uhf/unlock', { method: 'POST' });
    fetchStatus();
  };

  const lockoutCurrent = async () => {
    await fetch('/api/scanner/uhf/lockout-current', { method: 'POST' });
    fetchStatus(); fetchLockouts();
  };

  const removeLockout = async (id: number) => {
    await fetch(`/api/scanner/uhf/lockouts/${id}`, { method: 'DELETE' });
    fetchLockouts();
  };

  const clearAllLockouts = async () => {
    await fetch('/api/scanner/uhf/lockouts', { method: 'DELETE' });
    fetchLockouts();
  };

  const updateServerConfig = async (updates: Partial<ScannerConfig>) => {
    await fetch('/api/scanner/uhf/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  };

  const addChannel = async (ch: Partial<ScannerChannel>) => {
    await fetch('/api/scanner/uhf/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ch),
    });
    fetchChannels();
    setShowAddChannel(false);
  };

  const updateChannel = async (id: number, updates: Partial<ScannerChannel>) => {
    await fetch(`/api/scanner/uhf/channels/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    fetchChannels();
    setEditingChannel(null);
  };

  const deleteChannel = async (id: number) => {
    await fetch(`/api/scanner/uhf/channels/${id}`, { method: 'DELETE' });
    fetchChannels();
  };

  const deleteRecording = async (filename: string) => {
    await fetch(`/api/scanner/uhf/recordings/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    fetchRecordings();
  };

  const setGainServer = async (g: number) => {
    await fetch('/api/sdr/gain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gain: g }),
    });
  };

  const switchMode = async (newMode: 'SCANNER' | 'PAGER') => {
    if (newMode === mode) return;
    if (newMode === 'SCANNER') {
      // Stop pager, start scanner
      await fetch('/api/scanner/uhf/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholdDb, dwellMs, squelchTimeoutMs: squelchTimeout }),
      });
      setupAudio();
      connectWs();
    } else {
      // Stop scanner, resume pager
      await fetch('/api/scanner/uhf/stop', { method: 'POST' });
      disconnectWs();
      await fetch('/api/sdr/multiplexer/reconnect', { method: 'POST' });
    }
    setMode(newMode);
    fetchStatus();
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (status?.state === 'IDLE') startScanner();
          else stopScanner();
          break;
        case 'l': case 'L':
          if (status?.state === 'PARKED') lockoutCurrent();
          break;
        case 'r': case 'R':
          if (status?.state === 'PARKED') unlockFreq();
          break;
        case 'm': case 'M':
          setMuted(prev => !prev);
          break;
        case 's': case 'S':
          setShowSettings(prev => !prev);
          break;
        case 'h': case 'H':
          if (status?.state === 'SCANNING' && status.currentFrequency) lockFreq(status.currentFrequency);
          break;
        case '+': case '=':
          setVolume(v => Math.min(1, v + 0.1));
          break;
        case '-': case '_':
          setVolume(v => Math.max(0, v - 0.1));
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status?.state, status?.currentFrequency]);

  // Refresh recordings periodically when scanner active
  useEffect(() => {
    if (status?.state !== 'IDLE') {
      const iv = setInterval(() => { fetchRecordings(); fetchHits(); }, 5000);
      return () => clearInterval(iv);
    }
  }, [status?.state]);

  const state = status?.state || 'IDLE';
  const isActive = state !== 'IDLE';
  const isParked = state === 'PARKED';
  const isScanning = state === 'SCANNING';
  const isRecordingVOX = isParked; // VOX records when parked

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-all ${
          toast.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-cyan-500/90 text-black'
        }`}>{toast.msg}</div>
      )}

      {/* ── Top Bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 bg-[#0d0d15] shrink-0">
        {/* Mode Switch */}
        <div className="flex items-center bg-white/5 rounded overflow-hidden">
          <button onClick={() => switchMode('PAGER')} className={`px-3 py-1 text-xs font-bold transition ${mode === 'PAGER' ? 'bg-purple-500/30 text-purple-300' : 'text-white/30 hover:text-white/60'}`}>📟 PAGER</button>
          <button onClick={() => switchMode('SCANNER')} className={`px-3 py-1 text-xs font-bold transition ${mode === 'SCANNER' ? 'bg-cyan-500/30 text-cyan-300' : 'text-white/30 hover:text-white/60'}`}>📡 SCANNER</button>
        </div>

        {/* State */}
        <div className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider ${
          state === 'IDLE' ? 'bg-white/10 text-white/40' :
          isScanning ? 'bg-cyan-500/20 text-cyan-400 animate-pulse' :
          state === 'SIGNAL_DETECTED' ? 'bg-amber-500/20 text-amber-400' :
          'bg-red-500/20 text-red-400'
        }`}>{state}</div>

        <div className="text-xs text-white/40">Hits: <span className="text-amber-400">{status?.hits || 0}</span></div>
        {isActive && <div className="text-xs text-white/30">{fmtUptime(status?.uptime || 0)}</div>}

        <div className="flex-1" />

        {/* Connection indicators */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${wsConnected ? 'text-green-400' : 'text-red-400'}`}>
            {wsConnected ? '● WS' : '○ WS'}
          </span>
          <span className={`text-[10px] ${audioConnected ? 'text-green-400' : 'text-red-400'}`}>
            {audioConnected ? '● AUD' : '○ AUD'}
          </span>
          {isRecordingVOX && <span className="text-[10px] text-red-400 animate-pulse">● REC</span>}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {!isActive ? (
            <button onClick={startScanner} className="px-4 py-1.5 bg-cyan-500/20 text-cyan-400 rounded text-sm font-semibold hover:bg-cyan-500/30 transition">▶ Start</button>
          ) : (
            <button onClick={stopScanner} className="px-4 py-1.5 bg-red-500/20 text-red-400 rounded text-sm font-semibold hover:bg-red-500/30 transition">■ Stop</button>
          )}
          {isParked && (
            <>
              <button onClick={unlockFreq} className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded text-xs hover:bg-amber-500/30">Resume</button>
              <button onClick={lockoutCurrent} className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30" title="Lock out">🚫 L/O</button>
            </>
          )}
          <button onClick={() => setShowSettings(!showSettings)} className={`px-3 py-1.5 rounded text-xs ${showSettings ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40 hover:text-white/60'}`}>⚙</button>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left Sidebar ── */}
        <div className="w-72 border-r border-white/10 flex flex-col bg-[#0d0d15] shrink-0">
          {/* Tab buttons */}
          <div className="flex border-b border-white/5">
            {(['channels', 'lockouts', 'recordings', 'stats'] as const).map(tab => (
              <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'stats') fetchStats(); if (tab === 'recordings') fetchRecordings(); }}
                className={`flex-1 px-2 py-1.5 text-[10px] uppercase tracking-wider transition ${activeTab === tab ? 'text-cyan-400 border-b border-cyan-400' : 'text-white/30 hover:text-white/50'}`}>
                {tab}
                {tab === 'lockouts' && lockouts.length > 0 && (
                  <span className="ml-1 bg-red-500/30 text-red-400 px-1 rounded text-[9px]">{lockouts.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'channels' && (
              <ChannelsPanel
                channels={channels}
                activeChannelId={status?.parkedChannel?.id || null}
                onTune={lockFreq}
                onAdd={() => setShowAddChannel(true)}
                onEdit={setEditingChannel}
                onDelete={deleteChannel}
              />
            )}
            {activeTab === 'lockouts' && (
              <LockoutsPanel lockouts={lockouts} onRemove={removeLockout} onClearAll={clearAllLockouts} />
            )}
            {activeTab === 'recordings' && (
              <RecordingsPanel
                recordings={recordings}
                channels={channels}
                playingUrl={playingRecording}
                onPlay={(url) => { setPlayingRecording(url); }}
                onDelete={deleteRecording}
              />
            )}
            {activeTab === 'stats' && <StatsPanel stats={stats} />}
          </div>
        </div>

        {/* ── Center ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Frequency Display */}
          <div className="flex flex-col items-center py-4 bg-gradient-to-b from-[#0a0a0f] to-[#0d0d15] shrink-0">
            <div className="text-5xl tracking-tight transition-all duration-150" style={{
              color: isParked ? '#ff1744' : isScanning ? '#00e5ff' : '#ffffff30',
              textShadow: isParked ? '0 0 30px rgba(255,23,68,0.4)' : isScanning ? '0 0 30px rgba(0,229,255,0.3)' : 'none',
            }}>
              {status?.currentFrequency ? (
                <>
                  {fmtFreq(status.currentFrequency)}
                  <span className="text-xl text-white/30 ml-2">MHz</span>
                </>
              ) : (
                <span className="text-white/20">----.----</span>
              )}
            </div>
            {/* Channel label */}
            {status?.parkedChannel && (
              <div className="mt-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getCatColor(status.parkedChannel.category) }} />
                <span className="text-sm" style={{ color: getCatColor(status.parkedChannel.category) }}>{status.parkedChannel.label}</span>
                <span className="text-[10px] px-1.5 rounded" style={{ backgroundColor: getCatColor(status.parkedChannel.category) + '20', color: getCatColor(status.parkedChannel.category) }}>{status.parkedChannel.category}</span>
              </div>
            )}
            {isScanning && !isParked && (
              <div className="text-[10px] text-cyan-400/50 mt-1 animate-pulse">SCANNING...</div>
            )}
            {/* S-Meter */}
            <div className="text-xs text-white/30 mt-1">
              {status?.signalStrengthDb !== undefined ? dbToSMeter(status.signalStrengthDb) : ''}
            </div>
          </div>

          {/* Signal Meter */}
          <div className="px-4 py-2 border-y border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40 w-6">SIG</span>
              <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden relative">
                <div className="h-full rounded transition-all duration-150" style={{
                  width: `${Math.max(0, Math.min(100, ((status?.signalStrengthDb ?? -120) + 120) / 80 * 100))}%`,
                  background: isParked
                    ? 'linear-gradient(90deg, #00e5ff, #ff1744)'
                    : 'linear-gradient(90deg, #00c853 0%, #00e5ff 40%, #ffab00 70%, #ff1744 100%)',
                }} />
                {/* Threshold marker */}
                <div className="absolute top-0 h-full w-0.5 bg-amber-400/60" style={{
                  left: `${Math.max(0, Math.min(100, ((status?.noiseFloorDb ?? -100) + thresholdDb + 120) / 80 * 100))}%`,
                }} />
              </div>
              <span className="text-[10px] text-white/50 w-14 text-right">{status?.signalStrengthDb?.toFixed(1) ?? '---'} dB</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-white/40 w-6">NF</span>
              <div className="flex-1 h-1 bg-white/5 rounded overflow-hidden">
                <div className="h-full bg-white/15 rounded" style={{
                  width: `${Math.max(0, Math.min(100, ((status?.noiseFloorDb ?? -100) + 120) / 80 * 100))}%`,
                }} />
              </div>
              <span className="text-[10px] text-white/30 w-14 text-right">{status?.noiseFloorDb?.toFixed(1) ?? '---'} dB</span>
            </div>
          </div>

          {/* Spectrum Display */}
          <div className="shrink-0 border-b border-white/10">
            <canvas ref={spectrumCanvasRef} width={800} height={160} className="w-full" style={{ height: '160px', imageRendering: 'pixelated' }} />
          </div>

          {/* Audio Controls */}
          {isActive && (
            <div className="px-4 py-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <button onClick={() => setMuted(!muted)} className={`text-base ${muted ? 'text-red-400' : 'text-cyan-400'}`}>
                  {muted ? '🔇' : '🔊'}
                </button>
                <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => setVolume(parseFloat(e.target.value))} className="w-20 accent-cyan-500" />
                <span className="text-[10px] text-white/40 w-8">{Math.round(volume * 100)}%</span>
                {/* VU meter */}
                <div className="flex-1 h-3 bg-white/5 rounded overflow-hidden">
                  <div className="h-full rounded transition-all duration-75" style={{
                    width: `${Math.min(100, audioLevel * 200)}%`,
                    background: audioLevel > 0.5 ? '#ff1744' : audioLevel > 0.2 ? '#ffab00' : '#00e5ff',
                  }} />
                </div>
                <label className="flex items-center gap-1 text-[10px] text-white/40 cursor-pointer">
                  <input type="checkbox" checked={noiseReduction} onChange={e => setNoiseReduction(e.target.checked)} className="w-3 h-3" />
                  NR
                </label>
              </div>
            </div>
          )}

          {/* Settings Panel */}
          {showSettings && (
            <SettingsPanel
              thresholdDb={thresholdDb} setThresholdDb={(v) => { setThresholdDb(v); updateServerConfig({ thresholdDb: v }); }}
              dwellMs={dwellMs} setDwellMs={(v) => { setDwellMs(v); updateServerConfig({ dwellMs: v }); }}
              squelchTimeout={squelchTimeout} setSquelchTimeout={(v) => { setSquelchTimeout(v); updateServerConfig({ squelchTimeoutMs: v }); }}
              maxParkMs={maxParkMs} setMaxParkMs={(v) => { setMaxParkMs(v); updateServerConfig({ maxParkMs: v }); }}
              gain={gain} setGain={(v) => { setGain(v); setGainServer(v); }}
              scanRanges={scanRanges}
              onSetPreset={(ranges) => { setScanRanges(ranges); updateServerConfig({ ranges }); }}
              config={status?.config}
            />
          )}

          {/* Activity Log */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/5 shrink-0 flex items-center justify-between">
              <span>Activity Log</span>
              <span className="text-white/20">{hits.length} hits</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {hits.length === 0 ? (
                <div className="p-4 text-xs text-white/20 text-center">No signals detected yet</div>
              ) : (
                hits.slice(0, 100).map(hit => {
                  const ch = channels.find(c => c.id === hit.channel_id);
                  const color = ch ? getCatColor(ch.category) : '#ffffff';
                  return (
                    <div key={hit.id} className="px-3 py-1.5 border-b border-white/5 hover:bg-white/5 cursor-pointer flex items-center gap-2" onClick={() => lockFreq(hit.frequency)}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[11px]" style={{ color }}>{fmtFreq(hit.frequency)}</span>
                      <span className="text-[10px] text-white/30">{hit.signal_strength_db.toFixed(1)}dB</span>
                      <span className="text-[10px] text-white/20">{fmtDuration(hit.duration_ms)}</span>
                      {ch && <span className="text-[10px] text-white/40 truncate">{ch.label}</span>}
                      <span className="text-[10px] text-white/20 ml-auto shrink-0">{fmtTime(hit.timestamp)}</span>
                      {hit.audio_clip_path && <span className="text-[10px]">🎙</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recording Playback (hidden audio element) */}
      {playingRecording && (
        <audio ref={audioPlayerRef} src={playingRecording} autoPlay onEnded={() => setPlayingRecording(null)}
          style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', height: 32, zIndex: 100 }} controls />
      )}

      {/* Add Channel Modal */}
      {showAddChannel && <ChannelFormModal onSave={addChannel} onClose={() => setShowAddChannel(false)} />}
      {editingChannel && <ChannelFormModal channel={editingChannel} onSave={(ch) => updateChannel(editingChannel.id, ch)} onClose={() => setEditingChannel(null)} />}

      {/* Keyboard shortcuts hint */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-1 border-t border-white/5 bg-[#0d0d15] text-[9px] text-white/15">
        <span>Space: Start/Stop</span>
        <span>L: Lockout</span>
        <span>R: Resume</span>
        <span>H: Hold</span>
        <span>M: Mute</span>
        <span>S: Settings</span>
        <span>+/-: Volume</span>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function ChannelsPanel({ channels, activeChannelId, onTune, onAdd, onEdit, onDelete }: {
  channels: ScannerChannel[];
  activeChannelId: number | null;
  onTune: (freq: number) => void;
  onAdd: () => void;
  onEdit: (ch: ScannerChannel) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div>
      <div className="p-2 border-b border-white/5">
        <button onClick={onAdd} className="w-full px-3 py-1.5 bg-cyan-500/10 text-cyan-400 rounded text-xs hover:bg-cyan-500/20 transition">+ Add Channel</button>
      </div>
      {channels.map(ch => {
        const color = getCatColor(ch.category);
        const isActive = ch.id === activeChannelId;
        return (
          <div key={ch.id} className={`group px-3 py-2 border-b border-white/5 hover:bg-white/5 transition cursor-pointer ${isActive ? 'bg-white/10 border-l-2' : ''}`}
            style={isActive ? { borderLeftColor: color } : {}}
            onClick={() => onTune(ch.frequency)}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: isActive ? `0 0 6px ${color}` : 'none' }} />
              <span className="text-xs" style={{ color }}>{fmtFreq(ch.frequency)}</span>
              {isActive && <span className="text-[9px] text-red-400 animate-pulse">◄ TUNED</span>}
              <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onClick={(e) => { e.stopPropagation(); onEdit(ch); }} className="text-[10px] text-white/30 hover:text-white/60">✏️</button>
                <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete channel?')) onDelete(ch.id); }} className="text-[10px] text-white/30 hover:text-red-400">✕</button>
              </div>
            </div>
            <div className="text-[11px] text-white/50 truncate mt-0.5">{ch.label}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] px-1 rounded" style={{ backgroundColor: color + '20', color }}>{ch.category}</span>
              <span className="text-[9px] text-white/25">{ch.mode}</span>
              <span className="text-[9px] text-white/20">P{ch.priority}</span>
              {!ch.enabled && <span className="text-[9px] text-red-400">OFF</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LockoutsPanel({ lockouts, onRemove, onClearAll }: {
  lockouts: any[];
  onRemove: (id: number) => void;
  onClearAll: () => void;
}) {
  return (
    <div>
      {lockouts.length > 0 && (
        <div className="p-2 border-b border-white/5">
          <button onClick={onClearAll} className="w-full px-3 py-1.5 bg-red-500/10 text-red-400 rounded text-xs hover:bg-red-500/20">Clear All ({lockouts.length})</button>
        </div>
      )}
      {lockouts.length === 0 ? (
        <div className="p-4 text-xs text-white/20 text-center">No lockouts</div>
      ) : lockouts.map((lo: any) => (
        <div key={lo.id} className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
          <span className="text-xs text-red-400">{fmtFreq(lo.frequency)}</span>
          <span className="text-[10px] text-white/30 truncate flex-1">{lo.label || ''}</span>
          <span className="text-[9px] text-white/20">{lo.added ? new Date(lo.added).toLocaleDateString() : ''}</span>
          <button onClick={() => onRemove(lo.id)} className="text-[10px] text-white/30 hover:text-green-400">✓</button>
        </div>
      ))}
    </div>
  );
}

function RecordingsPanel({ recordings, channels, playingUrl, onPlay, onDelete }: {
  recordings: Recording[];
  channels: ScannerChannel[];
  playingUrl: string | null;
  onPlay: (url: string) => void;
  onDelete: (filename: string) => void;
}) {
  return (
    <div>
      {recordings.length === 0 ? (
        <div className="p-4 text-xs text-white/20 text-center">No recordings yet</div>
      ) : recordings.map((rec) => {
        const ch = channels.find(c => c.id === rec.channel_id);
        const isPlaying = playingUrl === rec.url;
        return (
          <div key={rec.id} className={`px-3 py-2 border-b border-white/5 ${isPlaying ? 'bg-cyan-500/10' : 'hover:bg-white/5'}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-cyan-400">{fmtFreq(rec.frequency)}</span>
              <span className="text-[10px] text-white/30">{fmtDuration(rec.duration_ms)}</span>
              <span className="text-[10px] text-white/20">{rec.size ? (rec.size / 1024).toFixed(0) + 'kb' : ''}</span>
            </div>
            {ch && <div className="text-[10px] text-white/40 mt-0.5">{ch.label}</div>}
            <div className="text-[9px] text-white/20 mt-0.5">{fmtTime(rec.timestamp)}</div>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => onPlay(rec.url)} className={`text-[10px] px-2 py-0.5 rounded ${isPlaying ? 'bg-cyan-500/30 text-cyan-400' : 'bg-white/5 text-white/40 hover:text-white/60'}`}>
                {isPlaying ? '⏸ Playing' : '▶ Play'}
              </button>
              <a href={rec.url} download className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/40 hover:text-white/60">⬇</a>
              <button onClick={() => onDelete(rec.filename)} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-red-400/50 hover:text-red-400">🗑</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatsPanel({ stats }: { stats: ScannerStats | null }) {
  if (!stats) return <div className="p-4 text-xs text-white/20 text-center">Loading...</div>;
  
  const maxHourly = Math.max(1, ...stats.hourlyHits.map(h => h.count));
  const totalCat = stats.categoryBreakdown.reduce((s, c) => s + c.count, 0) || 1;
  
  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StatBox label="Total Hits" value={stats.totalHits} />
        <StatBox label="Unique Freqs" value={stats.uniqueFreqs} />
        <StatBox label="Recordings" value={stats.recordingCount} />
        <StatBox label="Scan Time" value={fmtUptime(stats.totalScanTime)} />
      </div>
      {stats.busiestFrequency && (
        <div className="text-[10px] text-white/30">
          Busiest: <span className="text-amber-400">{fmtFreq(stats.busiestFrequency)} MHz</span> ({stats.busiestFrequencyHits} hits)
        </div>
      )}
      {/* Hourly histogram */}
      <div>
        <div className="text-[10px] text-white/30 mb-1">Hourly Activity</div>
        <div className="flex items-end gap-px h-12">
          {Array.from({ length: 24 }, (_, h) => {
            const entry = stats.hourlyHits.find(e => e.hour === h);
            const count = entry?.count || 0;
            const height = (count / maxHourly) * 100;
            return <div key={h} className="flex-1 bg-cyan-500/40 rounded-t transition-all" style={{ height: `${height}%`, minHeight: count > 0 ? 2 : 0 }} title={`${h}:00 — ${count} hits`} />;
          })}
        </div>
        <div className="flex justify-between text-[8px] text-white/15 mt-0.5">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
      {/* Category breakdown */}
      <div>
        <div className="text-[10px] text-white/30 mb-1">Categories</div>
        {stats.categoryBreakdown.map(c => (
          <div key={c.category} className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getCatColor(c.category) }} />
            <span className="text-[10px] text-white/40 flex-1">{c.category}</span>
            <div className="w-20 h-1.5 bg-white/5 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${(c.count / totalCat) * 100}%`, backgroundColor: getCatColor(c.category) }} />
            </div>
            <span className="text-[10px] text-white/30 w-6 text-right">{c.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white/5 rounded p-2">
      <div className="text-[9px] text-white/30 uppercase">{label}</div>
      <div className="text-sm text-cyan-400">{value}</div>
    </div>
  );
}

function SettingsPanel({ thresholdDb, setThresholdDb, dwellMs, setDwellMs, squelchTimeout, setSquelchTimeout, maxParkMs, setMaxParkMs, gain, setGain, scanRanges, onSetPreset, config }: {
  thresholdDb: number; setThresholdDb: (v: number) => void;
  dwellMs: number; setDwellMs: (v: number) => void;
  squelchTimeout: number; setSquelchTimeout: (v: number) => void;
  maxParkMs: number; setMaxParkMs: (v: number) => void;
  gain: number; setGain: (v: number) => void;
  scanRanges: ScanRange[];
  onSetPreset: (ranges: ScanRange[]) => void;
  config: ScannerConfig | undefined;
}) {
  return (
    <div className="px-4 py-3 border-b border-white/10 bg-[#0d0d15] shrink-0 space-y-3 max-h-64 overflow-y-auto">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <SettingSlider label="Threshold (dB)" min={3} max={30} step={1} value={thresholdDb} onChange={setThresholdDb} color="amber" suffix=" dB" />
        <SettingSlider label="Dwell (ms)" min={50} max={500} step={10} value={dwellMs} onChange={setDwellMs} color="cyan" suffix="ms" />
        <SettingSlider label="Squelch (s)" min={1000} max={10000} step={500} value={squelchTimeout} onChange={setSquelchTimeout} color="green" suffix={`${(squelchTimeout / 1000).toFixed(1)}s`} displayValue={false} />
        <SettingSlider label="Max Park (s)" min={5000} max={60000} step={1000} value={maxParkMs} onChange={setMaxParkMs} color="purple" suffix={`${(maxParkMs / 1000).toFixed(0)}s`} displayValue={false} />
        <SettingSlider label="Gain" min={0} max={50} step={1} value={gain} onChange={setGain} color="yellow" suffix="" />
      </div>
      {/* Scan Range Presets */}
      <div>
        <div className="text-[10px] text-white/30 mb-1">Scan Range Presets</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(SCAN_PRESETS).map(([name, ranges]) => (
            <button key={name} onClick={() => onSetPreset(ranges)} className="px-2 py-1 bg-white/5 text-[10px] text-white/40 rounded hover:bg-white/10 hover:text-white/60 transition">{name}</button>
          ))}
        </div>
      </div>
      {/* Current ranges */}
      {scanRanges.length > 0 && (
        <div className="text-[9px] text-white/20">
          {scanRanges.map((r, i) => (
            <span key={i} className="mr-2">{fmtFreq(r.start)}–{fmtFreq(r.end)}</span>
          ))}
        </div>
      )}
      {/* SDR info */}
      {config && (
        <div className="text-[9px] text-white/15">
          Sample Rate: {(config.sampleRate / 1e6).toFixed(3)} MHz
        </div>
      )}
    </div>
  );
}

function SettingSlider({ label, min, max, step, value, onChange, color, suffix, displayValue = true }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
  color: string; suffix: string; displayValue?: boolean;
}) {
  const colorClass = `accent-${color}-500`;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/30 uppercase">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className={`w-full ${colorClass}`} />
      <span className={`text-[10px] text-${color}-400`}>{displayValue ? value : ''}{suffix}</span>
    </div>
  );
}

function ChannelFormModal({ channel, onSave, onClose }: {
  channel?: ScannerChannel;
  onSave: (ch: Partial<ScannerChannel>) => void;
  onClose: () => void;
}) {
  const [freq, setFreq] = useState(channel ? (channel.frequency / 1e6).toString() : '');
  const [label, setLabel] = useState(channel?.label || '');
  const [category, setCategory] = useState(channel?.category || 'unknown');
  const [mode, setMode] = useState<'NFM' | 'AM'>(channel?.mode || 'NFM');
  const [priority, setPriority] = useState(channel?.priority || 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#151520] rounded-lg p-4 w-80 border border-white/10" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white/80 mb-3">{channel ? 'Edit Channel' : 'Add Channel'}</h3>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-white/40">Frequency (MHz)</label>
            <input value={freq} onChange={e => setFreq(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white" placeholder="455.025" autoFocus />
          </div>
          <div>
            <label className="text-[10px] text-white/40">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white" placeholder="Airport Ground" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-white/40">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white">
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="text-[10px] text-white/40">Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value as any)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white">
                <option value="NFM">NFM</option>
                <option value="AM">AM</option>
              </select>
            </div>
            <div className="w-16">
              <label className="text-[10px] text-white/40">Priority</label>
              <input type="number" min={1} max={10} value={priority} onChange={e => setPriority(parseInt(e.target.value) || 5)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-white/40 hover:text-white/60">Cancel</button>
          <button onClick={() => onSave({ frequency: parseFloat(freq) * 1e6, label, category, mode, priority })} className="px-3 py-1.5 bg-cyan-500/20 text-cyan-400 rounded text-xs hover:bg-cyan-500/30">Save</button>
        </div>
      </div>
    </div>
  );
}
