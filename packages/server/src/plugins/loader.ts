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
