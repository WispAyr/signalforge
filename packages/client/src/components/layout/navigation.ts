// ============================================================================
// Navigation structure — sidebar sections and view mapping
// ============================================================================
import type { View } from '../../App';

export interface NavItem {
  id: View;
  label: string;
  icon: string;
  shortcut?: string;
}

export interface NavSection {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'operations', label: 'Operations', icon: '⬡',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: '⬡', shortcut: '1' },
      { id: 'timeline', label: 'Timeline', icon: '📜' },
      { id: 'analytics', label: 'Analytics', icon: '📊' },
      { id: 'telemetry', label: 'Telemetry', icon: '🛰️' },
      { id: 'rules', label: 'Rules Engine', icon: '⚡' },
      { id: 'dataflow', label: 'Data Flow', icon: '🔀' },
    ],
  },
  {
    id: 'radio', label: 'Radio', icon: '📻',
    items: [
      { id: 'flow', label: 'Flow Editor', icon: '◇', shortcut: '2' },
      { id: 'waterfall', label: 'Spectrum', icon: '≋', shortcut: '3' },
      { id: 'sdr', label: 'SDR Control', icon: '📡', shortcut: '5' },
      { id: 'scanner', label: 'Scanner', icon: '📻' },
      { id: 'analyzer', label: 'Analyzer', icon: '📊', shortcut: '6' },
      { id: 'audio', label: 'Audio', icon: '🔊' },
      { id: 'dsp', label: 'WebGPU DSP', icon: '⚡' },
      { id: 'propagation', label: 'Propagation', icon: '☀' },
      { id: 'dxcluster', label: 'DX Cluster', icon: '🌍' },
      { id: 'websdr', label: 'WebSDR', icon: '🌐' },
    ],
  },
  {
    id: 'tracking', label: 'Tracking', icon: '🌍',
    items: [
      { id: 'map', label: 'Map', icon: '◎', shortcut: '4' },
      { id: 'globe', label: 'Globe', icon: '🌍' },
      { id: 'satnogs', label: 'Satellites', icon: '🛰️' },
      { id: 'signals', label: 'Signal Guide', icon: '🔍', shortcut: '8' },
      { id: 'geofence', label: 'Geofence', icon: '🔲' },
    ],
  },
  {
    id: 'decoders', label: 'Decoders', icon: '🔓',
    items: [
      { id: 'voice', label: 'Voice', icon: '🎙️' },
      { id: 'rtl433', label: 'ISM/433', icon: '📡' },
      { id: 'pager', label: 'Pager', icon: '📟' },
      { id: 'subghz', label: 'Sub-GHz', icon: '📶' },
      { id: 'sstv', label: 'SSTV', icon: '📺' },
      { id: 'meters', label: 'Meters', icon: '🔌' },
      { id: 'vdl2', label: 'VDL2/ACARS', icon: '✈️' },
      { id: 'aprs', label: 'APRS', icon: '📍' },
      { id: 'meshtastic', label: 'Meshtastic', icon: '📡' },
    ],
  },
  {
    id: 'intelligence', label: 'Intelligence', icon: '🛡️',
    items: [
      { id: 'tscm', label: 'TSCM', icon: '🛡️' },
      { id: 'wifi', label: 'WiFi', icon: '📶' },
      { id: 'bluetooth', label: 'Bluetooth', icon: '🔵' },
      { id: 'numberstations', label: 'Number Stations', icon: '🔢' },
      { id: 'fieldmode', label: 'Field Mode', icon: '🏕️' },
    ],
  },
  {
    id: 'tools', label: 'Tools', icon: '🔧',
    items: [
      { id: 'logbook', label: 'Logbook', icon: '📓' },
      { id: 'scheduler', label: 'Scheduler', icon: '📅', shortcut: '7' },
      { id: 'equipment', label: 'Equipment', icon: '📡' },
      { id: 'history', label: 'History', icon: '⏳' },
      { id: 'narrator', label: 'AI Narrator', icon: '🧠' },
      { id: 'cinematic', label: 'Cinematic', icon: '🎬' },
    ],
  },
  {
    id: 'community', label: 'Community', icon: '🌐',
    items: [
      { id: 'community', label: 'Hub', icon: '🌐' },
      { id: 'academy', label: 'Training', icon: '🎓' },
      { id: 'plugins', label: 'Plugins', icon: '🔌' },
    ],
  },
  {
    id: 'system', label: 'System', icon: '⚙',
    items: [
      { id: 'settings', label: 'Settings', icon: '⚙', shortcut: '9' },
      { id: 'edge', label: 'Edge Nodes', icon: '🖥️' },
      { id: 'integrations', label: 'Integrations', icon: '🔗' },
    ],
  },
];

// Flat lookup
export const VIEW_MAP: Record<string, { section: NavSection; item: NavItem }> = {};
NAV_SECTIONS.forEach((section) =>
  section.items.forEach((item) => { VIEW_MAP[item.id] = { section, item }; })
);

// All views for command palette search
export const ALL_VIEWS: (NavItem & { section: string })[] = NAV_SECTIONS.flatMap((s) =>
  s.items.map((i) => ({ ...i, section: s.label }))
);
