import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { getFlowRunner } from '../flow/FlowRunner';
import type { FlowNode, FlowConnection, NodeCategory } from '@signalforge/shared';

// ============================================================================
// Types
// ============================================================================

interface EditorNode extends FlowNode {
  name: string;
  icon: string;
  color: string;
  category: NodeCategory;
  width: number;
  height: number;
}

interface DragState {
  type: 'node' | 'pan' | 'wire' | 'box-select' | null;
  nodeId?: string;
  offsetX?: number;
  offsetY?: number;
  startX?: number;
  startY?: number;
  wireFrom?: { nodeId: string; portId: string; portType: string; x: number; y: number };
  wireEnd?: { x: number; y: number };
  wireCompatible?: boolean;
  boxStart?: { x: number; y: number };
  boxEnd?: { x: number; y: number };
  multiOffsets?: Map<string, { dx: number; dy: number }>;
}

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

interface SavedFlow {
  id: string;
  name: string;
  nodes: EditorNode[];
  connections: FlowConnection[];
  savedAt: number;
}

interface HistoryEntry {
  nodes: EditorNode[];
  connections: FlowConnection[];
}

// ============================================================================
// Constants
// ============================================================================

const GRID_SNAP = 20;
const MAX_HISTORY = 50;
const AUTOSAVE_INTERVAL = 30000;
const API_BASE = '/api';

const PORT_COLORS: Record<string, string> = {
  iq: '#00e5ff', audio: '#00e676', fft: '#ffab00', bits: '#ff1744', packets: '#aa00ff', control: '#6a6a8a',
};

const NODE_PORTS: Record<string, { inputs: string[]; outputs: string[] }> = {
  sdr_source: { inputs: [], outputs: ['iq'] },
  file_source: { inputs: [], outputs: ['iq'] },
  noise_gen: { inputs: [], outputs: ['iq'] },
  tone_gen: { inputs: [], outputs: ['iq'] },
  lowpass: { inputs: ['iq'], outputs: ['iq'] },
  highpass: { inputs: ['iq'], outputs: ['iq'] },
  bandpass: { inputs: ['iq'], outputs: ['iq'] },
  fm_demod: { inputs: ['iq'], outputs: ['audio'] },
  am_demod: { inputs: ['iq'], outputs: ['audio'] },
  ssb_demod: { inputs: ['iq'], outputs: ['audio'] },
  adsb_decoder: { inputs: ['iq'], outputs: ['packets'] },
  acars_decoder: { inputs: ['audio'], outputs: ['packets'] },
  ais_decoder: { inputs: ['iq'], outputs: ['packets'] },
  aprs_decoder: { inputs: ['audio'], outputs: ['packets'] },
  apt_decoder: { inputs: ['audio'], outputs: ['packets'] },
  lora_decoder: { inputs: ['iq'], outputs: ['packets'] },
  fft: { inputs: ['iq'], outputs: ['fft'] },
  waterfall: { inputs: ['fft'], outputs: [] },
  spectrum: { inputs: ['fft'], outputs: [] },
  audio_out: { inputs: ['audio'], outputs: [] },
  recorder: { inputs: ['iq', 'audio'], outputs: [] },
  sat_tracker: { inputs: [], outputs: ['control'] },
  doppler: { inputs: ['iq', 'control'], outputs: ['iq'] },
  gain: { inputs: ['iq'], outputs: ['iq'] },
  mixer: { inputs: ['iq', 'iq'], outputs: ['iq'] },
  resample: { inputs: ['iq'], outputs: ['iq'] },
  websdr_source: { inputs: [], outputs: ['iq', 'audio'] },
  sdr_source_2: { inputs: [], outputs: ['iq'] },
  lrpt_decoder: { inputs: ['iq'], outputs: ['packets'] },
  aaronia_source: { inputs: [], outputs: ['iq', 'fft'] },
};

const NODE_PARAMS: Record<string, Array<{ id: string; label: string; type: 'number' | 'select' | 'text'; default: unknown; options?: string[] }>> = {
  sdr_source: [
    { id: 'freq', label: 'Frequency (Hz)', type: 'number', default: 100e6 },
    { id: 'rate', label: 'Sample Rate', type: 'select', default: '2400000', options: ['250000', '1000000', '2000000', '2400000'] },
    { id: 'gain', label: 'Gain (dB)', type: 'number', default: 30 },
  ],
  fm_demod: [{ id: 'bandwidth', label: 'Bandwidth (Hz)', type: 'number', default: 200000 }],
  am_demod: [{ id: 'bandwidth', label: 'Bandwidth (Hz)', type: 'number', default: 10000 }],
  bandpass: [
    { id: 'low', label: 'Low Cut (Hz)', type: 'number', default: -50000 },
    { id: 'high', label: 'High Cut (Hz)', type: 'number', default: 50000 },
  ],
  fft: [
    { id: 'size', label: 'FFT Size', type: 'select', default: '4096', options: ['1024', '2048', '4096', '8192', '16384'] },
  ],
  adsb_decoder: [{ id: 'host', label: 'dump1090 Host', type: 'text', default: '127.0.0.1' }],
  websdr_source: [
    { id: 'url', label: 'WebSDR URL', type: 'text', default: 'http://websdr.ewi.utwente.nl:8901' },
    { id: 'freq', label: 'Frequency (Hz)', type: 'number', default: 7074000 },
    { id: 'mode', label: 'Mode', type: 'select', default: 'usb', options: ['am', 'fm', 'lsb', 'usb', 'cw'] },
  ],
  recorder: [
    { id: 'format', label: 'Format', type: 'select', default: 'wav', options: ['wav', 'iq', 'raw'] },
    { id: 'prefix', label: 'Filename Prefix', type: 'text', default: 'recording' },
  ],
  aaronia_source: [
    { id: 'host', label: 'RTSA-Suite Host', type: 'text', default: '127.0.0.1' },
    { id: 'port', label: 'Port', type: 'number', default: 54664 },
    { id: 'startFreq', label: 'Start Freq (Hz)', type: 'number', default: 30e6 },
    { id: 'stopFreq', label: 'Stop Freq (Hz)', type: 'number', default: 6e9 },
    { id: 'rbw', label: 'RBW (Hz)', type: 'number', default: 10e3 },
    { id: 'span', label: 'Span (Hz)', type: 'number', default: 100e6 },
  ],
  audio_out: [
    { id: 'volume', label: 'Volume', type: 'number', default: 80 },
    { id: 'squelch', label: 'Squelch (dB)', type: 'number', default: -100 },
  ],
};

// Node metadata for creating from palette drags
const NODE_META: Record<string, { name: string; icon: string; color: string; category: NodeCategory }> = {
  sdr_source: { name: 'SDR Source', icon: '📡', color: '#00e5ff', category: 'source' },
  sdr_source_2: { name: 'SDR Source 2', icon: '📡', color: '#00e5ff', category: 'source' },
  file_source: { name: 'File Source', icon: '📁', color: '#00e5ff', category: 'source' },
  noise_gen: { name: 'Noise Gen', icon: '〰️', color: '#00e5ff', category: 'source' },
  tone_gen: { name: 'Tone Gen', icon: '🔊', color: '#00e5ff', category: 'source' },
  websdr_source: { name: 'WebSDR', icon: '🌍', color: '#00e5ff', category: 'source' },
  aaronia_source: { name: 'Aaronia', icon: '📡', color: '#00e5ff', category: 'source' },
  lowpass: { name: 'Low Pass', icon: '▽', color: '#00e676', category: 'filter' },
  highpass: { name: 'High Pass', icon: '△', color: '#00e676', category: 'filter' },
  bandpass: { name: 'Band Pass', icon: '◇', color: '#00e676', category: 'filter' },
  fm_demod: { name: 'FM Demod', icon: 'FM', color: '#ffab00', category: 'demodulator' },
  am_demod: { name: 'AM Demod', icon: 'AM', color: '#ffab00', category: 'demodulator' },
  ssb_demod: { name: 'SSB Demod', icon: 'SSB', color: '#ffab00', category: 'demodulator' },
  adsb_decoder: { name: 'ADS-B', icon: '✈️', color: '#aa00ff', category: 'decoder' },
  acars_decoder: { name: 'ACARS', icon: '📡', color: '#aa00ff', category: 'decoder' },
  ais_decoder: { name: 'AIS', icon: '🚢', color: '#aa00ff', category: 'decoder' },
  aprs_decoder: { name: 'APRS', icon: '📍', color: '#aa00ff', category: 'decoder' },
  apt_decoder: { name: 'NOAA APT', icon: '🌦️', color: '#aa00ff', category: 'decoder' },
  lrpt_decoder: { name: 'METEOR LRPT', icon: '🛰️', color: '#aa00ff', category: 'decoder' },
  lora_decoder: { name: 'LoRa', icon: '📶', color: '#aa00ff', category: 'decoder' },
  fft: { name: 'FFT', icon: '📊', color: '#ff1744', category: 'analysis' },
  waterfall: { name: 'Waterfall', icon: '≋', color: '#ff1744', category: 'analysis' },
  spectrum: { name: 'Spectrum', icon: '📈', color: '#ff1744', category: 'analysis' },
  audio_out: { name: 'Audio Out', icon: '🔈', color: '#6a6a8a', category: 'output' },
  recorder: { name: 'Recorder', icon: '⏺️', color: '#6a6a8a', category: 'output' },
  sat_tracker: { name: 'Sat Tracker', icon: '🛰️', color: '#00b8d4', category: 'satellite' },
  doppler: { name: 'Doppler', icon: '🎯', color: '#00b8d4', category: 'satellite' },
  downconverter: { name: 'Downconverter', icon: '⬇️', color: '#00e676', category: 'filter' },
  pocsag_decoder: { name: 'POCSAG/FLEX', icon: '📟', color: '#aa00ff', category: 'decoder' },
  gain: { name: 'Gain', icon: '⬆️', color: '#ffffff', category: 'math' },
  mixer: { name: 'Mixer', icon: '✕', color: '#ffffff', category: 'math' },
  resample: { name: 'Resample', icon: '↕️', color: '#ffffff', category: 'math' },
};

// ============================================================================
// Flow Templates
// ============================================================================

function makeNode(id: string, type: string, x: number, y: number, params: Record<string, unknown> = {}): EditorNode {
  const meta = NODE_META[type] || { name: type, icon: '?', color: '#888', category: 'source' as NodeCategory };
  return { id, type, position: { x, y }, params, name: meta.name, icon: meta.icon, color: meta.color, category: meta.category, width: 150, height: 70 };
}

const FLOW_TEMPLATES: Record<string, { name: string; icon: string; nodes: EditorNode[]; connections: FlowConnection[] }> = {
  'fm-receiver': {
    name: 'FM Receiver', icon: '📻',
    nodes: [
      makeNode('n1', 'sdr_source', 80, 200, { freq: 100e6, rate: 2.4e6 }),
      makeNode('n2', 'fft', 340, 120, { size: 4096 }),
      makeNode('n3', 'waterfall', 580, 80),
      makeNode('n4', 'bandpass', 340, 280, { low: -50000, high: 50000 }),
      makeNode('n5', 'fm_demod', 580, 250, { bandwidth: 200000 }),
      makeNode('n6', 'audio_out', 820, 250),
      makeNode('n7', 'spectrum', 580, 380),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n2', targetPort: 'iq-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'fft-out-0', targetNode: 'n3', targetPort: 'fft-in-0' },
      { id: 'c3', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n4', targetPort: 'iq-in-0' },
      { id: 'c4', sourceNode: 'n4', sourcePort: 'iq-out-0', targetNode: 'n5', targetPort: 'iq-in-0' },
      { id: 'c5', sourceNode: 'n5', sourcePort: 'audio-out-0', targetNode: 'n6', targetPort: 'audio-in-0' },
      { id: 'c6', sourceNode: 'n2', sourcePort: 'fft-out-0', targetNode: 'n7', targetPort: 'fft-in-0' },
    ],
  },
  'adsb-tracker': {
    name: 'ADS-B Tracker', icon: '✈️',
    nodes: [
      makeNode('n1', 'sdr_source', 80, 200, { freq: 1090e6, rate: 2e6 }),
      makeNode('n2', 'adsb_decoder', 380, 200),
      makeNode('n3', 'fft', 380, 80, { size: 4096 }),
      makeNode('n4', 'waterfall', 620, 80),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n2', targetPort: 'iq-in-0' },
      { id: 'c2', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n3', targetPort: 'iq-in-0' },
      { id: 'c3', sourceNode: 'n3', sourcePort: 'fft-out-0', targetNode: 'n4', targetPort: 'fft-in-0' },
    ],
  },
  'satellite-pass': {
    name: 'Satellite Pass', icon: '🛰️',
    nodes: [
      makeNode('n1', 'sdr_source', 80, 200, { freq: 137.5e6, rate: 1e6 }),
      makeNode('n2', 'sat_tracker', 80, 380),
      makeNode('n3', 'doppler', 340, 260),
      makeNode('n4', 'fft', 580, 140, { size: 4096 }),
      makeNode('n5', 'waterfall', 800, 100),
      makeNode('n6', 'spectrum', 800, 240),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n3', targetPort: 'iq-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'control-out-0', targetNode: 'n3', targetPort: 'control-in-0' },  // control-in-1 doesn't exist so use 0-based
      { id: 'c3', sourceNode: 'n3', sourcePort: 'iq-out-0', targetNode: 'n4', targetPort: 'iq-in-0' },
      { id: 'c4', sourceNode: 'n4', sourcePort: 'fft-out-0', targetNode: 'n5', targetPort: 'fft-in-0' },
      { id: 'c5', sourceNode: 'n4', sourcePort: 'fft-out-0', targetNode: 'n6', targetPort: 'fft-in-0' },
    ],
  },
  'aprs-monitor': {
    name: 'APRS Monitor', icon: '📍',
    nodes: [
      makeNode('n1', 'sdr_source', 80, 200, { freq: 144.8e6, rate: 250000 }),
      makeNode('n2', 'fm_demod', 340, 200, { bandwidth: 12500 }),
      makeNode('n3', 'aprs_decoder', 600, 200),
      makeNode('n4', 'fft', 340, 80, { size: 4096 }),
      makeNode('n5', 'waterfall', 600, 80),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n2', targetPort: 'iq-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'audio-out-0', targetNode: 'n3', targetPort: 'audio-in-0' },
      { id: 'c3', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n4', targetPort: 'iq-in-0' },
      { id: 'c4', sourceNode: 'n4', sourcePort: 'fft-out-0', targetNode: 'n5', targetPort: 'fft-in-0' },
    ],
  },
  'wideband-scanner': {
    name: 'Wideband Scanner', icon: '📊',
    nodes: [
      makeNode('n1', 'sdr_source', 80, 200, { freq: 100e6, rate: 2.4e6 }),
      makeNode('n2', 'fft', 340, 200, { size: 8192 }),
      makeNode('n3', 'spectrum', 600, 140),
      makeNode('n4', 'waterfall', 600, 280),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n2', targetPort: 'iq-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'fft-out-0', targetNode: 'n3', targetPort: 'fft-in-0' },
      { id: 'c3', sourceNode: 'n2', sourcePort: 'fft-out-0', targetNode: 'n4', targetPort: 'fft-in-0' },
    ],
  },
};

// ============================================================================
// Helpers
// ============================================================================

const snapToGrid = (v: number) => Math.round(v / GRID_SNAP) * GRID_SNAP;

let idCounter = Date.now();
const nextId = (prefix: string) => `${prefix}${++idCounter}`;

// ============================================================================
// Component
// ============================================================================

export const FlowEditor: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<EditorNode[]>(FLOW_TEMPLATES['fm-receiver'].nodes);
  const [connections, setConnections] = useState<FlowConnection[]>(FLOW_TEMPLATES['fm-receiver'].connections);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState>({ type: null });
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [showConfig, setShowConfig] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showLoadDropdown, setShowLoadDropdown] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [flowRunning, setFlowRunning] = useState(false);
  const [flowName, setFlowName] = useState('Untitled Flow');
  // Background flows
  const containerRef = useRef<HTMLDivElement>(null);

  // Undo/redo history
  const historyRef = useRef<HistoryEntry[]>([{ nodes: FLOW_TEMPLATES['fm-receiver'].nodes, connections: FLOW_TEMPLATES['fm-receiver'].connections }]);
  const historyIndexRef = useRef(0);

  const pushHistory = useCallback((newNodes: EditorNode[], newConns: FlowConnection[]) => {
    const hist = historyRef.current;
    // Truncate future
    hist.splice(historyIndexRef.current + 1);
    hist.push({ nodes: JSON.parse(JSON.stringify(newNodes)), connections: JSON.parse(JSON.stringify(newConns)) });
    if (hist.length > MAX_HISTORY) hist.shift();
    historyIndexRef.current = hist.length - 1;
  }, []);
  const [backgroundFlows, setBackgroundFlows] = useState<any[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [isBackgroundFlow, setIsBackgroundFlow] = useState(false);
  const [flowLocked, setFlowLocked] = useState(false);
  const [showBgDropdown, setShowBgDropdown] = useState(false);

  // Live data tracking for flow visualization
  const wirePulsesRef = useRef<Map<string, number>>(new Map()); // connectionId -> pulse timestamp
  const nodeDataRef = useRef<Map<string, { count: number; lastMsg: string; lastTime: number }>>(new Map());
  const [liveTickCounter, setLiveTickCounter] = useState(0); // force re-render on data

  useEffect(() => {
    fetch('/api/background-flows').then(r => r.json()).then(setBackgroundFlows).catch(() => {});
  }, []);

  // WebSocket for live flow data
  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'pager_message') {
          const pm = msg.message;
          const freqMHz = pm.frequency ? (pm.frequency / 1e6).toFixed(3) : '';
          const now = Date.now();

          // Find decoder nodes matching this frequency and pulse their input wires
          for (const node of nodes) {
            if (node.type === 'pocsag_decoder') {
              const nodeFreq = node.params?.freq ? (node.params.freq / 1e6).toFixed(3) : '';
              const nodeLabel = node.params?.label || '';
              const match = !freqMHz || nodeLabel.includes(freqMHz) || nodeFreq === freqMHz || nodes.length <= 3;
              if (match) {
                // Update node data
                const content = pm.content || (pm.messageType === 'tone' ? '🔔 TONE' : `#${pm.capcode}`);
                nodeDataRef.current.set(node.id, {
                  count: (nodeDataRef.current.get(node.id)?.count || 0) + 1,
                  lastMsg: content.slice(0, 40),
                  lastTime: now,
                });
                // Pulse all wires connected TO this node
                for (const conn of connections) {
                  if (conn.targetNode === node.id) wirePulsesRef.current.set(conn.id, now);
                  // Also pulse upstream wires (demod → decoder)
                  const srcNode = nodes.find(n => n.id === conn.sourceNode);
                  if (srcNode && conn.targetNode === node.id) {
                    for (const upConn of connections) {
                      if (upConn.targetNode === srcNode.id) wirePulsesRef.current.set(upConn.id, now);
                    }
                  }
                }
              }
            }
          }
          setLiveTickCounter(c => c + 1);
        }
      } catch {}
    };
    return () => ws.close();
  }, [nodes, connections]);

  const loadBackgroundFlow = useCallback((id: string) => {
    fetch(`/api/background-flows/${id}`).then(r => r.json()).then((flow: any) => {
      const mapped = (flow.nodes || []).map((n: any) => {
        const meta = (NODE_META as any)[n.type] || { name: n.type, icon: '?', color: '#888', category: 'source' };
        return { ...n, name: meta.name, icon: meta.icon, color: meta.color, category: meta.category, width: 160, height: 60 };
      });
      setNodes(mapped);
      // Map background flow edge format (from/to) to editor format (sourceNode/targetNode)
      const mappedEdges = (flow.edges || []).map((e: any) => ({
        id: e.id,
        sourceNode: e.sourceNode || e.from,
        sourcePort: e.sourcePort || e.fromPort,
        targetNode: e.targetNode || e.to,
        targetPort: e.targetPort || e.toPort,
      }));
      setConnections(mappedEdges);
      setFlowName(flow.name);
      setActiveFlowId(flow.id);
      setIsBackgroundFlow(true);
      setFlowLocked(flow.locked);
      setSelectedNodes(new Set());
      setShowConfig(false);
      setShowBgDropdown(false);
      pushHistory(mapped, mappedEdges);
    }).catch(() => {});
  }, [pushHistory]);

  const toggleFlowLock = useCallback(() => {
    if (!activeFlowId) return;
    const newLocked = !flowLocked;
    if (!newLocked && !confirm('⚠️ Unlocking a background flow allows editing. Changes affect live signal processing. Continue?')) return;
    fetch(`/api/background-flows/${activeFlowId}/lock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: newLocked }),
    }).then(() => setFlowLocked(newLocked)).catch(() => {});
  }, [activeFlowId, flowLocked]);

  const [hoveredPort, setHoveredPort] = useState<{ nodeId: string; portId: string; portType: string; x: number; y: number } | null>(null);
  const animFrame = useRef<number>(0);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    const entry = historyRef.current[historyIndexRef.current];
    setNodes(JSON.parse(JSON.stringify(entry.nodes)));
    setConnections(JSON.parse(JSON.stringify(entry.connections)));
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];
    setNodes(JSON.parse(JSON.stringify(entry.nodes)));
    setConnections(JSON.parse(JSON.stringify(entry.connections)));
  }, []);

  // Save/Load
  const [savedFlows, setSavedFlows] = useState<SavedFlow[]>(() => {
    try { return JSON.parse(localStorage.getItem('signalforge-flows') || '[]'); } catch { return []; }
  });

  const saveFlow = useCallback(() => {
    const flow: SavedFlow = { id: nextId('f'), name: flowName, nodes, connections, savedAt: Date.now() };
    const updated = [...savedFlows.filter(f => f.name !== flowName), flow];
    setSavedFlows(updated);
    localStorage.setItem('signalforge-flows', JSON.stringify(updated));
    // POST to server
    fetch(`${API_BASE}/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }).catch(() => {});
  }, [nodes, connections, flowName, savedFlows]);

  const loadFlow = useCallback((flow: SavedFlow) => {
    setNodes(flow.nodes);
    setConnections(flow.connections);
    setFlowName(flow.name);
    setSelectedNodes(new Set());
    setShowConfig(false);
    pushHistory(flow.nodes, flow.connections);
    setShowLoadDropdown(false);
  }, [pushHistory]);

  const newFlow = useCallback(() => {
    setNodes([]);
    setConnections([]);
    setFlowName('Untitled Flow');
    setSelectedNodes(new Set());
    setShowConfig(false);
    pushHistory([], []);
  }, [pushHistory]);

  const loadTemplate = useCallback((key: string) => {
    const tpl = FLOW_TEMPLATES[key];
    if (!tpl) return;
    const n = JSON.parse(JSON.stringify(tpl.nodes));
    const c = JSON.parse(JSON.stringify(tpl.connections));
    setNodes(n);
    setConnections(c);
    setFlowName(tpl.name);
    setSelectedNodes(new Set());
    pushHistory(n, c);
    setShowTemplateDropdown(false);
  }, [pushHistory]);

  // Auto-save
  useEffect(() => {
    const interval = setInterval(() => {
      localStorage.setItem('signalforge-autosave', JSON.stringify({ nodes, connections, name: flowName }));
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [nodes, connections, flowName]);

  // Load autosave on mount
  useEffect(() => {
    try {
      const auto = JSON.parse(localStorage.getItem('signalforge-autosave') || 'null');
      if (auto?.nodes?.length) {
        setNodes(auto.nodes);
        setConnections(auto.connections || []);
        setFlowName(auto.name || 'Untitled Flow');
        historyRef.current = [{ nodes: auto.nodes, connections: auto.connections || [] }];
        historyIndexRef.current = 0;
      }
    } catch { /* ignore */ }
  }, []);

  const getPortPos = useCallback((node: EditorNode, portId: string, isInput: boolean): { x: number; y: number } => {
    const ports = NODE_PORTS[node.type] || { inputs: [], outputs: [] };
    const list = isInput ? ports.inputs : ports.outputs;
    const idx = list.findIndex((_, i) => `${list[i]}-${isInput ? 'in' : 'out'}-${i}` === portId);
    const portIdx = idx >= 0 ? idx : 0;
    const total = list.length || 1;
    const spacing = node.height / (total + 1);
    return {
      x: node.position.x + (isInput ? 0 : node.width),
      y: node.position.y + spacing * (portIdx + 1),
    };
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => ({
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  }), [pan, zoom]);

  const findPort = useCallback((worldX: number, worldY: number, isInput?: boolean): { nodeId: string; portId: string; portType: string; x: number; y: number } | null => {
    for (const node of nodes) {
      const ports = NODE_PORTS[node.type] || { inputs: [], outputs: [] };
      if (isInput !== false) {
        for (let i = 0; i < ports.inputs.length; i++) {
          const portId = `${ports.inputs[i]}-in-${i}`;
          const pos = getPortPos(node, portId, true);
          if (Math.hypot(worldX - pos.x, worldY - pos.y) < 10) {
            return { nodeId: node.id, portId, portType: ports.inputs[i], x: pos.x, y: pos.y };
          }
        }
      }
      if (isInput !== true) {
        for (let i = 0; i < ports.outputs.length; i++) {
          const portId = `${ports.outputs[i]}-out-${i}`;
          const pos = getPortPos(node, portId, false);
          if (Math.hypot(worldX - pos.x, worldY - pos.y) < 10) {
            return { nodeId: node.id, portId, portType: ports.outputs[i], x: pos.x, y: pos.y };
          }
        }
      }
    }
    return null;
  }, [nodes, getPortPos]);

  // Selected node (first in set, for config panel)
  const selectedNode = useMemo(() => {
    if (selectedNodes.size !== 1) return null;
    const id = selectedNodes.values().next().value;
    return nodes.find(n => n.id === id) || null;
  }, [selectedNodes, nodes]);

  // ============================================================================
  // Canvas rendering
  // ============================================================================

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Grid
    const gridSize = 40;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.lineWidth = 0.5;
    const startX = -pan.x / zoom - gridSize;
    const startY = -pan.y / zoom - gridSize;
    const endX = (rect.width - pan.x) / zoom + gridSize;
    const endY = (rect.height - pan.y) / zoom + gridSize;

    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, endY); ctx.stroke();
    }
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
    }

    const time = Date.now() / 1000;

    // Connections — animated dashed flow
    for (const conn of connections) {
      const srcNode = nodes.find((n) => n.id === conn.sourceNode);
      const tgtNode = nodes.find((n) => n.id === conn.targetNode);
      if (!srcNode || !tgtNode) continue;

      const src = getPortPos(srcNode, conn.sourcePort, false);
      const tgt = getPortPos(tgtNode, conn.targetPort, true);
      // Tighter bezier — clamp control point offset to avoid wild curves
      const dist = Math.abs(tgt.x - src.x);
      const dx = Math.min(dist * 0.4, 80);

      const portType = conn.sourcePort.split('-')[0];
      const color = PORT_COLORS[portType] || '#00e5ff';

      // Solid base wire
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo(src.x + dx, src.y, tgt.x - dx, tgt.y, tgt.x, tgt.y);
      ctx.strokeStyle = color + '40';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Check for pulse on this wire
      const pulseTime = wirePulsesRef.current.get(conn.id);
      const pulseAge = pulseTime ? (Date.now() - pulseTime) / 1000 : 999;
      const isPulsing = pulseAge < 1.5; // 1.5s pulse duration

      // Animated flow dashes
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo(src.x + dx, src.y, tgt.x - dx, tgt.y, tgt.x, tgt.y);
      ctx.strokeStyle = isPulsing ? color : color + 'cc';
      ctx.lineWidth = isPulsing ? 2.5 : 1;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -time * 30;
      if (isPulsing) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
      ctx.stroke();
      ctx.setLineDash([]);
      if (isPulsing) ctx.shadowBlur = 0;

      // Pulse traveling dot
      if (isPulsing) {
        const t = Math.min(pulseAge / 0.8, 1); // dot travels in 0.8s
        const alpha = 1 - pulseAge / 1.5;
        // Approximate bezier position at t
        const mt = 1 - t;
        const px = mt*mt*mt*src.x + 3*mt*mt*t*(src.x+dx) + 3*mt*t*t*(tgt.x-dx) + t*t*t*tgt.x;
        const py = mt*mt*mt*src.y + 3*mt*mt*t*src.y + 3*mt*t*t*tgt.y + t*t*t*tgt.y;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
    }

    // Wire being drawn
    if (drag.type === 'wire' && drag.wireFrom && drag.wireEnd) {
      const from = drag.wireFrom;
      const to = drag.wireEnd;
      const worldTo = { x: (to.x - pan.x) / zoom, y: (to.y - pan.y) / zoom };
      const dx = Math.min(Math.abs(worldTo.x - from.x) * 0.4, 80);

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x + dx, from.y, worldTo.x - dx, worldTo.y, worldTo.x, worldTo.y);
      ctx.strokeStyle = drag.wireCompatible === false ? '#ff1744' : (PORT_COLORS[from.portType] || '#00e5ff');
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Nodes
    for (const node of nodes) {
      const isSelected = selectedNodes.has(node.id);

      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = isSelected ? 'rgba(0, 229, 255, 0.08)' : 'rgba(18, 18, 26, 0.95)';
      ctx.strokeStyle = isSelected ? node.color : node.color + '40';
      ctx.lineWidth = isSelected ? 2 : 1;

      const r = 10;
      ctx.beginPath();
      ctx.roundRect(node.position.x, node.position.y, node.width, node.height, r);
      ctx.fill();
      if (isSelected) { ctx.shadowColor = node.color; ctx.shadowBlur = 15; }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Header bar
      ctx.fillStyle = node.color + '20';
      ctx.beginPath();
      ctx.roundRect(node.position.x, node.position.y, node.width, 26, [r, r, 0, 0]);
      ctx.fill();

      // Category accent (left edge, subtle)
      ctx.fillStyle = node.color;
      ctx.fillRect(node.position.x, node.position.y + 6, 2, node.height - 12);

      // Title
      ctx.fillStyle = '#e0e0e8';
      ctx.font = '11px "JetBrains Mono"';
      ctx.fillText(`${node.icon} ${node.name}`, node.position.x + 10, node.position.y + 17);

      // Ports
      const ports = NODE_PORTS[node.type] || { inputs: [], outputs: [] };

      ports.inputs.forEach((portType, i) => {
        const portId = `${portType}-in-${i}`;
        const pos = getPortPos(node, portId, true);
        const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.portId === portId;
        const color = PORT_COLORS[portType] || '#666';
        // Port dot
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, isHovered ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0a0a0f'; ctx.lineWidth = 1.5; ctx.stroke();
        // Label inside node
        ctx.fillStyle = isHovered ? color : color + '50';
        ctx.font = '7px "JetBrains Mono"';
        ctx.fillText(portType.toUpperCase(), pos.x + 10, pos.y + 3);
      });

      ports.outputs.forEach((portType, i) => {
        const portId = `${portType}-out-${i}`;
        const pos = getPortPos(node, portId, false);
        const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.portId === portId;
        const color = PORT_COLORS[portType] || '#666';
        // Port dot
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, isHovered ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0a0a0f'; ctx.lineWidth = 1.5; ctx.stroke();
        // Label inside node
        ctx.fillStyle = isHovered ? color : color + '50';
        ctx.font = '7px "JetBrains Mono"';
        ctx.textAlign = 'right';
        ctx.fillText(portType.toUpperCase(), pos.x - 10, pos.y + 3);
        ctx.textAlign = 'left';
      });

      // Live data badge for decoder nodes
      const nodeData = nodeDataRef.current.get(node.id);
      if (nodeData && (node.type === 'pocsag_decoder' || node.type.includes('decoder'))) {
        const age = (Date.now() - nodeData.lastTime) / 1000;
        const fresh = age < 3;

        // Message count badge (top-right corner)
        const badgeX = node.position.x + node.width - 8;
        const badgeY = node.position.y + 8;
        const badgeText = String(nodeData.count);
        const badgeW = Math.max(ctx.measureText(badgeText).width + 10, 20);
        ctx.font = 'bold 9px "JetBrains Mono"';
        ctx.fillStyle = fresh ? '#00e676' : '#00e67680';
        ctx.beginPath();
        ctx.roundRect(badgeX - badgeW, badgeY - 7, badgeW, 14, 7);
        ctx.fill();
        ctx.fillStyle = '#0a0a0f';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText, badgeX - badgeW / 2, badgeY + 3);
        ctx.textAlign = 'left';

        // Last message preview (bottom of node)
        if (nodeData.lastMsg) {
          ctx.font = '7px "JetBrains Mono"';
          ctx.fillStyle = fresh ? '#e0e0e8' : '#e0e0e860';
          const previewY = node.position.y + node.height - 6;
          const maxW = node.width - 16;
          let preview = nodeData.lastMsg;
          while (ctx.measureText(preview).width > maxW && preview.length > 3) preview = preview.slice(0, -1);
          if (preview !== nodeData.lastMsg) preview += '…';
          ctx.fillText(preview, node.position.x + 8, previewY);
        }

        // Pulse glow on fresh data
        if (fresh) {
          const glowAlpha = Math.max(0, 0.3 * (1 - age / 3));
          ctx.strokeStyle = `rgba(0, 230, 118, ${glowAlpha})`;
          ctx.lineWidth = 2;
          ctx.shadowColor = '#00e676';
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.roundRect(node.position.x, node.position.y, node.width, node.height, 10);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    }

    // Box selection
    if (drag.type === 'box-select' && drag.boxStart && drag.boxEnd) {
      const bs = drag.boxStart;
      const be = drag.boxEnd;
      ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.rect(Math.min(bs.x, be.x), Math.min(bs.y, be.y), Math.abs(be.x - bs.x), Math.abs(be.y - bs.y));
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // ── Minimap ──
    if (nodes.length > 0) {
      const mmW = 160, mmH = 100, mmPad = 12;
      const mmX = rect.width - mmW - mmPad;
      const mmY = rect.height - mmH - mmPad;

      // Bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + n.width);
        maxY = Math.max(maxY, n.position.y + n.height);
      }
      const pad = 40;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const scale = Math.min(mmW / rangeX, mmH / rangeY);

      ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(mmX, mmY, mmW, mmH, 6);
      ctx.fill();
      ctx.stroke();

      // Nodes
      for (const n of nodes) {
        const nx = mmX + (n.position.x - minX) * scale;
        const ny = mmY + (n.position.y - minY) * scale;
        const nw = Math.max(n.width * scale, 3);
        const nh = Math.max(n.height * scale, 2);
        ctx.fillStyle = selectedNodes.has(n.id) ? n.color : n.color + '80';
        ctx.fillRect(nx, ny, nw, nh);
      }

      // Viewport rect
      const vpLeft = (-pan.x / zoom - minX) * scale + mmX;
      const vpTop = (-pan.y / zoom - minY) * scale + mmY;
      const vpW = (rect.width / zoom) * scale;
      const vpH = (rect.height / zoom) * scale;
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vpLeft, vpTop, vpW, vpH);
    }

    animFrame.current = requestAnimationFrame(render);
  }, [nodes, connections, pan, zoom, selectedNodes, getPortPos, drag, hoveredPort, liveTickCounter]);

  useEffect(() => {
    animFrame.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrame.current);
  }, [render]);

  // ============================================================================
  // Mouse handlers
  // ============================================================================

  const editBlocked = flowLocked && isBackgroundFlow;
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) return; // right-click handled by context menu
    setContextMenu(null);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // Check ports first (for wire drawing)
    const port = findPort(world.x, world.y, false);
    if (port) {
      setDrag({
        type: 'wire',
        wireFrom: port,
        wireEnd: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        wireCompatible: undefined,
      });
      return;
    }

    // Check nodes
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (world.x >= n.position.x && world.x <= n.position.x + n.width &&
          world.y >= n.position.y && world.y <= n.position.y + n.height) {

        if (e.shiftKey) {
          // Toggle selection
          setSelectedNodes(prev => {
            const next = new Set(prev);
            if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
            return next;
          });
        } else if (!selectedNodes.has(n.id)) {
          setSelectedNodes(new Set([n.id]));
        }
        setShowConfig(true);

        // Calculate offsets for all selected nodes
        const selected = selectedNodes.has(n.id) ? selectedNodes : new Set([n.id]);
        const multiOffsets = new Map<string, { dx: number; dy: number }>();
        for (const sid of selected) {
          const sn = nodes.find(nn => nn.id === sid);
          if (sn) multiOffsets.set(sid, { dx: world.x - sn.position.x, dy: world.y - sn.position.y });
        }

        setDrag({ type: 'node', nodeId: n.id, offsetX: world.x - n.position.x, offsetY: world.y - n.position.y, multiOffsets });
        return;
      }
    }

    // Box select (shift + empty area) or pan
    if (e.shiftKey) {
      setDrag({ type: 'box-select', boxStart: world, boxEnd: world });
    } else {
      setSelectedNodes(new Set());
      setShowConfig(false);
      setDrag({ type: 'pan', startX: e.clientX - pan.x, startY: e.clientY - pan.y });
    }
  }, [nodes, pan, screenToWorld, findPort, selectedNodes]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // Port hover detection
    const port = findPort(world.x, world.y);
    setHoveredPort(port);

    if (drag.type === 'node' && drag.nodeId) {
      const selected = drag.multiOffsets || new Map([[drag.nodeId, { dx: drag.offsetX || 0, dy: drag.offsetY || 0 }]]);
      setNodes((prev) => prev.map((n) => {
        const off = selected.get(n.id);
        if (!off) return n;
        return { ...n, position: { x: snapToGrid(world.x - off.dx), y: snapToGrid(world.y - off.dy) } };
      }));
    } else if (drag.type === 'pan') {
      setPan({ x: e.clientX - (drag.startX || 0), y: e.clientY - (drag.startY || 0) });
    } else if (drag.type === 'wire') {
      // Check compatibility with hovered port
      const targetPort = findPort(world.x, world.y, true);
      let compatible: boolean | undefined = undefined;
      if (targetPort && drag.wireFrom) {
        compatible = targetPort.portType === drag.wireFrom.portType && targetPort.nodeId !== drag.wireFrom.nodeId;
      }
      setDrag(prev => ({ ...prev, wireEnd: { x: e.clientX - rect.left, y: e.clientY - rect.top }, wireCompatible: compatible }));
    } else if (drag.type === 'box-select') {
      setDrag(prev => ({ ...prev, boxEnd: world }));
    }
  }, [drag, screenToWorld, findPort]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (drag.type === 'wire' && drag.wireFrom) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const targetPort = findPort(world.x, world.y, true);

        if (targetPort && targetPort.nodeId !== drag.wireFrom.nodeId) {
          if (targetPort.portType === drag.wireFrom.portType) {
            const newConn: FlowConnection = {
              id: nextId('c'),
              sourceNode: drag.wireFrom.nodeId,
              sourcePort: drag.wireFrom.portId,
              targetNode: targetPort.nodeId,
              targetPort: targetPort.portId,
            };
            setConnections(prev => {
              const next = [...prev, newConn];
              pushHistory(nodes, next);
              return next;
            });
          }
        }
      }
    } else if (drag.type === 'node') {
      pushHistory(nodes, connections);
    } else if (drag.type === 'box-select' && drag.boxStart && drag.boxEnd) {
      const minX = Math.min(drag.boxStart.x, drag.boxEnd.x);
      const minY = Math.min(drag.boxStart.y, drag.boxEnd.y);
      const maxX = Math.max(drag.boxStart.x, drag.boxEnd.x);
      const maxY = Math.max(drag.boxStart.y, drag.boxEnd.y);
      const selected = new Set<string>();
      for (const n of nodes) {
        if (n.position.x + n.width > minX && n.position.x < maxX &&
            n.position.y + n.height > minY && n.position.y < maxY) {
          selected.add(n.id);
        }
      }
      setSelectedNodes(selected);
    }
    setDrag({ type: null });
  }, [drag, nodes, connections, screenToWorld, findPort, pushHistory]);

  const zoomTo = useCallback((newZ: number, cx?: number, cy?: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = cx ?? rect.width / 2;
    const my = cy ?? rect.height / 2;
    const clamped = Math.max(0.1, Math.min(5, newZ));
    setZoom(z => {
      setPan(p => ({
        x: mx - (mx - p.x) * (clamped / z),
        y: my - (my - p.y) * (clamped / z),
      }));
      return clamped;
    });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Smoother zoom: smaller steps, toward cursor
    const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
    setZoom(z => {
      const newZ = Math.max(0.1, Math.min(5, z * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setPan(p => ({
        x: mx - (mx - p.x) * (newZ / z),
        y: my - (my - p.y) * (newZ / z),
      }));
      return newZ;
    });
  }, []);

  const fitToView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) return;
    const pad = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + (n.width || 140));
      maxY = Math.max(maxY, n.position.y + (n.height || 60));
    });
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const newZoom = Math.max(0.1, Math.min(2, Math.min((rect.width - pad * 2) / rangeX, (rect.height - pad * 2) / rangeY)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setZoom(newZoom);
    setPan({ x: rect.width / 2 - cx * newZoom, y: rect.height / 2 - cy * newZoom });
  }, [nodes]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/signalforge-node');
    if (!data) return;

    const item = JSON.parse(data);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const newNode: EditorNode = {
      id: nextId('n'),
      type: item.type,
      position: { x: snapToGrid(world.x - 75), y: snapToGrid(world.y - 35) },
      params: {},
      name: item.name,
      icon: item.icon,
      color: item.color,
      category: item.category,
      width: 150,
      height: 70,
    };
    setNodes(prev => {
      const next = [...prev, newNode];
      pushHistory(next, connections);
      return next;
    });
  }, [screenToWorld, connections, pushHistory]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (world.x >= n.position.x && world.x <= n.position.x + n.width &&
          world.y >= n.position.y && world.y <= n.position.y + n.height) {
        setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId: n.id });
        setSelectedNodes(new Set([n.id]));
        return;
      }
    }
    setContextMenu(null);
  }, [nodes, screenToWorld]);

  // Node operations
  const deleteNodes = useCallback((nodeIds: Set<string>) => {
    setNodes(prev => {
      const next = prev.filter(n => !nodeIds.has(n.id));
      setConnections(prevC => {
        const nextC = prevC.filter(c => !nodeIds.has(c.sourceNode) && !nodeIds.has(c.targetNode));
        pushHistory(next, nextC);
        return nextC;
      });
      return next;
    });
    setSelectedNodes(new Set());
    setShowConfig(false);
  }, [pushHistory]);

  const duplicateNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const newNode: EditorNode = {
      ...JSON.parse(JSON.stringify(node)),
      id: nextId('n'),
      position: { x: node.position.x + 40, y: node.position.y + 40 },
    };
    setNodes(prev => {
      const next = [...prev, newNode];
      pushHistory(next, connections);
      return next;
    });
    setSelectedNodes(new Set([newNode.id]));
  }, [nodes, connections, pushHistory]);

  const disconnectAll = useCallback((nodeId: string) => {
    setConnections(prev => {
      const next = prev.filter(c => c.sourceNode !== nodeId && c.targetNode !== nodeId);
      pushHistory(nodes, next);
      return next;
    });
  }, [nodes, pushHistory]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodes.size > 0) {
          e.preventDefault();
          deleteNodes(selectedNodes);
        }
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        redo();
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedNodes(new Set(nodes.map(n => n.id)));
      } else if (e.key === 'Escape') {
        setSelectedNodes(new Set());
        setShowConfig(false);
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodes, nodes, deleteNodes, undo, redo]);

  const nodeParams = selectedNode ? NODE_PARAMS[selectedNode.type] : null;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div ref={containerRef} className="h-full w-full relative" tabIndex={0}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDrag({ type: null })}
        onWheel={handleWheel}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onContextMenu={handleContextMenu}
      />

      {/* ── Toolbar ── */}
      <div className="absolute top-3 right-3 flex gap-1.5 z-10 flex-wrap">
        {/* New */}
        <button onClick={newFlow} className="bg-forge-bg/90 border border-forge-border px-2.5 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">
          ✨ New
        </button>

        {/* Save */}
        <button onClick={saveFlow} className="bg-forge-bg/90 border border-forge-border px-2.5 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">
          💾 Save
        </button>

        {/* Load */}
        <div className="relative">
          <button onClick={() => { setShowLoadDropdown(!showLoadDropdown); setShowTemplateDropdown(false); }} className="bg-forge-bg/90 border border-forge-border px-2.5 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">
            📂 Load ▾
          </button>
          {showLoadDropdown && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-forge-bg border border-forge-border rounded-lg shadow-xl overflow-hidden">
              {savedFlows.length === 0 ? (
                <div className="px-3 py-2 text-[10px] font-mono text-forge-text-dim">No saved flows</div>
              ) : savedFlows.map(f => (
                <button key={f.id} onClick={() => loadFlow(f)} className="w-full text-left px-3 py-2 text-[10px] font-mono text-forge-text-dim hover:bg-forge-cyan/10 hover:text-forge-cyan transition-all">
                  {f.name} <span className="text-[8px] opacity-50">· {new Date(f.savedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Templates */}
        <div className="relative">
          <button onClick={() => { setShowTemplateDropdown(!showTemplateDropdown); setShowLoadDropdown(false); }} className="bg-forge-bg/90 border border-forge-border px-2.5 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">
            📋 Templates ▾
          </button>
          {showTemplateDropdown && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-forge-bg border border-forge-border rounded-lg shadow-xl overflow-hidden">
              {Object.entries(FLOW_TEMPLATES).map(([key, tpl]) => (
                <button key={key} onClick={() => loadTemplate(key)} className="w-full text-left px-3 py-2 text-[10px] font-mono text-forge-text-dim hover:bg-forge-cyan/10 hover:text-forge-cyan transition-all">
                  {tpl.icon} {tpl.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Background Flows */}
        <div className="relative">
          <button onClick={() => { setShowBgDropdown(!showBgDropdown); setShowLoadDropdown(false); setShowTemplateDropdown(false); }} className="bg-forge-bg/90 border border-amber-500/40 px-2.5 py-1.5 rounded text-[10px] font-mono text-amber-400 hover:text-amber-300 hover:border-amber-400/60 transition-all">
            ⚡ Background ▾
          </button>
          {showBgDropdown && (
            <div className="absolute top-full right-0 mt-1 w-64 bg-forge-bg border border-amber-500/30 rounded-lg shadow-xl overflow-hidden">
              {backgroundFlows.length === 0 ? (
                <div className="px-3 py-2 text-[10px] font-mono text-forge-text-dim">No background flows</div>
              ) : backgroundFlows.map((f: any) => (
                <button key={f.id} onClick={() => loadBackgroundFlow(f.id)} className="w-full text-left px-3 py-2 text-[10px] font-mono text-forge-text-dim hover:bg-amber-500/10 hover:text-amber-300 transition-all flex items-center gap-2">
                  <span>{f.icon}</span>
                  <span className="flex-1">{f.name}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded ${f.status === 'running' ? 'bg-green-500/20 text-green-400' : f.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                    {f.status || 'stopped'}
                  </span>
                  {f.locked && <span className="text-[8px]">🔒</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lock toggle for background flows */}
        {isBackgroundFlow && (
          <button onClick={toggleFlowLock} className={`bg-forge-bg/90 border px-2.5 py-1.5 rounded text-[10px] font-mono transition-all ${flowLocked ? 'border-amber-500/40 text-amber-400 hover:text-amber-300' : 'border-red-500/40 text-red-400 hover:text-red-300'}`}>
            {flowLocked ? '🔒 Locked' : '🔓 Unlocked'}
          </button>
        )}

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5">
          <button onClick={fitToView} title="Fit all nodes" className="bg-forge-bg/90 border border-forge-border px-2 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan transition-all mr-1">⊞</button>
          <button onClick={() => zoomTo(zoom * 0.8)} title="Zoom out" className="bg-forge-bg/90 border border-forge-border px-2 py-1.5 rounded-l text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan transition-all">−</button>
          <button onClick={resetView} title="Reset to 100%" className="bg-forge-bg/80 border-y border-forge-border px-2 py-1.5 text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan cursor-pointer transition-all">{Math.round(zoom * 100)}%</button>
          <button onClick={() => zoomTo(zoom * 1.25)} title="Zoom in" className="bg-forge-bg/90 border border-forge-border px-2 py-1.5 rounded-r text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan transition-all">+</button>
        </div>

        {/* Status */}
        <span className="bg-forge-bg/80 px-2.5 py-1.5 rounded border border-forge-border text-[10px] font-mono text-forge-text-dim">
          {nodes.length}n · {connections.length}c
        </span>
      </div>

      {/* Flow name */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-2">
          {isBackgroundFlow && (
            <span className="bg-amber-500/20 text-amber-400 text-[8px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30">BG</span>
          )}
          <input
            value={flowName}
            onChange={e => !flowLocked && setFlowName(e.target.value)}
            readOnly={flowLocked}
            className={`bg-transparent text-center text-xs font-mono border-b border-transparent outline-none px-4 py-1 transition-all ${flowLocked ? 'text-forge-text-dim/50 cursor-not-allowed' : 'text-forge-text-dim hover:border-forge-border focus:border-forge-cyan focus:text-forge-text'}`}
          />
          {isBackgroundFlow && (
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${flowLocked ? 'bg-amber-500/10 text-amber-500/60' : 'bg-red-500/10 text-red-400'}`}>
              {flowLocked ? 'READ-ONLY' : 'EDITING'}
            </span>
          )}
        </div>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className="absolute z-20 bg-forge-bg border border-forge-border rounded-lg shadow-xl overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            { label: '📋 Duplicate', action: () => duplicateNode(contextMenu.nodeId) },
            { label: '🗑 Delete', action: () => deleteNodes(new Set([contextMenu.nodeId])) },
            { label: '🔌 Disconnect All', action: () => disconnectAll(contextMenu.nodeId) },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => { item.action(); setContextMenu(null); }}
              className="w-full text-left px-4 py-2 text-[10px] font-mono text-forge-text-dim hover:bg-forge-cyan/10 hover:text-forge-cyan transition-all"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Node config panel ── */}
      {showConfig && selectedNode && (
        <div className="absolute top-3 left-3 w-56 panel-border rounded-lg p-3 z-10 space-y-2 bg-forge-bg/95 backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-forge-cyan flex items-center gap-2">
              <span>{selectedNode.icon}</span>
              {selectedNode.name}
            </h3>
            <button onClick={() => setShowConfig(false)} className="text-forge-text-dim hover:text-forge-text text-xs">✕</button>
          </div>

          <div className="text-[9px] font-mono text-forge-text-dim">{selectedNode.type} · {selectedNode.category}</div>

          {nodeParams && nodeParams.map(param => (
            <div key={param.id}>
              <label className="text-[10px] font-mono text-forge-text-dim">{param.label}</label>
              {param.type === 'select' ? (
                <select
                  value={String(selectedNode.params[param.id] ?? param.default)}
                  onChange={(e) => {
                    const nodeId = selectedNode.id;
                    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, params: { ...n.params, [param.id]: e.target.value } } : n));
                  }}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-[10px] text-forge-text mt-0.5"
                >
                  {param.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input
                  type={param.type === 'number' ? 'number' : 'text'}
                  value={String(selectedNode.params[param.id] ?? param.default ?? '')}
                  onChange={(e) => {
                    const nodeId = selectedNode.id;
                    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, params: { ...n.params, [param.id]: param.type === 'number' ? parseFloat(e.target.value) : e.target.value } } : n));
                  }}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-[10px] text-forge-text mt-0.5"
                />
              )}
            </div>
          ))}

          <button
            onClick={() => deleteNodes(new Set([selectedNode.id]))}
            className="w-full mt-2 py-1 rounded border border-forge-red/30 text-[10px] font-mono text-forge-red/70 hover:bg-forge-red/10 hover:text-forge-red transition-all"
          >
            🗑 Delete Node
          </button>
        </div>
      )}

      {/* Flow execution controls */}
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        {!flowRunning ? (
          <button
            onClick={() => {
              const runner = getFlowRunner();
              runner.load(
                nodes.map(n => ({ id: n.id, type: n.type, params: n.params || {} })),
                connections.map(c => ({ id: c.id, from: c.from, fromPort: c.fromPort, to: c.to, toPort: c.toPort }))
              );
              runner.start();
              setFlowRunning(true);
            }}
            className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-mono transition-colors flex items-center gap-1"
          >
            ▶ Run Flow
          </button>
        ) : (
          <button
            onClick={() => {
              getFlowRunner().stop();
              setFlowRunning(false);
            }}
            className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-mono transition-colors flex items-center gap-1"
          >
            ⏹ Stop
          </button>
        )}
        <div className={"w-2 h-2 rounded-full self-center " + (flowRunning ? "bg-green-500 animate-pulse" : "bg-forge-border")} />
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-3 left-3 text-[8px] font-mono text-forge-text-dim/30 z-10 space-x-3">
        <span>Del: delete</span>
        <span>⌘Z: undo</span>
        <span>⌘⇧Z: redo</span>
        <span>⌘A: select all</span>
        <span>Shift+click: multi-select</span>
        <span>Shift+drag: box select</span>
        <span>Right-click: context menu</span>
      </div>
    </div>
  );
};