import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ScannerState, ScanActivity, ScanListEntry } from '@signalforge/shared';

export const FrequencyScanner: React.FC = () => {
  const [state, setState] = useState<ScannerState>({ active: false, currentFrequency: 0, signalDetected: false, signalStrength: -120, scanDirection: 'up', scannedCount: 0, hitCount: 0 });
  const [activities, setActivities] = useState<ScanActivity[]>([]);
  const [scanList, setScanList] = useState<ScanListEntry[]>([]);
  const [startFreq, setStartFreq] = useState('87.5');
  const [endFreq, setEndFreq] = useState('108');
  const [squelch, setSquelch] = useState('-85');
  const [mode, setMode] = useState('fm');
  const [speed, setSpeed] = useState('normal');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [newFreq, setNewFreq] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'scanner_state') setState(msg.state);
        if (msg.type === 'scan_hit') setActivities(prev => [msg.activity, ...prev].slice(0, 200));
      } catch { /* ignore */ }
    };
    fetch('/api/scanner/activities?limit=50').then(r => r.json()).then(setActivities).catch(() => {});
    fetch('/api/scanner/list').then(r => r.json()).then(setScanList).catch(() => {});
    return () => ws.close();
  }, []);

  // Animated scanner display
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = 120;

    const draw = () => {
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // Frequency bar
      const startF = parseFloat(startFreq) * 1e6;
      const endF = parseFloat(endFreq) * 1e6;
      const range = endF - startF;
      if (range <= 0) return;

      // Grid lines
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.fillStyle = '#6a6a8a';
        ctx.font = '9px monospace';
        ctx.fillText(`${((startF + (range * i / 10)) / 1e6).toFixed(1)}`, x + 2, h - 2);
      }

      // Activity markers
      for (const act of activities.slice(0, 50)) {
        const x = ((act.frequency - startF) / range) * w;
        if (x < 0 || x > w) continue;
        const intensity = Math.max(0.2, Math.min(1, (act.signalStrength + 120) / 80));
        ctx.fillStyle = `rgba(255, 171, 0, ${intensity})`;
        ctx.fillRect(x - 1, 10, 3, h - 20);
      }

      // Current position
      if (state.active) {
        const cx = ((state.currentFrequency - startF) / range) * w;
        ctx.strokeStyle = state.signalDetected ? '#00e676' : '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

        // Signal strength bar
        const sh = Math.max(0, (state.signalStrength + 120) / 80) * (h - 20);
        ctx.fillStyle = state.signalDetected ? 'rgba(0, 230, 118, 0.5)' : 'rgba(0, 229, 255, 0.3)';
        ctx.fillRect(cx - 4, h - 10 - sh, 9, sh);
      }

      // Squelch line
      const sq = parseFloat(squelch);
      const sqY = h - 10 - Math.max(0, (sq + 120) / 80) * (h - 20);
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, sqY); ctx.lineTo(w, sqY); ctx.stroke();
      ctx.setLineDash([]);
    };

    const interval = setInterval(draw, 50);
    return () => clearInterval(interval);
  }, [state, activities, startFreq, endFreq, squelch]);

  const toggleScan = async () => {
    if (state.active) {
      await fetch('/api/scanner/stop', { method: 'POST' });
    } else {
      await fetch('/api/scanner/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        startFrequency: parseFloat(startFreq) * 1e6,
        endFrequency: parseFloat(endFreq) * 1e6,
        squelchThreshold: parseFloat(squelch),
        mode, scanSpeed: speed,
      }) });
    }
  };

  const addToList = async () => {
    if (!newFreq) return;
    const entry = await fetch('/api/scanner/list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName || `${newFreq} MHz`, frequency: parseFloat(newFreq) * 1e6, mode, priority: false }),
    }).then(r => r.json());
    setScanList(prev => [...prev, entry]);
    setNewFreq(''); setNewName('');
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-forge-border">
        <h2 className="text-sm font-display font-bold text-forge-cyan tracking-wider">📻 FREQUENCY SCANNER</h2>
        <div className="flex items-center gap-2 ml-auto">
          {state.active && (
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-forge-cyan">{(state.currentFrequency / 1e6).toFixed(3)} MHz</span>
              <span className="text-forge-text-dim">|</span>
              <span className={state.signalDetected ? 'text-forge-green' : 'text-forge-text-dim'}>{state.signalStrength.toFixed(0)} dBm</span>
              <span className="text-forge-text-dim">|</span>
              <span className="text-forge-amber">{state.hitCount} hits</span>
            </div>
          )}
          <button onClick={toggleScan} className={`px-3 py-1 rounded text-xs font-mono border transition-colors ${
            state.active ? 'bg-forge-red/20 border-forge-red/40 text-forge-red' : 'bg-forge-green/20 border-forge-green/40 text-forge-green'
          }`}>
            {state.active ? '⏹ STOP' : '▶ SCAN'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Controls + Scanner display */}
        <div className="flex-1 flex flex-col p-4 gap-4">
          {/* Scanner canvas */}
          <canvas ref={canvasRef} className="w-full rounded border border-forge-border" style={{ height: 120 }} />

          {/* Controls */}
          <div className="flex gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-mono text-forge-text-dim">START (MHz)</span>
              <input value={startFreq} onChange={e => setStartFreq(e.target.value)} className="w-24 px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-mono text-forge-text-dim">END (MHz)</span>
              <input value={endFreq} onChange={e => setEndFreq(e.target.value)} className="w-24 px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-mono text-forge-text-dim">SQUELCH (dBm)</span>
              <input value={squelch} onChange={e => setSquelch(e.target.value)} className="w-20 px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-mono text-forge-text-dim">MODE</span>
              <select value={mode} onChange={e => setMode(e.target.value)} className="px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text">
                <option value="fm">FM</option><option value="am">AM</option><option value="ssb">SSB</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-mono text-forge-text-dim">SPEED</span>
              <select value={speed} onChange={e => setSpeed(e.target.value)} className="px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text">
                <option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option>
              </select>
            </label>
          </div>

          {/* Activity log */}
          <div className="flex-1 overflow-y-auto">
            <h3 className="text-[10px] font-mono text-forge-text-dim tracking-wider mb-2">ACTIVITY LOG</h3>
            <div className="space-y-0.5">
              {activities.slice(0, 50).map(a => (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded bg-forge-bg/50 text-[10px] font-mono">
                  <span className="text-forge-amber">{(a.frequency / 1e6).toFixed(3)} MHz</span>
                  <span className="text-forge-text-dim">{a.mode.toUpperCase()}</span>
                  <span className={a.signalStrength > -70 ? 'text-forge-green' : 'text-forge-text'}>{a.signalStrength.toFixed(0)} dBm</span>
                  <span className="text-forge-text-dim ml-auto">{new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Scan list */}
        <div className="w-72 border-l border-forge-border p-3 flex flex-col gap-3">
          <h3 className="text-[10px] font-mono text-forge-cyan tracking-wider">📋 SCAN LIST</h3>

          {/* Add entry */}
          <div className="flex flex-col gap-1.5">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" className="px-2 py-1 bg-forge-bg border border-forge-border rounded text-[10px] font-mono text-forge-text" />
            <div className="flex gap-1">
              <input value={newFreq} onChange={e => setNewFreq(e.target.value)} placeholder="MHz" className="flex-1 px-2 py-1 bg-forge-bg border border-forge-border rounded text-[10px] font-mono text-forge-text" />
              <button onClick={addToList} className="px-2 py-1 bg-forge-cyan/20 border border-forge-cyan/30 rounded text-[10px] font-mono text-forge-cyan">+</button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-1">
            {scanList.map(entry => (
              <div key={entry.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono border ${
                entry.priority ? 'border-forge-amber/30 bg-forge-amber/5' : 'border-forge-border bg-forge-bg/50'
              }`}>
                <button onClick={async () => {
                  await fetch(`/api/scanner/list/${entry.id}`, { method: 'DELETE' });
                  setScanList(prev => prev.filter(e => e.id !== entry.id));
                }} className="text-forge-text-dim hover:text-forge-red">✕</button>
                <div className="flex-1">
                  <div className="text-forge-text">{entry.name}</div>
                  <div className="text-forge-text-dim">{(entry.frequency / 1e6).toFixed(3)} MHz</div>
                </div>
                <button onClick={() => {
                  fetch(`/api/scanner/list/${entry.id}/priority`, { method: 'POST' });
                  setScanList(prev => prev.map(e => e.id === entry.id ? { ...e, priority: !e.priority } : e));
                }} className={entry.priority ? 'text-forge-amber' : 'text-forge-text-dim'} title="Priority">
                  ★
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
