import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import {
  DATA_NODE_PORTS, DATA_NODE_PARAMS, DATA_NODE_META, DATA_PORT_COLORS, DATA_CATEGORIES,
} from '@signalforge/shared';
import type { DataFlowCategory, DataFlowPortType, DataFlowNode, DataFlowConnection, DataFlowGraph } from '@signalforge/shared';

// ============================================================================
// Types
// ============================================================================

interface EditorNode extends DataFlowNode {
  name: string;
  icon: string;
  color: string;
  category: DataFlowCategory;
  width: number;
  height: number;
}

interface DragState {
  type: 'node' | 'pan' | 'wire' | null;
  nodeId?: string;
  offsetX?: number;
  offsetY?: number;
  startX?: number;
  startY?: number;
  wireFrom?: { nodeId: string; portId: string; portType: string; x: number; y: number };
  wireEnd?: { x: number; y: number };
}

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

const GRID_SNAP = 20;
const API_BASE = '/api';

const snap = (v: number) => Math.round(v / GRID_SNAP) * GRID_SNAP;

function uid(): string {
  return `df-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeNode(id: string, type: string, x: number, y: number, params: Record<string, unknown> = {}): EditorNode {
  const meta = DATA_NODE_META[type] || { name: type, icon: '?', color: '#888', category: 'source' as DataFlowCategory };
  const defaults: Record<string, unknown> = {};
  (DATA_NODE_PARAMS[type] || []).forEach(p => { defaults[p.id] = p.default; });
  return { id, type, position: { x, y }, params: { ...defaults, ...params }, name: meta.name, icon: meta.icon, color: meta.color, category: meta.category, width: 160, height: 72 };
}

// ============================================================================
// Templates
// ============================================================================

const DATAFLOW_TEMPLATES: Record<string, { name: string; icon: string; nodes: EditorNode[]; connections: DataFlowConnection[] }> = {
  'emergency-alert': {
    name: 'Emergency Alert', icon: '🆘',
    nodes: [
      makeNode('n1', 'decoder_feed', 80, 200, { source: 'any' }),
      makeNode('n2', 'emergency_detect', 320, 200),
      makeNode('n3', 'sound_action', 560, 120, { sound: 'alarm' }),
      makeNode('n4', 'highlight_map', 560, 280, { duration: 30000 }),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'event-out-0', targetNode: 'n2', targetPort: 'event-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'event-out-0', targetNode: 'n3', targetPort: 'event-in-0' },
      { id: 'c3', sourceNode: 'n2', sourcePort: 'event-out-0', targetNode: 'n4', targetPort: 'event-in-0' },
    ],
  },
  'geofence-tracker': {
    name: 'Geofence Tracker', icon: '🔲',
    nodes: [
      makeNode('n1', 'decoder_feed', 80, 200, { source: 'adsb' }),
      makeNode('n2', 'geofence_check', 320, 200),
      makeNode('n3', 'log_action', 560, 140, { level: 'info' }),
      makeNode('n4', 'tts_action', 560, 280, { message: '{{callsign}} entered zone' }),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'event-out-0', targetNode: 'n2', targetPort: 'event-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'event-out-0', targetNode: 'n3', targetPort: 'event-in-0' },
      { id: 'c3', sourceNode: 'n2', sourcePort: 'event-out-0', targetNode: 'n4', targetPort: 'event-in-0' },
    ],
  },
  'speed-monitor': {
    name: 'Speed Monitor', icon: '⚡',
    nodes: [
      makeNode('n1', 'decoder_feed', 80, 200, { source: 'adsb' }),
      makeNode('n2', 'speed_gate', 320, 200, { operator: '>', threshold: 500 }),
      makeNode('n3', 'debounce', 560, 200, { delayMs: 10000 }),
      makeNode('n4', 'webhook_action', 800, 200),
    ],
    connections: [
      { id: 'c1', sourceNode: 'n1', sourcePort: 'event-out-0', targetNode: 'n2', targetPort: 'event-in-0' },
      { id: 'c2', sourceNode: 'n2', sourcePort: 'event-out-0', targetNode: 'n3', targetPort: 'event-in-0' },
      { id: 'c3', sourceNode: 'n3', sourcePort: 'event-out-0', targetNode: 'n4', targetPort: 'event-in-0' },
    ],
  },
};

// ============================================================================
// Component
// ============================================================================

export function DataFlowEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [connections, setConnections] = useState<DataFlowConnection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>({ type: null });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [paletteFilter, setPaletteFilter] = useState('');
  const [savedFlows, setSavedFlows] = useState<{ id: string; name: string }[]>([]);
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(null);
  const [currentFlowName, setCurrentFlowName] = useState('Untitled Data Flow');
  const [showTemplates, setShowTemplates] = useState(false);
  const [triggerPulses, setTriggerPulses] = useState<Map<string, number>>(new Map());

  // WebSocket for live rule triggers
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'rule_triggered') {
          // Pulse the relevant source nodes
          setTriggerPulses(prev => {
            const next = new Map(prev);
            // Find decoder_feed nodes matching the source
            nodes.forEach(n => {
              if (n.type === 'decoder_feed' && (n.params.source === 'any' || n.params.source === msg.source)) {
                next.set(n.id, Date.now());
              }
            });
            return next;
          });
        }
      } catch {}
    };
    return () => ws.close();
  }, [nodes]);

  // Load saved flows
  useEffect(() => {
    fetch(`${API_BASE}/dataflows`).then(r => r.json()).then(setSavedFlows).catch(() => {});
  }, []);

  // ============================================================================
  // Canvas rendering
  // ============================================================================

  const getPortPos = useCallback((node: EditorNode, portType: string, portIndex: number, direction: 'input' | 'output'): { x: number; y: number } => {
    const ports = direction === 'input'
      ? DATA_NODE_PORTS[node.type]?.inputs || []
      : DATA_NODE_PORTS[node.type]?.outputs || [];
    const count = ports.length;
    const spacing = node.height / (count + 1);
    const x = direction === 'input' ? node.position.x : node.position.x + node.width;
    const y = node.position.y + spacing * (portIndex + 1);
    return { x, y };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.offsetWidth * devicePixelRatio;
    const h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Grid
    const gridSize = GRID_SNAP;
    const startX = -pan.x / zoom;
    const startY = -pan.y / zoom;
    const endX = startX + cw / zoom;
    const endY = startY + ch / zoom;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 0.5;
    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, endY); ctx.stroke();
    }
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
    }

    // Connections
    for (const conn of connections) {
      const srcNode = nodes.find(n => n.id === conn.sourceNode);
      const tgtNode = nodes.find(n => n.id === conn.targetNode);
      if (!srcNode || !tgtNode) continue;

      const srcParts = conn.sourcePort.split('-');
      const tgtParts = conn.targetPort.split('-');
      const srcIdx = parseInt(srcParts[2]) || 0;
      const tgtIdx = parseInt(tgtParts[2]) || 0;
      const srcPos = getPortPos(srcNode, srcParts[0], srcIdx, 'output');
      const tgtPos = getPortPos(tgtNode, tgtParts[0], tgtIdx, 'input');

      const portType = srcParts[0] as DataFlowPortType;
      const color = DATA_PORT_COLORS[portType] || '#ffab00';

      // Animated pulse on active connections
      const now = Date.now();
      const srcPulse = triggerPulses.get(srcNode.id);
      const isActive = srcPulse && (now - srcPulse) < 2000;

      ctx.strokeStyle = isActive ? '#ffffff' : color;
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.globalAlpha = isActive ? 0.6 + 0.4 * Math.sin((now - (srcPulse || 0)) / 200) : 0.7;

      const dx = tgtPos.x - srcPos.x;
      const cp = Math.max(Math.abs(dx) * 0.5, 60);
      ctx.beginPath();
      ctx.moveTo(srcPos.x, srcPos.y);
      ctx.bezierCurveTo(srcPos.x + cp, srcPos.y, tgtPos.x - cp, tgtPos.y, tgtPos.x, tgtPos.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Wire being drawn
    if (drag.type === 'wire' && drag.wireFrom && drag.wireEnd) {
      ctx.strokeStyle = '#ffab00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const s = drag.wireFrom;
      const e = drag.wireEnd;
      const dx = e.x - s.x;
      const cp = Math.max(Math.abs(dx) * 0.5, 60);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.bezierCurveTo(s.x + cp, s.y, e.x - cp, e.y, e.x, e.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Nodes
    for (const node of nodes) {
      const isSelected = node.id === selected;
      const meta = DATA_NODE_META[node.type];
      const now = Date.now();
      const pulse = triggerPulses.get(node.id);
      const isPulsing = pulse && (now - pulse) < 2000;

      // Shadow/glow
      if (isPulsing) {
        ctx.shadowColor = meta?.color || '#ffab00';
        ctx.shadowBlur = 15 + 10 * Math.sin((now - pulse!) / 150);
      } else if (isSelected) {
        ctx.shadowColor = meta?.color || '#ffab00';
        ctx.shadowBlur = 12;
      }

      // Node body
      ctx.fillStyle = isSelected ? '#1e1e3a' : '#141428';
      ctx.strokeStyle = isSelected ? (meta?.color || '#ffab00') : '#2a2a4a';
      ctx.lineWidth = isSelected ? 2 : 1;

      const r = 6;
      const { x, y } = node.position;
      ctx.beginPath();
      ctx.roundRect(x, y, node.width, node.height, r);
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Category accent bar (left edge)
      ctx.fillStyle = meta?.color || '#ffab00';
      ctx.beginPath();
      ctx.roundRect(x, y, 4, node.height, [r, 0, 0, r]);
      ctx.fill();

      // Icon + Name
      ctx.fillStyle = '#ffffff';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${meta?.icon || '?'} ${meta?.name || node.type}`, x + 12, y + 22);

      // Params preview
      const paramDefs = DATA_NODE_PARAMS[node.type] || [];
      if (paramDefs.length > 0) {
        ctx.fillStyle = '#888';
        ctx.font = '10px "SF Mono", monospace';
        const preview = paramDefs.slice(0, 2).map(p => {
          const v = node.params[p.id];
          return `${p.label}: ${v ?? p.default}`;
        }).join(' · ');
        ctx.fillText(preview.slice(0, 28), x + 12, y + 42);
      }

      // Ports
      const inputs = DATA_NODE_PORTS[node.type]?.inputs || [];
      const outputs = DATA_NODE_PORTS[node.type]?.outputs || [];

      inputs.forEach((pt, i) => {
        const pos = getPortPos(node, pt, i, 'input');
        ctx.fillStyle = DATA_PORT_COLORS[pt] || '#888';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      outputs.forEach((pt, i) => {
        const pos = getPortPos(node, pt, i, 'output');
        ctx.fillStyle = DATA_PORT_COLORS[pt] || '#888';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Trigger count badge
      if (isPulsing) {
        ctx.fillStyle = '#ff6d00';
        ctx.beginPath();
        ctx.arc(x + node.width - 8, y + 8, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Watermark
    ctx.fillStyle = '#1a1a2e';
    ctx.font = '11px system-ui';
    ctx.fillText('DATA FLOW', 10, ch - 10);
  }, [nodes, connections, pan, zoom, selected, drag, triggerPulses, getPortPos]);

  useEffect(() => {
    let raf: number;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ============================================================================
  // Mouse handlers
  // ============================================================================

  const screenToCanvas = useCallback((sx: number, sy: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (sx - rect.left - pan.x) / zoom, y: (sy - rect.top - pan.y) / zoom };
  }, [pan, zoom]);

  const hitTest = useCallback((cx: number, cy: number): EditorNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (cx >= n.position.x && cx <= n.position.x + n.width && cy >= n.position.y && cy <= n.position.y + n.height) {
        return n;
      }
    }
    return null;
  }, [nodes]);

  const hitPort = useCallback((cx: number, cy: number): { nodeId: string; portId: string; portType: string; direction: string; x: number; y: number } | null => {
    for (const node of nodes) {
      const inputs = DATA_NODE_PORTS[node.type]?.inputs || [];
      const outputs = DATA_NODE_PORTS[node.type]?.outputs || [];

      for (let i = 0; i < inputs.length; i++) {
        const pos = getPortPos(node, inputs[i], i, 'input');
        if (Math.hypot(cx - pos.x, cy - pos.y) < 10) {
          return { nodeId: node.id, portId: `${inputs[i]}-in-${i}`, portType: inputs[i], direction: 'input', ...pos };
        }
      }
      for (let i = 0; i < outputs.length; i++) {
        const pos = getPortPos(node, outputs[i], i, 'output');
        if (Math.hypot(cx - pos.x, cy - pos.y) < 10) {
          return { nodeId: node.id, portId: `${outputs[i]}-out-${i}`, portType: outputs[i], direction: 'output', ...pos };
        }
      }
    }
    return null;
  }, [nodes, getPortPos]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setCtxMenu(null);
    const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);

    // Right-click context menu
    if (e.button === 2) {
      const node = hitTest(cx, cy);
      if (node) {
        e.preventDefault();
        const rect = canvasRef.current!.getBoundingClientRect();
        setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId: node.id });
      }
      return;
    }

    // Check port click first
    const port = hitPort(cx, cy);
    if (port && port.direction === 'output') {
      setDrag({ type: 'wire', wireFrom: { nodeId: port.nodeId, portId: port.portId, portType: port.portType, x: port.x, y: port.y }, wireEnd: { x: cx, y: cy } });
      return;
    }

    // Node drag
    const node = hitTest(cx, cy);
    if (node) {
      setSelected(node.id);
      setDrag({ type: 'node', nodeId: node.id, offsetX: cx - node.position.x, offsetY: cy - node.position.y });
      return;
    }

    // Pan
    setSelected(null);
    setDrag({ type: 'pan', startX: e.clientX - pan.x, startY: e.clientY - pan.y });
  }, [screenToCanvas, hitTest, hitPort, pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (drag.type === 'node' && drag.nodeId) {
      const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);
      setNodes(prev => prev.map(n =>
        n.id === drag.nodeId ? { ...n, position: { x: snap(cx - (drag.offsetX || 0)), y: snap(cy - (drag.offsetY || 0)) } } : n
      ));
    } else if (drag.type === 'pan') {
      setPan({ x: e.clientX - (drag.startX || 0), y: e.clientY - (drag.startY || 0) });
    } else if (drag.type === 'wire') {
      const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);
      setDrag(prev => ({ ...prev, wireEnd: { x: cx, y: cy } }));
    }
  }, [drag, screenToCanvas]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (drag.type === 'wire' && drag.wireFrom) {
      const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);
      const port = hitPort(cx, cy);
      if (port && port.direction === 'input' && port.nodeId !== drag.wireFrom.nodeId) {
        // Check compatible types
        const srcType = drag.wireFrom.portType;
        const tgtType = port.portType;
        if (srcType === tgtType || srcType === 'any' || tgtType === 'any') {
          const connId = `c-${uid()}`;
          setConnections(prev => [...prev, {
            id: connId,
            sourceNode: drag.wireFrom!.nodeId,
            sourcePort: drag.wireFrom!.portId,
            targetNode: port.nodeId,
            targetPort: port.portId,
          }]);
        }
      }
    }
    setDrag({ type: null });
  }, [drag, screenToCanvas, hitPort]);

  const zoomTo = useCallback((newZ: number, cx?: number, cy?: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = cx ?? rect.width / 2;
    const my = cy ?? rect.height / 2;
    const clamped = Math.max(0.1, Math.min(5, newZ));
    setPan(prev => ({
      x: mx - (mx - prev.x) * (clamped / zoom),
      y: my - (my - prev.y) * (clamped / zoom),
    }));
    setZoom(clamped);
  }, [zoom]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
    const newZoom = Math.max(0.1, Math.min(5, zoom * factor));
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setPan(prev => ({
      x: mx - (mx - prev.x) * (newZoom / zoom),
      y: my - (my - prev.y) * (newZoom / zoom),
    }));
    setZoom(newZoom);
  }, [zoom]);

  const fitToView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) return;
    const pad = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + (n.width || 160));
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

  const onContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  // ============================================================================
  // Actions
  // ============================================================================

  const addNode = useCallback((type: string) => {
    const id = uid();
    const node = makeNode(id, type, snap((-pan.x + 300) / zoom), snap((-pan.y + 200) / zoom));
    setNodes(prev => [...prev, node]);
    setSelected(id);
  }, [pan, zoom]);

  const deleteNode = useCallback((id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setConnections(prev => prev.filter(c => c.sourceNode !== id && c.targetNode !== id));
    if (selected === id) setSelected(null);
    setCtxMenu(null);
  }, [selected]);

  const duplicateNode = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    const newId = uid();
    const dup = { ...node, id: newId, position: { x: node.position.x + 40, y: node.position.y + 40 } };
    setNodes(prev => [...prev, dup]);
    setSelected(newId);
    setCtxMenu(null);
  }, [nodes]);

  const loadTemplate = useCallback((key: string) => {
    const t = DATAFLOW_TEMPLATES[key];
    if (!t) return;
    setNodes([...t.nodes]);
    setConnections([...t.connections]);
    setCurrentFlowName(t.name);
    setCurrentFlowId(null);
    setShowTemplates(false);
  }, []);

  const saveFlow = useCallback(async () => {
    const data = { name: currentFlowName, nodes, connections };
    try {
      if (currentFlowId) {
        await fetch(`${API_BASE}/dataflows/${currentFlowId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      } else {
        const res = await fetch(`${API_BASE}/dataflows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const saved = await res.json();
        setCurrentFlowId(saved.id);
      }
      const list = await fetch(`${API_BASE}/dataflows`).then(r => r.json());
      setSavedFlows(list);
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, [currentFlowId, currentFlowName, nodes, connections]);

  const loadFlow = useCallback(async (id: string) => {
    try {
      const flow = await fetch(`${API_BASE}/dataflows/${id}`).then(r => r.json());
      const loaded = flow.nodes?.map((n: any) => makeNode(n.id, n.type, n.position.x, n.position.y, n.params)) || [];
      setNodes(loaded);
      setConnections(flow.connections || []);
      setCurrentFlowId(id);
      setCurrentFlowName(flow.name || 'Untitled');
    } catch (e) {
      console.error('Load failed:', e);
    }
  }, []);

  // ============================================================================
  // Property editor for selected node
  // ============================================================================

  const selectedNode = useMemo(() => nodes.find(n => n.id === selected), [nodes, selected]);
  const selectedParams = useMemo(() => selectedNode ? DATA_NODE_PARAMS[selectedNode.type] || [] : [], [selectedNode]);

  const updateParam = useCallback((paramId: string, value: unknown) => {
    if (!selected) return;
    setNodes(prev => prev.map(n =>
      n.id === selected ? { ...n, params: { ...n.params, [paramId]: value } } : n
    ));
  }, [selected]);

  // ============================================================================
  // Palette
  // ============================================================================

  const filteredCategories = useMemo(() => {
    const filter = paletteFilter.toLowerCase();
    return DATA_CATEGORIES.map(cat => {
      const nodeTypes = Object.entries(DATA_NODE_META)
        .filter(([_, m]) => m.category === cat.id)
        .filter(([type, m]) => !filter || m.name.toLowerCase().includes(filter) || type.includes(filter));
      return { ...cat, nodeTypes };
    }).filter(c => c.nodeTypes.length > 0);
  }, [paletteFilter]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="h-full flex" style={{ background: '#0a0a0f' }}>
      {/* Node Palette */}
      {showPalette && (
        <div className="w-56 flex-shrink-0 border-r border-[#1a1a2e] flex flex-col" style={{ background: '#0e0e1a' }}>
          <div className="p-2 border-b border-[#1a1a2e]">
            <div className="flex items-center gap-1 mb-2">
              <span className="text-amber-400 text-xs font-bold tracking-wider">⚡ DATA FLOW</span>
              <button onClick={() => setShowTemplates(!showTemplates)} className="ml-auto text-xs text-gray-500 hover:text-amber-400 px-1">
                📋
              </button>
            </div>
            <input
              className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:border-amber-500 outline-none"
              placeholder="Search nodes..."
              value={paletteFilter}
              onChange={e => setPaletteFilter(e.target.value)}
            />
          </div>

          {showTemplates && (
            <div className="p-2 border-b border-[#1a1a2e]">
              <div className="text-xs text-gray-500 mb-1">Templates</div>
              {Object.entries(DATAFLOW_TEMPLATES).map(([key, t]) => (
                <button
                  key={key}
                  onClick={() => loadTemplate(key)}
                  className="w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-[#1a1a2e] rounded flex items-center gap-1"
                >
                  <span>{t.icon}</span> {t.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {filteredCategories.map(cat => (
              <div key={cat.id} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-bold tracking-wider uppercase" style={{ color: cat.color }}>
                  {cat.icon} {cat.label}
                </div>
                {cat.nodeTypes.map(([type, meta]) => (
                  <button
                    key={type}
                    onClick={() => addNode(type)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#1a1a2e] flex items-center gap-2 transition-colors"
                    title={type}
                  >
                    <span className="w-4 text-center">{meta.icon}</span>
                    <span>{meta.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Saved flows */}
          <div className="border-t border-[#1a1a2e] p-2">
            <div className="text-[10px] text-gray-500 mb-1">SAVED FLOWS</div>
            {savedFlows.slice(0, 5).map(f => (
              <button
                key={f.id}
                onClick={() => loadFlow(f.id)}
                className={`w-full text-left text-xs px-2 py-0.5 rounded truncate ${f.id === currentFlowId ? 'text-amber-400 bg-amber-400/10' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 relative">
        {/* Toolbar */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
          <button
            onClick={() => setShowPalette(!showPalette)}
            className="bg-[#141428] border border-[#2a2a4a] text-gray-400 hover:text-amber-400 px-2 py-1 rounded text-xs"
          >
            {showPalette ? '◀' : '▶'}
          </button>
          <input
            className="bg-[#141428] border border-[#2a2a4a] text-gray-200 px-2 py-1 rounded text-xs w-40 focus:border-amber-500 outline-none"
            value={currentFlowName}
            onChange={e => setCurrentFlowName(e.target.value)}
          />
          <button
            onClick={saveFlow}
            className="bg-amber-600/20 border border-amber-600/40 text-amber-400 hover:bg-amber-600/30 px-2 py-1 rounded text-xs"
          >
            💾 Save
          </button>
          <button
            onClick={() => { setNodes([]); setConnections([]); setCurrentFlowId(null); setCurrentFlowName('Untitled Data Flow'); }}
            className="bg-[#141428] border border-[#2a2a4a] text-gray-400 hover:text-red-400 px-2 py-1 rounded text-xs"
          >
            🗑️ Clear
          </button>
          <span className="text-[10px] text-gray-600 ml-2">{nodes.length} nodes · {connections.length} wires</span>
          <div className="flex items-center gap-0.5 ml-2">
            <button onClick={fitToView} title="Fit all nodes" className="bg-[#141428] border border-[#2a2a4a] px-2 py-1 rounded text-[10px] font-mono text-gray-500 hover:text-amber-400 transition-all mr-1">⊞</button>
            <button onClick={() => zoomTo(zoom * 0.8)} title="Zoom out" className="bg-[#141428] border border-[#2a2a4a] px-2 py-1 rounded-l text-[10px] font-mono text-gray-500 hover:text-amber-400 transition-all">−</button>
            <button onClick={resetView} title="Reset to 100%" className="bg-[#141428] border-y border-[#2a2a4a] px-2 py-1 text-[10px] font-mono text-gray-500 hover:text-amber-400 cursor-pointer transition-all">{Math.round(zoom * 100)}%</button>
            <button onClick={() => zoomTo(zoom * 1.25)} title="Zoom in" className="bg-[#141428] border border-[#2a2a4a] px-2 py-1 rounded-r text-[10px] font-mono text-gray-500 hover:text-amber-400 transition-all">+</button>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
        />

        {/* Context menu */}
        {ctxMenu && (
          <div
            className="absolute z-20 bg-[#141428] border border-[#2a2a4a] rounded shadow-lg py-1 min-w-[140px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button onClick={() => duplicateNode(ctxMenu.nodeId)} className="w-full text-left px-3 py-1 text-xs text-gray-300 hover:bg-[#1a1a2e]">
              📋 Duplicate
            </button>
            <button onClick={() => deleteNode(ctxMenu.nodeId)} className="w-full text-left px-3 py-1 text-xs text-red-400 hover:bg-[#1a1a2e]">
              🗑️ Delete
            </button>
          </div>
        )}

        {/* Property panel */}
        {selectedNode && (
          <div className="absolute top-2 right-2 z-10 w-60 bg-[#0e0e1a] border border-[#2a2a4a] rounded shadow-xl">
            <div className="p-2 border-b border-[#1a1a2e] flex items-center justify-between">
              <span className="text-xs font-bold text-gray-200">{DATA_NODE_META[selectedNode.type]?.icon} {DATA_NODE_META[selectedNode.type]?.name}</span>
              <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-gray-300 text-xs">✕</button>
            </div>
            <div className="p-2 space-y-2">
              {selectedParams.map(p => (
                <div key={p.id}>
                  <label className="text-[10px] text-gray-500 block mb-0.5">{p.label}</label>
                  {p.type === 'select' ? (
                    <select
                      className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-200 focus:border-amber-500 outline-none"
                      value={String(selectedNode.params[p.id] ?? p.default)}
                      onChange={e => updateParam(p.id, e.target.value)}
                    >
                      {(p.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : p.type === 'textarea' ? (
                    <textarea
                      className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-200 focus:border-amber-500 outline-none resize-none font-mono"
                      rows={3}
                      value={String(selectedNode.params[p.id] ?? p.default)}
                      onChange={e => updateParam(p.id, e.target.value)}
                      placeholder={p.placeholder}
                    />
                  ) : p.type === 'toggle' ? (
                    <button
                      className={`px-2 py-0.5 rounded text-xs ${selectedNode.params[p.id] ? 'bg-amber-600 text-white' : 'bg-[#141428] text-gray-400 border border-[#2a2a4a]'}`}
                      onClick={() => updateParam(p.id, !selectedNode.params[p.id])}
                    >
                      {selectedNode.params[p.id] ? 'ON' : 'OFF'}
                    </button>
                  ) : p.type === 'number' ? (
                    <input
                      type="number"
                      className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-200 focus:border-amber-500 outline-none font-mono"
                      value={Number(selectedNode.params[p.id] ?? p.default)}
                      onChange={e => updateParam(p.id, parseFloat(e.target.value) || 0)}
                    />
                  ) : (
                    <input
                      type="text"
                      className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-200 focus:border-amber-500 outline-none font-mono"
                      value={String(selectedNode.params[p.id] ?? p.default)}
                      onChange={e => updateParam(p.id, e.target.value)}
                      placeholder={p.placeholder}
                    />
                  )}
                </div>
              ))}
              {selectedParams.length === 0 && (
                <div className="text-xs text-gray-600 italic">No parameters</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
