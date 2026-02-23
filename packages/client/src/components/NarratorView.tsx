import React, { useState, useEffect } from 'react';
import type { Narration, NarratorConfig } from '@signalforge/shared';

export const NarratorView: React.FC = () => {
  const [narrations, setNarrations] = useState<Narration[]>([]);
  const [config, setConfig] = useState<NarratorConfig | null>(null);
  const [frequency, setFrequency] = useState('145.800');
  const [mode, setMode] = useState('FM');
  const [signalStrength, setSignalStrength] = useState('-65');
  const [isNarrating, setIsNarrating] = useState(false);

  useEffect(() => {
    fetch('/api/narrator/narrations').then(r => r.json()).then(setNarrations).catch(() => {});
    fetch('/api/narrator/config').then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  const narrate = async () => {
    setIsNarrating(true);
    try {
      const freqHz = parseFloat(frequency) * 1000000;
      const res = await fetch('/api/narrator/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frequencyHz: freqHz,
          mode,
          signalStrengthDbm: parseFloat(signalStrength),
        }),
      });
      const narration = await res.json();
      setNarrations(prev => [narration, ...prev]);
    } catch {}
    setIsNarrating(false);
  };

  const toggleAutoNarrate = async () => {
    if (!config) return;
    const updated = { ...config, autoNarrate: !config.autoNarrate };
    await fetch('/api/narrator/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    setConfig(updated);
  };

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">🧠 AI Signal Narrator</span>
        <div className="flex-1" />
        <button onClick={toggleAutoNarrate}
          className={`px-2 py-0.5 rounded text-xs font-mono ${config?.autoNarrate ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-forge-bg text-gray-500 border border-forge-border'}`}>
          Auto-Narrate {config?.autoNarrate ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {/* Input Panel */}
        <div className="w-72 flex flex-col gap-3 flex-shrink-0">
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-2">Tune & Narrate</div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500 font-mono">Frequency (MHz)</label>
                <input type="text" value={frequency} onChange={e => setFrequency(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-cyan-400 font-mono" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-mono">Mode</label>
                <select value={mode} onChange={e => setMode(e.target.value)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono">
                  {['FM', 'AM', 'USB', 'LSB', 'CW', 'DMR', 'D-STAR', 'C4FM', 'PULSE', 'OOK', 'FSK'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-mono">Signal Strength (dBm)</label>
                <input type="range" min={-120} max={-10} value={signalStrength} onChange={e => setSignalStrength(e.target.value)} className="w-full" />
                <div className="text-xs text-amber-400 font-mono text-center">{signalStrength} dBm</div>
              </div>
              <button onClick={narrate} disabled={isNarrating}
                className="w-full px-3 py-2 rounded text-sm font-mono font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50">
                {isNarrating ? '⏳ Narrating...' : '🧠 Narrate'}
              </button>
            </div>
          </div>

          {/* Quick Tune */}
          <div className="bg-forge-surface border border-forge-border rounded p-3">
            <div className="text-xs text-gray-400 font-mono mb-2">Quick Tune</div>
            <div className="space-y-1">
              {[
                { label: 'FM Broadcast', freq: '98.500', mode: 'FM' },
                { label: 'Airband', freq: '121.500', mode: 'AM' },
                { label: 'Marine Ch16', freq: '156.800', mode: 'FM' },
                { label: 'ISS APRS', freq: '145.800', mode: 'FM' },
                { label: 'ADS-B', freq: '1090.000', mode: 'PULSE' },
                { label: 'ISM 433', freq: '433.920', mode: 'OOK' },
                { label: '2m Calling', freq: '145.500', mode: 'FM' },
                { label: '70cm DMR', freq: '438.500', mode: 'DMR' },
                { label: 'NOAA Wx', freq: '162.400', mode: 'FM' },
              ].map(item => (
                <button key={item.label} onClick={() => { setFrequency(item.freq); setMode(item.mode); }}
                  className="w-full text-left px-2 py-1 rounded text-xs font-mono text-gray-300 hover:bg-forge-bg hover:text-cyan-400 transition-colors">
                  <span className="text-gray-500">{item.freq} MHz</span> — {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Narrations Feed */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {narrations.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
              <div className="text-center">
                <div className="text-4xl mb-3">🧠</div>
                <div>Tune to a frequency and click Narrate</div>
                <div className="text-xs mt-1">The AI will describe what's happening on that frequency</div>
              </div>
            </div>
          ) : narrations.map(nar => (
            <div key={nar.id} className={`bg-forge-surface border rounded p-3 ${nar.isAnomaly ? 'border-amber-500/50' : 'border-forge-border'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{nar.isAnomaly ? '⚠️' : '🧠'}</span>
                <span className="text-xs text-cyan-400 font-mono font-bold">
                  {nar.frequencyHz >= 1e9 ? `${(nar.frequencyHz / 1e9).toFixed(3)} GHz` : `${(nar.frequencyHz / 1e6).toFixed(3)} MHz`}
                </span>
                <div className="flex gap-1">
                  {nar.tags.map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex-1" />
                <span className="text-[10px] text-gray-500 font-mono">
                  {new Date(nar.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {Math.round(nar.confidence * 100)}% conf
                </span>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{nar.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
