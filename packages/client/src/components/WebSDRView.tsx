import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = `http://${window.location.hostname}:3401`;

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

const PRESET_FREQUENCIES = [
  { label: 'BBC WS', freq: 5875, mode: 'am' },
  { label: 'WWV Time', freq: 10000, mode: 'am' },
  { label: 'CHU Canada', freq: 7850, mode: 'am' },
  { label: 'FT8 40m', freq: 7074, mode: 'usb' },
  { label: 'FT8 20m', freq: 14074, mode: 'usb' },
  { label: 'Maritime', freq: 2182, mode: 'usb' },
  { label: 'AM Broadcast', freq: 1000, mode: 'am' },
  { label: 'SW 49m', freq: 6000, mode: 'am' },
  { label: 'SW 31m', freq: 9500, mode: 'am' },
  { label: 'SW 25m', freq: 11700, mode: 'am' },
];

export const WebSDRView: React.FC = () => {
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [status, setStatus] = useState<SDRStatus | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<string>('');
  const [frequency, setFrequency] = useState(7074);
  const [mode, setMode] = useState<string>('am');
  const [volume, setVolume] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freqInput, setFreqInput] = useState('7074');

  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  // Fetch receivers
  useEffect(() => {
    fetch(`${API}/api/websdr/receivers`).then(r => r.json()).then(setReceivers).catch(() => {});
    fetch(`${API}/api/websdr/status`).then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  // WebSocket for audio
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3401/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const view = new Uint8Array(e.data);
        // Check for 'WSD' tag
        if (view[0] === 0x57 && view[1] === 0x53 && view[2] === 0x44) {
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
        } catch {}
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
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    gainNodeRef.current = gain;
    analyserRef.current = analyser;
  }, [volume]);

  // Play PCM audio
  const playAudio = useCallback((data: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;

    // PCM 16-bit LE to Float32
    const int16 = new Int16Array(data);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 12000); // KiwiSDR sends at 12kHz
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNodeRef.current!);
    source.start();
  }, []);

  // Volume
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume;
  }, [volume]);

  // Mini waterfall/spectrum visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);

      // Shift existing image down
      const imageData = ctx.getImageData(0, 0, width, height - 1);
      ctx.putImageData(imageData, 0, 1);

      // Draw new line at top
      for (let x = 0; x < width; x++) {
        const i = Math.floor((x / width) * bufLen);
        const v = data[i];
        // Color mapping: black -> blue -> cyan -> yellow -> white
        let r = 0, g = 0, b = 0;
        if (v < 64) { b = v * 4; }
        else if (v < 128) { b = 255; g = (v - 64) * 4; }
        else if (v < 192) { g = 255; b = 255 - (v - 128) * 4; r = (v - 128) * 4; }
        else { r = 255; g = 255; b = (v - 192) * 4; }
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, 0, 1, 1);
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
      else setStatus(data.status);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${API}/api/websdr/disconnect`, { method: 'POST' });
      setStatus(prev => prev ? { ...prev, connected: false, streaming: false } : prev);
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
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs text-forge-muted">
            {status?.connected ? 'Connected' : 'Disconnected'}
          </span>
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
          {/* Frequency & Mode */}
          <div className="bg-forge-surface rounded-lg border border-forge-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-forge-text">🎛️ Tuning</h3>
            
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
                    onClick={() => { setMode(m); if (status?.connected) handleTune(); }}
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
                Volume: {Math.round(volume * 100)}%
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

          {/* Presets */}
          <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
            <h3 className="text-sm font-semibold text-forge-text mb-2">⚡ Quick Tune</h3>
            <div className="flex flex-wrap gap-1">
              {PRESET_FREQUENCIES.map(p => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p.freq, p.mode)}
                  className="px-2 py-1 bg-forge-border/30 hover:bg-cyan-600/30 text-forge-muted hover:text-cyan-300 rounded text-xs transition-colors"
                >
                  {p.label} ({p.freq})
                </button>
              ))}
            </div>
          </div>

          {/* Mini Waterfall */}
          <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
            <h3 className="text-sm font-semibold text-forge-text mb-2">📊 Audio Spectrum</h3>
            <canvas
              ref={canvasRef}
              width={600}
              height={120}
              className="w-full rounded bg-black"
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
