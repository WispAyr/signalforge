import React, { useState } from 'react';
import type { NodeCategory } from '@signalforge/shared';

interface NodePaletteItem {
  type: string;
  name: string;
  category: NodeCategory;
  icon: string;
  color: string;
}

const NODE_PALETTE: NodePaletteItem[] = [
  // Sources
  { type: 'sdr_source', name: 'SDR Source', category: 'source', icon: '📡', color: '#00e5ff' },
  { type: 'sdr_source_2', name: 'SDR Source 2', category: 'source', icon: '📡', color: '#00e5ff' },
  { type: 'websdr_source', name: 'WebSDR', category: 'source', icon: '🌍', color: '#00e5ff' },
  { type: 'file_source', name: 'File Source', category: 'source', icon: '📁', color: '#00e5ff' },
  { type: 'noise_gen', name: 'Noise Gen', category: 'source', icon: '〰️', color: '#00e5ff' },
  { type: 'tone_gen', name: 'Tone Gen', category: 'source', icon: '🔊', color: '#00e5ff' },
  // Filters
  { type: 'lowpass', name: 'Low Pass', category: 'filter', icon: '▽', color: '#00e676' },
  { type: 'highpass', name: 'High Pass', category: 'filter', icon: '△', color: '#00e676' },
  { type: 'bandpass', name: 'Band Pass', category: 'filter', icon: '◇', color: '#00e676' },
  // Demodulators
  { type: 'fm_demod', name: 'FM Demod', category: 'demodulator', icon: 'FM', color: '#ffab00' },
  { type: 'am_demod', name: 'AM Demod', category: 'demodulator', icon: 'AM', color: '#ffab00' },
  { type: 'ssb_demod', name: 'SSB Demod', category: 'demodulator', icon: 'SSB', color: '#ffab00' },
  // Decoders
  { type: 'adsb_decoder', name: 'ADS-B', category: 'decoder', icon: '✈️', color: '#aa00ff' },
  { type: 'acars_decoder', name: 'ACARS', category: 'decoder', icon: '📡', color: '#aa00ff' },
  { type: 'ais_decoder', name: 'AIS', category: 'decoder', icon: '🚢', color: '#aa00ff' },
  { type: 'aprs_decoder', name: 'APRS', category: 'decoder', icon: '📍', color: '#aa00ff' },
  { type: 'apt_decoder', name: 'NOAA APT', category: 'decoder', icon: '🌦️', color: '#aa00ff' },
  { type: 'lrpt_decoder', name: 'METEOR LRPT', category: 'decoder', icon: '🛰️', color: '#aa00ff' },
  { type: 'lora_decoder', name: 'LoRa', category: 'decoder', icon: '📶', color: '#aa00ff' },
  // Analysis
  { type: 'fft', name: 'FFT', category: 'analysis', icon: '📊', color: '#ff1744' },
  { type: 'waterfall', name: 'Waterfall', category: 'analysis', icon: '≋', color: '#ff1744' },
  { type: 'spectrum', name: 'Spectrum', category: 'analysis', icon: '📈', color: '#ff1744' },
  // Output
  { type: 'audio_out', name: 'Audio Out', category: 'output', icon: '🔈', color: '#6a6a8a' },
  { type: 'recorder', name: 'Recorder', category: 'output', icon: '⏺️', color: '#6a6a8a' },
  { type: 'mqtt_sink', name: 'MQTT Sink', category: 'output', icon: '🔗', color: '#6a6a8a' },
  { type: 'mqtt_source', name: 'MQTT Source', category: 'source', icon: '🔗', color: '#00e5ff' },
  // Satellite
  { type: 'sat_tracker', name: 'Sat Tracker', category: 'satellite', icon: '🛰️', color: '#00b8d4' },
  { type: 'doppler', name: 'Doppler', category: 'satellite', icon: '🎯', color: '#00b8d4' },
  // Math
  { type: 'gain', name: 'Gain', category: 'math', icon: '⬆️', color: '#ffffff' },
  { type: 'mixer', name: 'Mixer', category: 'math', icon: '✕', color: '#ffffff' },
  { type: 'resample', name: 'Resample', category: 'math', icon: '↕️', color: '#ffffff' },
];

const CATEGORIES: { id: NodeCategory; label: string }[] = [
  { id: 'source', label: '⚡ SOURCES' },
  { id: 'filter', label: '🔧 FILTERS' },
  { id: 'demodulator', label: '📻 DEMOD' },
  { id: 'decoder', label: '🔓 DECODERS' },
  { id: 'analysis', label: '📊 ANALYSIS' },
  { id: 'output', label: '🔈 OUTPUT' },
  { id: 'satellite', label: '🛰️ SATELLITE' },
  { id: 'math', label: '🔢 MATH' },
];

export const Sidebar: React.FC = () => {
  const [expandedCategories, setExpandedCategories] = useState<Set<NodeCategory>>(
    new Set(['source', 'demodulator', 'decoder', 'analysis'])
  );

  const toggleCategory = (cat: NodeCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const onDragStart = (e: React.DragEvent, item: NodePaletteItem) => {
    e.dataTransfer.setData('application/signalforge-node', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="w-56 border-r border-forge-border bg-forge-surface/50 overflow-y-auto">
      <div className="p-3">
        <h2 className="text-[10px] font-mono tracking-[0.2em] text-forge-text-dim uppercase mb-3">
          Node Palette
        </h2>

        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="mb-2">
            <button
              onClick={() => toggleCategory(cat.id)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-mono tracking-wider text-forge-text-dim hover:text-forge-text transition-colors"
            >
              <span>{cat.label}</span>
              <span className="text-[8px]">
                {expandedCategories.has(cat.id) ? '▼' : '▶'}
              </span>
            </button>

            {expandedCategories.has(cat.id) && (
              <div className="space-y-0.5 ml-1">
                {NODE_PALETTE.filter((n) => n.category === cat.id).map((node) => (
                  <div
                    key={node.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, node)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab hover:bg-forge-panel/80 transition-colors group"
                  >
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
                      style={{ backgroundColor: node.color + '20', color: node.color }}
                    >
                      {node.icon}
                    </span>
                    <span className="text-xs text-forge-text-dim group-hover:text-forge-text transition-colors">
                      {node.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
};
