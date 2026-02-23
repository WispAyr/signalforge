import React, { useState, useEffect } from 'react';
import type { ISMDevice, RTL433Status } from '@signalforge/shared';

const DEVICE_ICONS: Record<string, string> = {
  weather_station: '🌤️', tpms: '🛞', doorbell: '🔔', smoke_detector: '🔥',
  soil_moisture: '🌱', pool_thermometer: '🏊', power_meter: '⚡', unknown: '📡',
};

export const RTL433View: React.FC = () => {
  const [devices, setDevices] = useState<ISMDevice[]>([]);
  const [status, setStatus] = useState<RTL433Status | null>(null);

  const fetchData = async () => {
    try {
      const [dRes, sRes] = await Promise.all([fetch('/api/rtl433/devices'), fetch('/api/rtl433/status')]);
      setDevices(await dRes.json());
      setStatus(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'ism_device') setDevices(prev => {
          const idx = prev.findIndex(d => d.id === msg.device.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = msg.device; return next; }
          return [msg.device, ...prev];
        });
      } catch {}
    };
    return () => ws.close();
  }, []);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📡 ISM 433 MHz — IoT Sensors</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.connected ? 'text-green-400' : 'text-red-400'}>{status.connected ? '● CONNECTED' : '○ OFFLINE'}</span>
            <span>{status.devicesDiscovered} devices</span>
            <span>{status.messagesReceived} msgs</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {devices.map(dev => (
          <div key={dev.id} className="bg-forge-panel rounded-lg border border-forge-border p-4 hover:border-forge-cyan/30 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">{DEVICE_ICONS[dev.deviceType] || '📡'}</span>
              <div>
                <div className="text-sm font-bold text-forge-text">{dev.model}</div>
                <div className="text-[10px] font-mono text-forge-text-dim">ID: {dev.deviceId} {dev.channel != null && `CH: ${dev.channel}`}</div>
              </div>
              <span className="ml-auto px-2 py-0.5 text-[10px] font-mono rounded bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20">
                {dev.deviceType.replace('_', ' ').toUpperCase()}
              </span>
            </div>

            {dev.lastReading && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {dev.lastReading.temperature != null && (
                  <div className="bg-forge-bg/50 rounded p-2">
                    <div className="text-forge-text-dim">Temp</div>
                    <div className="text-lg font-bold text-forge-amber">{dev.lastReading.temperature.toFixed(1)}°C</div>
                  </div>
                )}
                {dev.lastReading.humidity != null && (
                  <div className="bg-forge-bg/50 rounded p-2">
                    <div className="text-forge-text-dim">Humidity</div>
                    <div className="text-lg font-bold text-blue-400">{dev.lastReading.humidity.toFixed(0)}%</div>
                  </div>
                )}
                {dev.lastReading.windSpeed != null && (
                  <div className="bg-forge-bg/50 rounded p-2">
                    <div className="text-forge-text-dim">Wind</div>
                    <div className="text-lg font-bold text-green-400">{dev.lastReading.windSpeed.toFixed(1)} km/h</div>
                  </div>
                )}
                {dev.lastReading.tirePressure != null && (
                  <div className="bg-forge-bg/50 rounded p-2">
                    <div className="text-forge-text-dim">Pressure</div>
                    <div className="text-lg font-bold text-forge-amber">{dev.lastReading.tirePressure.toFixed(0)} kPa</div>
                  </div>
                )}
                {dev.lastReading.moisture != null && (
                  <div className="bg-forge-bg/50 rounded p-2">
                    <div className="text-forge-text-dim">Moisture</div>
                    <div className="text-lg font-bold text-green-400">{dev.lastReading.moisture.toFixed(0)}%</div>
                  </div>
                )}
                {dev.lastReading.rainfall != null && dev.lastReading.rainfall > 0 && (
                  <div className="bg-forge-bg/50 rounded p-2">
                    <div className="text-forge-text-dim">Rain</div>
                    <div className="text-lg font-bold text-blue-400">{dev.lastReading.rainfall.toFixed(1)} mm</div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-2 flex justify-between text-[10px] font-mono text-forge-text-dim">
              <span>RSSI: {dev.rssi?.toFixed(0) || '?'} dBm</span>
              <span>{new Date(dev.lastSeen).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
        {devices.length === 0 && (
          <div className="col-span-full flex items-center justify-center h-40 text-forge-text-dim text-sm">
            No ISM devices detected. Connect rtl_433 to start receiving.
          </div>
        )}
      </div>
    </div>
  );
};
