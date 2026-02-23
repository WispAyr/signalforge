import React, { useState, useEffect, useCallback } from 'react';

interface SDRConnection {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  type: string;
  deviceInfo?: { tunerType: string; gainCount: number };
  config: {
    centerFrequency: number;
    sampleRate: number;
    gain: number;
    agc: boolean;
  };
}

interface RotatorState {
  connected: boolean;
  host?: string;
  port?: number;
  azimuth: number;
  elevation: number;
  targetAzimuth?: number;
  targetElevation?: number;
  moving: boolean;
}

interface DopplerState {
  tracking: boolean;
  correction?: {
    satelliteName: string;
    nominalFrequency: number;
    correctedFrequency: number;
    dopplerShift: number;
    rangeRate: number;
  };
}

const API = '';

export const SDRPanel: React.FC = () => {
  const [connections, setConnections] = useState<SDRConnection[]>([]);
  const [rotator, setRotator] = useState<RotatorState>({ connected: false, azimuth: 0, elevation: 0, moving: false });
  const [doppler, setDoppler] = useState<DopplerState>({ tracking: false });
  const [connectHost, setConnectHost] = useState('192.168.195.238');
  const [connectPort, setConnectPort] = useState('1234');
  const [rotatorHost, setRotatorHost] = useState('localhost');
  const [rotatorPort, setRotatorPort] = useState('4533');
  const [freq, setFreq] = useState('100.0');
  const [gain, setGain] = useState(40);
  const [agc, setAgc] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<'sdr' | 'rotator' | 'doppler' | 'mqtt'>('sdr');
  const [mqttBroker, setMqttBroker] = useState('localhost');
  const [mqttPort, setMqttPort] = useState('1883');
  const [mqttConnected, setMqttConnected] = useState(false);
  const [mqttMessages, setMqttMessages] = useState<any[]>([]);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/sdr/connections`);
      setConnections(await res.json());
    } catch { /* */ }
  }, []);

  const fetchRotator = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/rotator/state`);
      setRotator(await res.json());
    } catch { /* */ }
  }, []);

  const fetchDoppler = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/doppler/status`);
      setDoppler(await res.json());
    } catch { /* */ }
  }, []);

  const fetchMqtt = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/mqtt/status`);
      const data = await res.json();
      setMqttConnected(data.connected);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchConnections();
    fetchRotator();
    fetchDoppler();
    fetchMqtt();
    const iv = setInterval(() => {
      fetchConnections();
      fetchRotator();
      fetchDoppler();
    }, 3000);
    return () => clearInterval(iv);
  }, [fetchConnections, fetchRotator, fetchDoppler, fetchMqtt]);

  // Listen for WS updates
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'rotator_state') setRotator(msg.state);
        if (msg.type === 'doppler') setDoppler({ tracking: true, correction: msg.correction });
        if (msg.type === 'mqtt_message') setMqttMessages(prev => [msg.message, ...prev].slice(0, 50));
        if (msg.type === 'sdr_connected' || msg.type === 'sdr_disconnected') fetchConnections();
      } catch { /* binary */ }
    };
    return () => ws.close();
  }, [fetchConnections]);

  const connectSDR = async () => {
    setConnecting(true);
    try {
      await fetch(`${API}/api/sdr/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: connectHost, port: parseInt(connectPort) }),
      });
      fetchConnections();
    } catch { /* */ }
    setConnecting(false);
  };

  const disconnectSDR = async (id: string) => {
    await fetch(`${API}/api/sdr/disconnect/${id}`, { method: 'POST' });
    fetchConnections();
  };

  const setFrequency = async () => {
    await fetch(`${API}/api/sdr/frequency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frequency: parseFloat(freq) * 1e6 }),
    });
  };

  const setGainValue = async (g: number) => {
    setGain(g);
    await fetch(`${API}/api/sdr/gain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gain: g }),
    });
  };

  const toggleAGC = async () => {
    const newAgc = !agc;
    setAgc(newAgc);
    await fetch(`${API}/api/sdr/agc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newAgc }),
    });
  };

  const connectRotator = async () => {
    try {
      await fetch(`${API}/api/rotator/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: rotatorHost, port: parseInt(rotatorPort) }),
      });
      fetchRotator();
    } catch { /* */ }
  };

  const connectMqtt = async () => {
    try {
      await fetch(`${API}/api/mqtt/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker: mqttBroker, port: parseInt(mqttPort) }),
      });
      fetchMqtt();
    } catch { /* */ }
  };

  return (
    <div className="h-full flex flex-col bg-forge-bg overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-forge-border">
        {(['sdr', 'rotator', 'doppler', 'mqtt'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-mono tracking-wider transition-all ${
              tab === t ? 'text-forge-cyan border-b-2 border-forge-cyan bg-forge-cyan/5' : 'text-forge-text-dim hover:text-forge-text'
            }`}>
            {t === 'sdr' ? '📡 SDR' : t === 'rotator' ? '🎯 ROTATOR' : t === 'doppler' ? '🔄 DOPPLER' : '🔗 MQTT'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'sdr' && (
          <>
            {/* Connect to RTL-TCP */}
            <div className="panel-border rounded-lg p-4">
              <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">📡 CONNECT RTL-TCP</h3>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Host</label>
                  <input value={connectHost} onChange={e => setConnectHost(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                </div>
                <div className="w-20">
                  <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Port</label>
                  <input value={connectPort} onChange={e => setConnectPort(e.target.value)}
                    className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                </div>
                <button onClick={connectSDR} disabled={connecting}
                  className="px-4 py-1.5 bg-forge-cyan/20 text-forge-cyan border border-forge-cyan/30 rounded text-xs font-mono hover:bg-forge-cyan/30 disabled:opacity-50 transition-all">
                  {connecting ? '...' : 'CONNECT'}
                </button>
              </div>
            </div>

            {/* Active connections */}
            {connections.length > 0 && (
              <div className="panel-border rounded-lg p-4">
                <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">⚡ ACTIVE CONNECTIONS</h3>
                {connections.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b border-forge-border/50 last:border-0">
                    <div>
                      <div className="text-xs font-mono text-forge-text">{c.host}:{c.port}</div>
                      <div className="text-[10px] font-mono text-forge-text-dim">
                        {c.type} {c.deviceInfo ? `• ${c.deviceInfo.tunerType}` : ''} •{' '}
                        {(c.config.centerFrequency / 1e6).toFixed(3)} MHz • {(c.config.sampleRate / 1e6).toFixed(1)} Msps
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.connected ? 'bg-forge-green' : 'bg-forge-red'}`} />
                      <button onClick={() => disconnectSDR(c.id)}
                        className="text-[10px] font-mono text-forge-red hover:text-red-400 transition-colors">
                        DISCONNECT
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tuning controls */}
            <div className="panel-border rounded-lg p-4">
              <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">🎛️ TUNING</h3>
              <div className="space-y-3">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Frequency (MHz)</label>
                    <input value={freq} onChange={e => setFreq(e.target.value)} onBlur={setFrequency}
                      onKeyDown={e => e.key === 'Enter' && setFrequency()}
                      className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                  </div>
                  <button onClick={setFrequency}
                    className="px-3 py-1.5 bg-forge-panel border border-forge-border rounded text-xs font-mono text-forge-text hover:border-forge-cyan transition-all">
                    SET
                  </button>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-[10px] font-mono text-forge-text-dim">Gain: {gain} dB</label>
                    <button onClick={toggleAGC}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-all ${
                        agc ? 'text-forge-green border-forge-green/30 bg-forge-green/10' : 'text-forge-text-dim border-forge-border'
                      }`}>
                      AGC {agc ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <input type="range" min={0} max={50} value={gain} onChange={e => setGainValue(parseInt(e.target.value))}
                    disabled={agc}
                    className="w-full h-1 bg-forge-border rounded-lg appearance-none cursor-pointer accent-forge-cyan disabled:opacity-30" />
                </div>

                {/* Quick frequency buttons */}
                <div>
                  <label className="text-[10px] font-mono text-forge-text-dim block mb-1">Quick Tune</label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: 'FM 97.6', freq: '97.6' },
                      { label: 'Air 121.5', freq: '121.5' },
                      { label: 'NOAA 15', freq: '137.62' },
                      { label: 'NOAA 18', freq: '137.9125' },
                      { label: '2m APRS', freq: '144.8' },
                      { label: 'AIS', freq: '161.975' },
                      { label: 'PMR446', freq: '446.0' },
                      { label: 'ADS-B', freq: '1090.0' },
                    ].map(b => (
                      <button key={b.label} onClick={() => { setFreq(b.freq); }}
                        className="px-2 py-1 text-[9px] font-mono text-forge-text-dim border border-forge-border/50 rounded hover:border-forge-cyan hover:text-forge-cyan transition-all">
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'rotator' && (
          <>
            <div className="panel-border rounded-lg p-4">
              <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">🎯 ROTATOR CONTROL</h3>
              {!rotator.connected ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input value={rotatorHost} onChange={e => setRotatorHost(e.target.value)} placeholder="Host"
                      className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                    <input value={rotatorPort} onChange={e => setRotatorPort(e.target.value)} placeholder="Port"
                      className="w-20 bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                    <button onClick={connectRotator}
                      className="px-4 py-1.5 bg-forge-cyan/20 text-forge-cyan border border-forge-cyan/30 rounded text-xs font-mono hover:bg-forge-cyan/30 transition-all">
                      CONNECT
                    </button>
                  </div>
                  <p className="text-[10px] font-mono text-forge-text-dim">Connect to Hamlib rotctld (default port 4533)</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="w-2 h-2 rounded-full bg-forge-green" />
                    <span className="text-forge-green">Connected to {rotator.host}:{rotator.port}</span>
                    {rotator.moving && <span className="text-forge-amber animate-pulse">MOVING</span>}
                  </div>

                  {/* Position display */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-3xl font-mono text-forge-cyan">{rotator.azimuth.toFixed(1)}°</div>
                      <div className="text-[10px] font-mono text-forge-text-dim">AZIMUTH</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-mono text-forge-amber">{rotator.elevation.toFixed(1)}°</div>
                      <div className="text-[10px] font-mono text-forge-text-dim">ELEVATION</div>
                    </div>
                  </div>

                  {/* Manual control */}
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] font-mono text-forge-text-dim">Azimuth: {rotator.targetAzimuth?.toFixed(1) || rotator.azimuth.toFixed(1)}°</label>
                      <input type="range" min={0} max={360} step={0.5}
                        value={rotator.targetAzimuth ?? rotator.azimuth}
                        onChange={async (e) => {
                          const az = parseFloat(e.target.value);
                          await fetch(`${API}/api/rotator/position`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ azimuth: az, elevation: rotator.elevation }),
                          });
                        }}
                        className="w-full h-1 bg-forge-border rounded-lg appearance-none cursor-pointer accent-forge-cyan" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-forge-text-dim">Elevation: {rotator.targetElevation?.toFixed(1) || rotator.elevation.toFixed(1)}°</label>
                      <input type="range" min={0} max={90} step={0.5}
                        value={rotator.targetElevation ?? rotator.elevation}
                        onChange={async (e) => {
                          const el = parseFloat(e.target.value);
                          await fetch(`${API}/api/rotator/position`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ azimuth: rotator.azimuth, elevation: el }),
                          });
                        }}
                        className="w-full h-1 bg-forge-border rounded-lg appearance-none cursor-pointer accent-forge-amber" />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => fetch(`${API}/api/rotator/stop`, { method: 'POST' })}
                      className="flex-1 px-3 py-1.5 bg-forge-red/20 text-forge-red border border-forge-red/30 rounded text-xs font-mono hover:bg-forge-red/30 transition-all">
                      STOP
                    </button>
                    <button onClick={() => fetch(`${API}/api/rotator/park`, { method: 'POST' })}
                      className="flex-1 px-3 py-1.5 bg-forge-panel border border-forge-border rounded text-xs font-mono text-forge-text-dim hover:text-forge-text transition-all">
                      PARK (0°/0°)
                    </button>
                    <button onClick={() => fetch(`${API}/api/rotator/disconnect`, { method: 'POST' }).then(fetchRotator)}
                      className="px-3 py-1.5 border border-forge-border rounded text-xs font-mono text-forge-text-dim hover:text-forge-red transition-all">
                      DISCONNECT
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'doppler' && (
          <div className="panel-border rounded-lg p-4">
            <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">🔄 DOPPLER CORRECTION</h3>
            {doppler.tracking && doppler.correction ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-forge-green animate-pulse" />
                  <span className="text-forge-green">Tracking: {doppler.correction.satelliteName}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-mono text-forge-text-dim">Nominal Frequency</div>
                    <div className="text-sm font-mono text-forge-text">{(doppler.correction.nominalFrequency / 1e6).toFixed(6)} MHz</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-forge-text-dim">Corrected Frequency</div>
                    <div className="text-sm font-mono text-forge-cyan">{(doppler.correction.correctedFrequency / 1e6).toFixed(6)} MHz</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-forge-text-dim">Doppler Shift</div>
                    <div className={`text-sm font-mono ${doppler.correction.dopplerShift >= 0 ? 'text-forge-green' : 'text-forge-red'}`}>
                      {doppler.correction.dopplerShift >= 0 ? '+' : ''}{(doppler.correction.dopplerShift / 1000).toFixed(1)} kHz
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-forge-text-dim">Range Rate</div>
                    <div className="text-sm font-mono text-forge-text">{doppler.correction.rangeRate.toFixed(3)} km/s</div>
                  </div>
                </div>
                <button onClick={() => fetch(`${API}/api/doppler/stop`, { method: 'POST' }).then(fetchDoppler)}
                  className="w-full px-3 py-1.5 bg-forge-red/20 text-forge-red border border-forge-red/30 rounded text-xs font-mono hover:bg-forge-red/30 transition-all">
                  STOP TRACKING
                </button>
              </div>
            ) : (
              <p className="text-[10px] font-mono text-forge-text-dim">
                Doppler tracking is started from the satellite tracking view. Select a satellite and click "Track with Doppler" to begin automatic frequency correction.
              </p>
            )}
          </div>
        )}

        {tab === 'mqtt' && (
          <>
            <div className="panel-border rounded-lg p-4">
              <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">🔗 MQTT BROKER</h3>
              {!mqttConnected ? (
                <div className="flex gap-2">
                  <input value={mqttBroker} onChange={e => setMqttBroker(e.target.value)} placeholder="Broker"
                    className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                  <input value={mqttPort} onChange={e => setMqttPort(e.target.value)} placeholder="Port"
                    className="w-20 bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-xs font-mono text-forge-text focus:border-forge-cyan outline-none" />
                  <button onClick={connectMqtt}
                    className="px-4 py-1.5 bg-forge-cyan/20 text-forge-cyan border border-forge-cyan/30 rounded text-xs font-mono hover:bg-forge-cyan/30 transition-all">
                    CONNECT
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="w-2 h-2 rounded-full bg-forge-green" />
                      <span className="text-forge-green">Connected to {mqttBroker}:{mqttPort}</span>
                    </div>
                    <button onClick={() => fetch(`${API}/api/mqtt/disconnect`, { method: 'POST' }).then(fetchMqtt)}
                      className="text-[10px] font-mono text-forge-red hover:text-red-400 transition-colors">
                      DISCONNECT
                    </button>
                  </div>
                  <div className="text-[10px] font-mono text-forge-text-dim">
                    Auto-publishing: signalforge/adsb, signalforge/ais, signalforge/acars, signalforge/aprs
                  </div>
                </div>
              )}
            </div>

            {mqttMessages.length > 0 && (
              <div className="panel-border rounded-lg p-4">
                <h3 className="text-xs font-mono text-forge-cyan tracking-wider mb-3">📨 MQTT MESSAGES</h3>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {mqttMessages.map((m, i) => (
                    <div key={i} className="text-[10px] font-mono py-1 border-b border-forge-border/30">
                      <span className={m.direction === 'out' ? 'text-forge-cyan' : 'text-forge-amber'}>
                        {m.direction === 'out' ? '→' : '←'}
                      </span>{' '}
                      <span className="text-forge-text-dim">{m.topic}</span>{' '}
                      <span className="text-forge-text">{m.payload?.slice(0, 80)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
