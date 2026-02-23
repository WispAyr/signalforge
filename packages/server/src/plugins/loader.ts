// ============================================================================
// SignalForge Plugin Loader
// ============================================================================
import { EventEmitter } from 'events';
import type { PluginManifest, PluginStatus, PluginNodeDefinition } from '@signalforge/shared';

// Built-in plugins
const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    id: 'pocsag-decoder',
    name: 'POCSAG Pager Decoder',
    version: '1.0.0',
    description: 'Decode POCSAG pager messages from raw audio. Supports 512, 1200, and 2400 baud rates.',
    author: 'SignalForge',
    icon: '📟',
    enabled: true,
    nodes: [{
      type: 'pocsag_decoder',
      name: 'POCSAG Decoder',
      category: 'decoder',
      icon: '📟',
      color: '#ff6b6b',
      description: 'Decode POCSAG pager messages',
      inputs: [{ id: 'audio-in-0', name: 'Audio In', type: 'audio' }],
      outputs: [{ id: 'packets-out-0', name: 'Messages', type: 'packets' }],
      params: [
        { id: 'baudRate', name: 'Baud Rate', type: 'select', default: 1200, options: [{ label: '512', value: 512 }, { label: '1200', value: 1200 }, { label: '2400', value: 2400 }] },
        { id: 'showNumeric', name: 'Show Numeric', type: 'boolean', default: true },
        { id: 'showAlpha', name: 'Show Alpha', type: 'boolean', default: true },
      ],
    }],
  },
  {
    id: 'morse-cw-decoder',
    name: 'Morse/CW Decoder',
    version: '1.0.0',
    description: 'Decode Morse code / CW transmissions with visual dot-dash display.',
    author: 'SignalForge',
    icon: '📡',
    enabled: true,
    nodes: [{
      type: 'morse_decoder',
      name: 'Morse/CW Decoder',
      category: 'decoder',
      icon: '·—',
      color: '#ffd43b',
      description: 'Decode Morse code with visual dot-dash display',
      inputs: [{ id: 'audio-in-0', name: 'Audio In', type: 'audio' }],
      outputs: [{ id: 'packets-out-0', name: 'Text', type: 'packets' }],
      params: [
        { id: 'wpm', name: 'WPM', type: 'number', default: 20, min: 5, max: 50, step: 1 },
        { id: 'toneFreq', name: 'Tone Freq (Hz)', type: 'number', default: 700, min: 300, max: 1200, step: 50 },
        { id: 'threshold', name: 'Threshold', type: 'number', default: 0.3, min: 0.05, max: 0.95, step: 0.05 },
      ],
    }],
  },
  {
    id: 'satellite-telemetry',
    name: 'Satellite Telemetry Decoder',
    version: '1.0.0',
    description: 'Parse CCSDS, CSP, and AX.25 telemetry frames from satellite downlinks.',
    author: 'SignalForge',
    icon: '🛰️',
    enabled: true,
    nodes: [{
      type: 'telemetry_decoder',
      name: 'Telemetry Decoder',
      category: 'decoder',
      icon: '🛰️',
      color: '#20c997',
      description: 'Parse satellite telemetry frames',
      inputs: [{ id: 'bits-in-0', name: 'Bits In', type: 'bits' }],
      outputs: [{ id: 'packets-out-0', name: 'Telemetry', type: 'packets' }],
      params: [
        { id: 'protocol', name: 'Protocol', type: 'select', default: 'ax25', options: [{ label: 'AX.25', value: 'ax25' }, { label: 'CCSDS', value: 'ccsds' }, { label: 'CSP', value: 'csp' }] },
        { id: 'syncWord', name: 'Sync Word', type: 'string', default: '1ACFFC1D' },
      ],
    }],
  },
  {
    id: 'rtl433-ism',
    name: 'rtl_433 IoT Sensor Decoder',
    version: '1.0.0',
    description: 'Decode 433MHz ISM band devices: weather stations, TPMS, doorbells, smoke detectors, soil moisture, pool thermometers.',
    author: 'SignalForge',
    icon: '📡',
    enabled: true,
    nodes: [{
      type: 'ism433_source',
      name: 'ISM 433 Source',
      category: 'source',
      icon: '📡',
      color: '#00e5ff',
      description: 'Receive and decode ISM 433 MHz devices via rtl_433',
      inputs: [],
      outputs: [{ id: 'packets-out-0', name: 'Devices', type: 'packets' }],
      params: [
        { id: 'host', name: 'Host', type: 'string', default: 'localhost' },
        { id: 'port', name: 'Port', type: 'number', default: 1433, min: 1, max: 65535, step: 1 },
        { id: 'source', name: 'Source', type: 'select', default: 'tcp', options: [{ label: 'TCP', value: 'tcp' }, { label: 'Pipe', value: 'pipe' }] },
      ],
    }],
  },
  {
    id: 'pager-enhanced',
    name: 'POCSAG/FLEX Pager Decoder',
    version: '2.0.0',
    description: 'Enhanced pager decoder with POCSAG and FLEX protocol support. Connects to multimon-ng.',
    author: 'SignalForge',
    icon: '📟',
    enabled: true,
    nodes: [{
      type: 'pager_decoder',
      name: 'POCSAG/FLEX Decoder',
      category: 'decoder',
      icon: '📟',
      color: '#ff6b6b',
      description: 'Decode POCSAG and FLEX pager messages',
      inputs: [{ id: 'audio-in-0', name: 'Audio In', type: 'audio' }],
      outputs: [{ id: 'packets-out-0', name: 'Messages', type: 'packets' }],
      params: [
        { id: 'pocsag', name: 'POCSAG', type: 'boolean', default: true },
        { id: 'flex', name: 'FLEX', type: 'boolean', default: true },
        { id: 'baudRate', name: 'Baud Rate', type: 'select', default: 1200, options: [{ label: '512', value: 512 }, { label: '1200', value: 1200 }, { label: '2400', value: 2400 }] },
      ],
    }],
  },
  {
    id: 'subghz-analyzer',
    name: 'Sub-GHz Analyzer',
    version: '1.0.0',
    description: 'HackRF One sub-GHz analysis: ISM band scanning, protocol identification, replay detection.',
    author: 'SignalForge',
    icon: '📶',
    enabled: true,
    nodes: [{
      type: 'hackrf_source',
      name: 'HackRF Source',
      category: 'source',
      icon: '📶',
      color: '#00e5ff',
      description: 'HackRF One sub-GHz scanner and analyzer',
      inputs: [],
      outputs: [{ id: 'iq-out-0', name: 'IQ Out', type: 'iq' }],
      params: [
        { id: 'startFreq', name: 'Start (MHz)', type: 'number', default: 300, min: 1, max: 6000, step: 1 },
        { id: 'endFreq', name: 'End (MHz)', type: 'number', default: 928, min: 1, max: 6000, step: 1 },
        { id: 'lnaGain', name: 'LNA Gain', type: 'number', default: 32, min: 0, max: 40, step: 8 },
        { id: 'vgaGain', name: 'VGA Gain', type: 'number', default: 20, min: 0, max: 62, step: 2 },
      ],
    }],
  },
  {
    id: 'sstv-decoder',
    name: 'SSTV Decoder',
    version: '1.0.0',
    description: 'Slow-Scan Television decoder: Martin, Scottie, Robot, PD modes. ISS + HF SSTV monitoring.',
    author: 'SignalForge',
    icon: '📺',
    enabled: true,
    nodes: [{
      type: 'sstv_decoder',
      name: 'SSTV Decoder',
      category: 'decoder',
      icon: '📺',
      color: '#e040fb',
      description: 'Decode SSTV images from audio',
      inputs: [{ id: 'audio-in-0', name: 'Audio In', type: 'audio' }],
      outputs: [{ id: 'packets-out-0', name: 'Images', type: 'packets' }],
      params: [
        { id: 'autoDetect', name: 'Auto-detect Mode', type: 'boolean', default: true },
        { id: 'mode', name: 'Mode', type: 'select', default: 'Martin1', options: [{ label: 'Martin 1', value: 'Martin1' }, { label: 'Scottie 1', value: 'Scottie1' }, { label: 'Robot 36', value: 'Robot36' }, { label: 'PD 120', value: 'PD120' }] },
      ],
    }],
  },
  {
    id: 'meter-reader',
    name: 'Utility Meter Reader',
    version: '1.0.0',
    description: 'AMR decoder for electric, gas, and water meters via rtl_433.',
    author: 'SignalForge',
    icon: '🔌',
    enabled: true,
    nodes: [{
      type: 'meter_reader',
      name: 'Meter Reader',
      category: 'decoder',
      icon: '🔌',
      color: '#ffd43b',
      description: 'Decode utility meter AMR signals',
      inputs: [],
      outputs: [{ id: 'packets-out-0', name: 'Readings', type: 'packets' }],
      params: [
        { id: 'source', name: 'Source', type: 'select', default: 'rtl_433', options: [{ label: 'rtl_433', value: 'rtl_433' }, { label: 'rtl_amr', value: 'rtl_amr' }] },
      ],
    }],
  },
  {
    id: 'wifi-scanner',
    name: 'WiFi Scanner',
    version: '1.0.0',
    description: 'Passive WiFi scanning via aircrack-ng. AP discovery, client tracking, deauth detection.',
    author: 'SignalForge',
    icon: '📶',
    enabled: true,
    nodes: [],
  },
  {
    id: 'bluetooth-scanner',
    name: 'Bluetooth Scanner',
    version: '1.0.0',
    description: 'BLE and Classic BT discovery. Tracker detection (AirTag, Tile, SmartTag). Ubertooth support.',
    author: 'SignalForge',
    icon: '🔵',
    enabled: true,
    nodes: [],
  },
  {
    id: 'tscm-sweep',
    name: 'TSCM Counter-Surveillance',
    version: '1.0.0',
    description: 'RF baseline recording, anomaly detection, known bug frequency matching, sweep reports.',
    author: 'SignalForge',
    icon: '🛡️',
    enabled: true,
    nodes: [],
  },
  {
    id: 'meshtastic-integration',
    name: 'Meshtastic Integration',
    version: '1.0.0',
    description: 'LoRa mesh network via Meshtastic. Node tracking, messaging, telemetry.',
    author: 'SignalForge',
    icon: '📡',
    enabled: true,
    nodes: [{
      type: 'meshtastic_source',
      name: 'Meshtastic Source',
      category: 'source',
      icon: '📡',
      color: '#00e5ff',
      description: 'Receive Meshtastic mesh network data',
      inputs: [],
      outputs: [{ id: 'packets-out-0', name: 'Messages', type: 'packets' }],
      params: [
        { id: 'connectionType', name: 'Connection', type: 'select', default: 'tcp', options: [{ label: 'TCP', value: 'tcp' }, { label: 'Serial', value: 'serial' }] },
        { id: 'host', name: 'Host', type: 'string', default: 'localhost' },
        { id: 'port', name: 'Port', type: 'number', default: 4403, min: 1, max: 65535, step: 1 },
      ],
    }],
  },
  {
    id: 'number-stations',
    name: 'Number Stations Database',
    version: '1.0.0',
    description: 'Database of known number/spy stations. Schedules, frequencies, "now on air" indicator.',
    author: 'SignalForge',
    icon: '🔢',
    enabled: true,
    nodes: [],
  },
  {
    id: 'field-mode',
    name: 'Offline / Field Mode',
    version: '1.0.0',
    description: 'Air-gapped deployment support. Cached data, service worker, deployment checklists.',
    author: 'SignalForge',
    icon: '🏕️',
    enabled: true,
    nodes: [],
  },
  {
    id: 'vdl2-decoder',
    name: 'VDL2 Decoder',
    version: '1.0.0',
    description: 'VHF Data Link Mode 2 decoder. ACARS-over-AVLC, richer aircraft data.',
    author: 'SignalForge',
    icon: '✈️',
    enabled: true,
    nodes: [{
      type: 'vdl2_decoder',
      name: 'VDL2 Decoder',
      category: 'decoder',
      icon: '✈️',
      color: '#aa00ff',
      description: 'Decode VDL2 aircraft datalink messages',
      inputs: [{ id: 'iq-in-0', name: 'IQ In', type: 'iq' }],
      outputs: [{ id: 'packets-out-0', name: 'Messages', type: 'packets' }],
      params: [
        { id: 'frequency', name: 'Frequency', type: 'select', default: 136975000, options: [{ label: '136.650 MHz', value: 136650000 }, { label: '136.975 MHz', value: 136975000 }] },
      ],
    }],
  },
  {
    id: 'signal-classifier',
    name: 'Signal Classifier',
    version: '1.0.0',
    description: 'Automatic signal classification using spectral analysis. AI/Hailo-8 ready.',
    author: 'SignalForge',
    icon: '🧠',
    enabled: true,
    nodes: [{
      type: 'signal_classifier',
      name: 'Signal Classifier',
      category: 'decoder',
      icon: '🧠',
      color: '#748ffc',
      description: 'Classify signal type (FM/AM/Digital/CW/etc.)',
      inputs: [{ id: 'fft-in-0', name: 'FFT In', type: 'fft' }],
      outputs: [{ id: 'packets-out-0', name: 'Classification', type: 'packets' }],
      params: [
        { id: 'minSNR', name: 'Min SNR (dB)', type: 'number', default: 10, min: 3, max: 40, step: 1 },
        { id: 'autoClassify', name: 'Auto Classify', type: 'boolean', default: true },
        { id: 'useHailo', name: 'Hailo-8 Inference', type: 'boolean', default: false },
      ],
    }],
  },
];

export class PluginLoader extends EventEmitter {
  private plugins = new Map<string, PluginManifest>();
  private loadedNodes = new Map<string, PluginNodeDefinition>();

  constructor() {
    super();
    // Load built-in plugins
    for (const p of BUILTIN_PLUGINS) {
      this.plugins.set(p.id, p);
      for (const node of p.nodes) {
        this.loadedNodes.set(node.type, node);
      }
    }
  }

  getPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values());
  }

  getPluginStatus(): PluginStatus[] {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id, name: p.name, version: p.version,
      enabled: p.enabled, loaded: true, nodeCount: p.nodes.length,
    }));
  }

  getPluginNodes(): PluginNodeDefinition[] {
    return Array.from(this.loadedNodes.values());
  }

  enablePlugin(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p) return false;
    p.enabled = true;
    this.emit('plugin_changed', p);
    return true;
  }

  disablePlugin(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p) return false;
    p.enabled = false;
    this.emit('plugin_changed', p);
    return true;
  }

  registerPlugin(manifest: PluginManifest): boolean {
    this.plugins.set(manifest.id, manifest);
    for (const node of manifest.nodes) {
      this.loadedNodes.set(node.type, node);
    }
    this.emit('plugin_loaded', manifest);
    return true;
  }
}
