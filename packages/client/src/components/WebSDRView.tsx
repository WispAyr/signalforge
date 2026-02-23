import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = "";

interface Receiver {
  id: string;
  name: string;
  location: string;
  url: string;
  type: 'kiwisdr' | 'websdr';
  bands: string;
  status: 'online' | 'offline' | 'unknown';
}

interface SDRStatus {
  connected: boolean;
  receiver: Receiver | null;
  frequency: number;
  mode: string;
  lowCut: number;
  highCut: number;
  streaming: boolean;
}

const MODES = ['am', 'usb', 'lsb', 'cw', 'fm'] as const;

const BANDPLAN: { label: string; start: number; end: number; color: string }[] = [
  { label: 'LW', start: 148, end: 283, color: 'rgba(255,200,0,0.15)' },
  { label: 'MW', start: 520, end: 1710, color: 'rgba(255,150,0,0.15)' },
  { label: '160m', start: 1810, end: 2000, color: 'rgba(0,200,255,0.15)' },
  { label: '80m', start: 3500, end: 3800, color: 'rgba(0,200,255,0.15)' },
  { label: '60m', start: 5351, end: 5367, color: 'rgba(0,200,255,0.15)' },
  { label: '49m SW', start: 5900, end: 6200, color: 'rgba(255,100,255,0.15)' },
  { label: '40m', start: 7000, end: 7200, color: 'rgba(0,200,255,0.15)' },
  { label: '31m SW', start: 9400, end: 9900, color: 'rgba(255,100,255,0.15)' },
  { label: '30m', start: 10100, end: 10150, color: 'rgba(0,200,255,0.15)' },
  { label: '25m SW', start: 11600, end: 12100, color: 'rgba(255,100,255,0.15)' },
  { label: '20m', start: 14000, end: 14350, color: 'rgba(0,200,255,0.15)' },
  { label: '17m', start: 18068, end: 18168, color: 'rgba(0,200,255,0.15)' },
  { label: '15m', start: 21000, end: 21450, color: 'rgba(0,200,255,0.15)' },
  { label: '12m', start: 24890, end: 24990, color: 'rgba(0,200,255,0.15)' },
  { label: '10m', start: 28000, end: 29700, color: 'rgba(0,200,255,0.15)' },
];

const PRESET_FREQUENCIES = [
  { label: 'BBC WS', freq: 5875, mode: 'am', desc: 'BBC World Service' },
  { label: 'WWV 10', freq: 10000, mode: 'am', desc: 'Time signal USA' },
  { label: 'CHU 7', freq: 7850, mode: 'usb', desc: 'Time signal Canada' },
  { label: 'FT8 40m', freq: 7074, mode: 'usb', desc: 'Digital mode' },
  { label: 'FT8 20m', freq: 14074, mode: 'usb', desc: 'Digital mode' },
  { label: 'FT8 30m', freq: 10136, mode: 'usb', desc: 'Digital mode' },
  { label: 'CW 40m', freq: 7030, mode: 'cw', desc: 'Morse code' },
  { label: 'CW 20m', freq: 14060, mode: 'cw', desc: 'Morse code' },
  { label: 'Maritime', freq: 2182, mode: 'usb', desc: 'Distress/calling' },
  { label: 'Navtex', freq: 518, mode: 'cw', desc: 'Maritime weather' },
  { label: 'RAF Volmet', freq: 5450, mode: 'usb', desc: 'Aviation weather' },
  { label: 'Shannon Vol', freq: 3413, mode: 'usb', desc: 'Aviation weather' },
  { label: 'RTE Radio 1', freq: 252, mode: 'am', desc: 'Ireland LW' },
  { label: 'Deutsche W', freq: 6075, mode: 'am', desc: 'Shortwave' },
  { label: 'R Romania', freq: 7220, mode: 'am', desc: 'Shortwave' },
  { label: 'ATIS 40m', freq: 7110, mode: 'lsb', desc: 'Amateur SSB' },
  { label: 'SSB 80m', freq: 3750, mode: 'lsb', desc: 'Amateur SSB' },
  { label: 'SSB 20m', freq: 14200, mode: 'usb', desc: 'Amateur SSB' },
];

export const WebSDRView: React.FC = () => {
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [status, setStatus] = useState<SDRStatus | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<string>('');
  const [frequency, setFrequency] = useState(7074);
  const [mode, setMode] = useState<string>('usb');
  const [volume, setVolume] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freqInput, setFreqInput] = useState('7074');
  const [signalLevel, setSignalLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);

  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const nextPlayTimeRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch receivers
  useEffect(() => {
    fetch(`${API}/api/websdr/receivers`).then(r => r.json()).then(setReceivers).catch(() => {});
    fetch(`${API}/api/websdr/status`).then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  // WebSocket for audio
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const view = new Uint8Array(e.data);
        // Check for 'WSD' tag (0x57=W, 0x53=S, 0x44=D)
        if (view.length > 3 && view[0] === 0x57 && view[1] === 0x53 && view[2] === 0x44) {
          const audioData = e.data.slice(3);
          playAudio(audioData);
        }
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'websdr_connected') {
            setStatus(prev => prev ? { ...prev, connected: true, streaming: true } : prev);
            setError(null);
          } else if (msg.type === 'websdr_disconnected') {
            setStatus(prev => prev ? { ...prev, connected: false, streaming: false } : prev);
          } else if (msg.type === 'websdr_error') {
            setError(msg.message);
          } else if (msg.type === 'websdr_tuned') {
            setFrequency(msg.frequency);
            setFreqInput(String(msg.frequency));
          }
        } catch { /* ignore non-JSON text */ }
      }
    };

    return () => { ws.close(); };
  }, []);

  // Init audio context
  const initAudio = useCallback(() => {
    if (audioCtxRef.current) return;
    const ctx = new AudioContext({ sampleRate: 44100 });
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    gainNodeRef.current = gain;
    analyserRef.current = analyser;
    nextPlayTimeRef.current = 0;
  }, [volume]);

  // Play PCM audio with proper scheduling to avoid gaps/glitches
  const playAudio = useCallback((data: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;

    // PCM 16-bit LE → Float32
    const int16 = new Int16Array(data);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    let peak = 0;
    for (let i = 0; i < int16.length; i++) {
      const s = int16[i] / 32768;
      float32[i] = s;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
    }

    // Update signal meter
    const dbLevel = peak > 0 ? 20 * Math.log10(peak) : -100;
    const normalized = Math.max(0, Math.min(1, (dbLevel + 60) / 60));
    setSignalLevel(normalized);
    setPeakLevel(prev => Math.max(prev * 0.995, normalized));

    // KiwiSDR sends at 12000 Hz — Web Audio will resample automatically
    const buffer = ctx.createBuffer(1, float32.length, 12000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNodeRef.current!);

    // Schedule seamlessly
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) {
      nextPlayTimeRef.current = now + 0.02; // small lead-in
    }
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
  }, []);

  // Volume
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume;
  }, [volume]);

  // Responsive canvas sizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (canvasRef.current) {
        canvasRef.current.width = w;
        canvasRef.current.height = 120;
      }
      if (spectrumCanvasRef.current) {
        spectrumCanvasRef.current.width = w;
        spectrumCanvasRef.current.height = 80;
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Waterfall + spectrum visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    const specCanvas = spectrumCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    const specCtx = specCanvas?.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0) { animFrameRef.current = requestAnimationFrame(draw); return; }

      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);

      // Waterfall: shift down, draw new line at top
      const imageData = ctx.getImageData(0, 0, width, height - 1);
      ctx.putImageData(imageData, 0, 1);

      for (let x = 0; x < width; x++) {
        const i = Math.floor((x / width) * bufLen);
        const v = data[i];
        let r = 0, g = 0, b = 0;
        if (v < 64) { b = v * 4; }
        else if (v < 128) { b = 255; g = (v - 64) * 4; }
        else if (v < 192) { g = 255; b = 255 - (v - 128) * 4; r = (v - 128) * 4; }
        else { r = 255; g = 255; b = (v - 192) * 4; }
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, 0, 1, 1);
      }

      // Spectrum overlay
      if (specCtx && specCanvas) {
        const sw = specCanvas.width;
        const sh = specCanvas.height;
        specCtx.clearRect(0, 0, sw, sh);

        // Grid lines
        specCtx.strokeStyle = 'rgba(100,100,100,0.3)';
        specCtx.lineWidth = 0.5;
        for (let y = 0; y < sh; y += sh / 4) {
          specCtx.beginPath();
          specCtx.moveTo(0, y);
          specCtx.lineTo(sw, y);
          specCtx.stroke();
        }

        // Spectrum line
        specCtx.beginPath();
        specCtx.strokeStyle = '#00e5ff';
        specCtx.lineWidth = 1.5;
        for (let x = 0; x < sw; x++) {
          const i = Math.floor((x / sw) * bufLen);
          const v = data[i] / 255;
          const y = sh - v * sh;
          if (x === 0) specCtx.moveTo(x, y);
          else specCtx.lineTo(x, y);
        }
        specCtx.stroke();

        // Fill under curve
        specCtx.lineTo(sw, sh);
        specCtx.lineTo(0, sh);
        specCtx.closePath();
        specCtx.fillStyle = 'rgba(0,229,255,0.08)';
        specCtx.fill();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [status?.connected]);

  const handleConnect = async () => {
    if (!selectedReceiver) return;
    setLoading(true);
    setError(null);
    initAudio();
    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    try {
      const res = await fetch(`${API}/api/websdr/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: selectedReceiver, frequency, mode }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setStatus(data.status);
        if (!data.ok && !data.error) {
          setError('Connection failed — receiver may be offline or full');
        }
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${API}/api/websdr/disconnect`, { method: 'POST' });
      setStatus(prev => prev ? { ...prev, connected: false, streaming: false } : prev);
      setSignalLevel(0);
      setPeakLevel(0);
      nextPlayTimeRef.current = 0;
    } catch {}
  };

  const handleTune = async () => {
    const freq = parseInt(freqInput);
    if (isNaN(freq) || freq < 1) return;
    setFrequency(freq);
    try {
      const res = await fetch(`${API}/api/websdr/tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: freq, mode }),
      });
      const data = await res.json();
      if (data.status) setStatus(data.status);
    } catch {}
  };

  const handlePreset = async (freq: number, presetMode: string) => {
    setFrequency(freq);
    setFreqInput(String(freq));
    setMode(presetMode);
    if (status?.connected) {
      try {
        const res = await fetch(`${API}/api/websdr/tune`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frequency: freq, mode: presetMode }),
        });
        const data = await res.json();
        if (data.status) setStatus(data.status);
      } catch {}
    }
  };

  const getBandForFreq = (freq: number) => {
    return BANDPLAN.find(b => freq >= b.start && freq <= b.end);
  };

  const currentBand = getBandForFreq(frequency);

  // S-meter: convert normalized level to S-units
  const getSMeter = (level: number): string => {
    if (level <= 0) return 'S0';
    const s = Math.min(9, Math.floor(level * 12));
    if (s <= 9 && level < 0.8) return `S${s}`;
    const db = Math.round((level - 0.75) * 60);
    return db > 0 ? `S9+${db}dB` : `S${s}`;
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-forge-text flex items-center gap-2">
            🌍 WebSDR — Real Radio
          </h2>
          <p className="text-sm text-forge-muted">
            Connect to public radio receivers worldwide. No hardware needed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status?.connected && status.receiver && (
            <span className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded">
              📡 {status.receiver.name} — {status.receiver.location}
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-forge-muted">
              {status?.connected ? 'Streaming' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Receiver Browser */}
        <div className="lg:col-span-1 bg-forge-surface rounded-lg border border-forge-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-forge-text">📡 Receivers</h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {receivers.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedReceiver(r.url)}
                className={`w-full text-left p-2 rounded text-xs transition-colors ${
                  selectedReceiver === r.url
                    ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
                    : 'hover:bg-forge-border/30 text-forge-muted'
                }`}
              >
                <div className="font-medium text-forge-text">{r.name}</div>
                <div className="flex justify-between">
                  <span>📍 {r.location}</span>
                  <span className="uppercase text-[10px] px-1 rounded bg-forge-border/50">
                    {r.type}
                  </span>
                </div>
                <div className="text-[10px] opacity-70">{r.bands}</div>
              </button>
            ))}
          </div>

          {/* Receiver info when connected */}
          {status?.connected && status.receiver && (
            <div className="bg-green-500/5 border border-green-500/20 rounded p-2 text-xs space-y-1">
              <div className="text-green-400 font-medium">✅ Connected</div>
              <div className="text-forge-muted">📍 {status.receiver.location}</div>
              <div className="text-forge-muted">📻 {status.receiver.bands}</div>
              <div className="text-forge-muted">🔗 {status.receiver.type.toUpperCase()}</div>
            </div>
          )}

          {!status?.connected ? (
            <button
              onClick={handleConnect}
              disabled={!selectedReceiver || loading}
              className="w-full py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              {loading ? '⏳ Connecting...' : '🔌 Connect'}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="w-full py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
            >
              ⏏ Disconnect
            </button>
          )}
        </div>

        {/* Tuning Controls */}
        <div className="lg:col-span-2 space-y-4">
          {/* Frequency Display + S-Meter */}
          <div className="bg-forge-surface rounded-lg border border-forge-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-forge-text">🎛️ Tuning</h3>
              {currentBand && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                  {currentBand.label}
                </span>
              )}
            </div>

            {/* S-Meter */}
            {status?.connected && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-forge-muted font-mono">Signal: {getSMeter(signalLevel)}</span>
                  <span className="text-forge-muted font-mono">Peak: {getSMeter(peakLevel)}</span>
                </div>
                <div className="h-3 bg-forge-bg rounded-full overflow-hidden relative">
                  {/* S-meter segments */}
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: 15 }).map((_, i) => (
                      <div key={i} className="flex-1 border-r border-forge-bg/50" />
                    ))}
                  </div>
                  <div
                    className="h-full rounded-full transition-all duration-100"
                    style={{
                      width: `${signalLevel * 100}%`,
                      background: signalLevel > 0.75
                        ? 'linear-gradient(90deg, #22c55e 0%, #eab308 60%, #ef4444 100%)'
                        : signalLevel > 0.5
                        ? 'linear-gradient(90deg, #22c55e 0%, #eab308 100%)'
                        : '#22c55e',
                    }}
                  />
                  {/* Peak indicator */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/60 transition-all duration-300"
                    style={{ left: `${peakLevel * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-forge-muted font-mono">
                  <span>S1</span><span>S3</span><span>S5</span><span>S7</span><span>S9</span><span>+20</span><span>+40</span>
                </div>
              </div>
            )}

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs text-forge-muted block mb-1">Frequency (kHz)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={freqInput}
                    onChange={e => setFreqInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleTune()}
                    className="flex-1 bg-forge-bg border border-forge-border rounded px-3 py-2 text-forge-text text-lg font-mono"
                    min={1}
                    max={30000}
                  />
                  <button
                    onClick={handleTune}
                    disabled={!status?.connected}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded text-sm transition-colors"
                  >
                    Tune
                  </button>
                </div>
              </div>
            </div>

            {/* Mode selector */}
            <div>
              <label className="text-xs text-forge-muted block mb-1">Mode</label>
              <div className="flex gap-1">
                {MODES.map(m => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); if (status?.connected) { setTimeout(() => handleTune(), 50); } }}
                    className={`px-3 py-1.5 rounded text-xs font-medium uppercase transition-colors ${
                      mode === m
                        ? 'bg-cyan-600 text-white'
                        : 'bg-forge-border/30 text-forge-muted hover:text-forge-text'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Volume */}
            <div>
              <label className="text-xs text-forge-muted block mb-1">
                🔊 Volume: {Math.round(volume * 100)}%
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>
          </div>

          {/* Presets - grouped by category */}
          <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
            <h3 className="text-sm font-semibold text-forge-text mb-2">⚡ Quick Tune</h3>
            <div className="flex flex-wrap gap-1">
              {PRESET_FREQUENCIES.map(p => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p.freq, p.mode)}
                  title={`${p.desc} — ${p.freq} kHz ${p.mode.toUpperCase()}`}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    frequency === p.freq && mode === p.mode
                      ? 'bg-cyan-600 text-white'
                      : 'bg-forge-border/30 hover:bg-cyan-600/30 text-forge-muted hover:text-cyan-300'
                  }`}
                >
                  {p.label} <span className="opacity-60">{p.freq}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Bandplan */}
          <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
            <h3 className="text-sm font-semibold text-forge-text mb-2">📊 HF Band Plan</h3>
            <div className="relative h-6 bg-forge-bg rounded overflow-hidden">
              {BANDPLAN.map(band => {
                const left = (band.start / 30000) * 100;
                const width = ((band.end - band.start) / 30000) * 100;
                return (
                  <div
                    key={band.label}
                    className="absolute top-0 bottom-0 cursor-pointer hover:opacity-100 opacity-80 transition-opacity"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.5)}%`,
                      backgroundColor: band.color.replace('0.15', '0.5'),
                    }}
                    title={`${band.label}: ${band.start}–${band.end} kHz`}
                    onClick={() => {
                      const mid = Math.round((band.start + band.end) / 2);
                      setFreqInput(String(mid));
                      setFrequency(mid);
                    }}
                  >
                    {width > 2 && (
                      <span className="text-[8px] text-white/80 px-0.5 truncate block leading-6">
                        {band.label}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Current frequency indicator */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                style={{ left: `${(frequency / 30000) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-forge-muted mt-1">
              <span>0</span><span>5 MHz</span><span>10 MHz</span><span>15 MHz</span><span>20 MHz</span><span>25 MHz</span><span>30 MHz</span>
            </div>
          </div>

          {/* Spectrum + Waterfall */}
          <div ref={containerRef} className="bg-forge-surface rounded-lg border border-forge-border p-4">
            <h3 className="text-sm font-semibold text-forge-text mb-2">📊 Audio Spectrum & Waterfall</h3>
            <canvas
              ref={spectrumCanvasRef}
              width={600}
              height={80}
              className="w-full rounded-t bg-black"
            />
            <canvas
              ref={canvasRef}
              width={600}
              height={120}
              className="w-full rounded-b bg-black"
              style={{ imageRendering: 'pixelated' }}
            />
            {!status?.connected && (
              <div className="text-center text-xs text-forge-muted mt-2">
                Connect to a receiver to see the audio spectrum
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebSDRView;
