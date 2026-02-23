import React, { useState, useEffect } from 'react';
import type { MeterDevice, MeterStats } from '@signalforge/shared';

const METER_ICONS: Record<string, string> = { electric: '⚡', gas: '🔥', water: '💧' };
const METER_COLORS: Record<string, string> = { electric: 'text-yellow-400', gas: 'text-orange-400', water: 'text-blue-400' };

export const MeterView: React.FC = () => {
  const [meters, setMeters] = useState<MeterDevice[]>([]);
  const [stats, setStats] = useState<MeterStats | null>(null);

  const fetchData = async () => {
    try {
      const [mRes, sRes] = await Promise.all([fetch('/api/meters/devices'), fetch('/api/meters/stats')]);
      setMeters(await mRes.json());
      setStats(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 8000); return () => clearInterval(i); }, []);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">🔌 UTILITY METERS</h2>
        {stats && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span>{stats.totalMeters} meters</span>
            <span>{stats.readingsToday} readings today</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {meters.map(meter => (
          <div key={meter.id} className="bg-forge-panel rounded-lg border border-forge-border p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{METER_ICONS[meter.type]}</span>
              <div>
                <div className="text-sm font-bold text-forge-text">{meter.type.toUpperCase()} Meter</div>
                <div className="text-[10px] font-mono text-forge-text-dim">{meter.meterId}</div>
              </div>
            </div>
            {meter.lastReading && (
              <div className="bg-forge-bg/50 rounded p-3 mb-2">
                <div className={`text-2xl font-bold ${METER_COLORS[meter.type]}`}>
                  {meter.lastReading.consumption.toFixed(1)} <span className="text-sm">{meter.lastReading.unit}</span>
                </div>
                {meter.lastReading.rate != null && (
                  <div className="text-xs text-forge-text-dim mt-1">Rate: {meter.lastReading.rate.toFixed(2)} {meter.lastReading.unit}/min</div>
                )}
              </div>
            )}
            <div className="text-[10px] font-mono text-forge-text-dim flex justify-between">
              <span>{meter.readings.length} readings</span>
              <span>{new Date(meter.lastSeen).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
        {meters.length === 0 && <div className="col-span-full text-center py-10 text-forge-text-dim text-sm">No utility meters detected.</div>}
      </div>
    </div>
  );
};
