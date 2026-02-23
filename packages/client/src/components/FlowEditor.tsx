import React, { useRef, useCallback, useState, useEffect } from 'react';
import type { FlowNode, FlowConnection, NodeCategory } from '@signalforge/shared';

interface EditorNode extends FlowNode {
  name: string;
  icon: string;
  color: string;
  category: NodeCategory;
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
};

// Default demo flowgraph
const DEFAULT_NODES: EditorNode[] = [
  { id: 'n1', type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 100e6, rate: 2.4e6 }, name: 'SDR Source', icon: '📡', color: '#00e5ff', category: 'source', width: 160, height: 80 },
  { id: 'n2', type: 'fft', position: { x: 340, y: 120 }, params: { size: 4096 }, name: 'FFT', icon: '📊', color: '#ff1744', category: 'analysis', width: 140, height: 70 },
  { id: 'n3', type: 'waterfall', position: { x: 580, y: 80 }, params: {}, name: 'Waterfall', icon: '≋', color: '#ff1744', category: 'analysis', width: 150, height: 70 },
  { id: 'n4', type: 'bandpass', position: { x: 340, y: 280 }, params: { low: -50000, high: 50000 }, name: 'Band Pass', icon: '◇', color: '#00e676', category: 'filter', width: 150, height: 70 },
  { id: 'n5', type: 'fm_demod', position: { x: 580, y: 250 }, params: { bandwidth: 200000 }, name: 'FM Demod', icon: 'FM', color: '#ffab00', category: 'demodulator', width: 150, height: 70 },
  { id: 'n6', type: 'audio_out', position: { x: 820, y: 250 }, params: {}, name: 'Audio Out', icon: '🔈', color: '#6a6a8a', category: 'output', width: 140, height: 70 },
  { id: 'n7', type: 'spectrum', position: { x: 580, y: 380 }, params: {}, name: 'Spectrum', icon: '📈', color: '#ff1744', category: 'analysis', width: 150, height: 70 },
];

const DEFAULT_CONNECTIONS: FlowConnection[] = [
  { id: 'c1', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n2', targetPort: 'iq-in-0' },
  { id: 'c2', sourceNode: 'n2', sourcePort: 'fft-out-0', targetNode: 'n3', targetPort: 'fft-in-0' },
  { id: 'c3', sourceNode: 'n1', sourcePort: 'iq-out-0', targetNode: 'n4', targetPort: 'iq-in-0' },
  { id: 'c4', sourceNode: 'n4', sourcePort: 'iq-out-0', targetNode: 'n5', targetPort: 'iq-in-0' },
  { id: 'c5', sourceNode: 'n5', sourcePort: 'audio-out-0', targetNode: 'n6', targetPort: 'audio-in-0' },
  { id: 'c6', sourceNode: 'n2', sourcePort: 'fft-out-0', targetNode: 'n7', targetPort: 'fft-in-0' },
];

export const FlowEditor: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<EditorNode[]>(DEFAULT_NODES);
  const [connections, setConnections] = useState<FlowConnection[]>(DEFAULT_CONNECTIONS);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState>({ type: null });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const animFrame = useRef<number>(0);

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

  // Check port type compatibility for connections
  const arePortsCompatible = useCallback((srcType: string, tgtType: string): boolean => {
    return srcType === tgtType;
  }, []);

  // Canvas rendering
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

    // Connections
    for (const conn of connections) {
      const srcNode = nodes.find((n) => n.id === conn.sourceNode);
      const tgtNode = nodes.find((n) => n.id === conn.targetNode);
      if (!srcNode || !tgtNode) continue;

      const src = getPortPos(srcNode, conn.sourcePort, false);
      const tgt = getPortPos(tgtNode, conn.targetPort, true);
      const dx = Math.abs(tgt.x - src.x) * 0.5;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo(src.x + dx, src.y, tgt.x - dx, tgt.y, tgt.x, tgt.y);

      const time = Date.now() / 1000;
      const alpha = 0.5 + 0.3 * Math.sin(time * 2 + parseInt(conn.id.slice(1)));
      const portType = conn.sourcePort.split('-')[0];
      const color = PORT_COLORS[portType] || '#00e5ff';
      ctx.strokeStyle = color.slice(0, 7) + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Wire being drawn
    if (drag.type === 'wire' && drag.wireFrom && drag.wireEnd) {
      const from = drag.wireFrom;
      const to = drag.wireEnd;
      const worldTo = { x: (to.x - pan.x) / zoom, y: (to.y - pan.y) / zoom };
      const dx = Math.abs(worldTo.x - from.x) * 0.5;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x + dx, from.y, worldTo.x - dx, worldTo.y, worldTo.x, worldTo.y);
      ctx.strokeStyle = PORT_COLORS[from.portType] || '#00e5ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Nodes
    for (const node of nodes) {
      const isSelected = node.id === selectedNode;

      ctx.fillStyle = isSelected ? 'rgba(0, 229, 255, 0.08)' : 'rgba(18, 18, 26, 0.95)';
      ctx.strokeStyle = isSelected ? node.color : node.color + '40';
      ctx.lineWidth = isSelected ? 2 : 1;

      const r = 8;
      ctx.beginPath();
      ctx.roundRect(node.position.x, node.position.y, node.width, node.height, r);
      ctx.fill();
      if (isSelected) { ctx.shadowColor = node.color; ctx.shadowBlur = 15; }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Header bar
      ctx.fillStyle = node.color + '20';
      ctx.beginPath();
      ctx.roundRect(node.position.x, node.position.y, node.width, 28, [r, r, 0, 0]);
      ctx.fill();

      // Category line
      ctx.fillStyle = node.color;
      ctx.fillRect(node.position.x, node.position.y, 3, node.height);

      // Title
      ctx.fillStyle = '#e0e0e8';
      ctx.font = '11px "JetBrains Mono"';
      ctx.fillText(`${node.icon} ${node.name}`, node.position.x + 12, node.position.y + 18);

      // Ports
      const ports = NODE_PORTS[node.type] || { inputs: [], outputs: [] };

      ports.inputs.forEach((portType, i) => {
        const pos = getPortPos(node, `${portType}-in-${i}`, true);
        ctx.fillStyle = PORT_COLORS[portType] || '#666';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0a0a0f'; ctx.lineWidth = 2; ctx.stroke();
        // Port label
        ctx.fillStyle = PORT_COLORS[portType] + '80' || '#666';
        ctx.font = '8px "JetBrains Mono"';
        ctx.fillText(portType.toUpperCase(), pos.x + 8, pos.y + 3);
      });

      ports.outputs.forEach((portType, i) => {
        const pos = getPortPos(node, `${portType}-out-${i}`, false);
        ctx.fillStyle = PORT_COLORS[portType] || '#666';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0a0a0f'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = PORT_COLORS[portType] + '80' || '#666';
        ctx.font = '8px "JetBrains Mono"';
        ctx.textAlign = 'right';
        ctx.fillText(portType.toUpperCase(), pos.x - 8, pos.y + 3);
        ctx.textAlign = 'left';
      });
    }

    ctx.restore();
    animFrame.current = requestAnimationFrame(render);
  }, [nodes, connections, pan, zoom, selectedNode, getPortPos, drag]);

  useEffect(() => {
    animFrame.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrame.current);
  }, [render]);

  const screenToWorld = (sx: number, sy: number) => ({
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  });

  // Find port near a world position
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

  const handleMouseDown = (e: React.MouseEvent) => {
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
      });
      return;
    }

    // Check nodes
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (world.x >= n.position.x && world.x <= n.position.x + n.width &&
          world.y >= n.position.y && world.y <= n.position.y + n.height) {
        setSelectedNode(n.id);
        setShowConfig(true);
        setDrag({ type: 'node', nodeId: n.id, offsetX: world.x - n.position.x, offsetY: world.y - n.position.y });
        return;
      }
    }

    setSelectedNode(null);
    setShowConfig(false);
    setDrag({ type: 'pan', startX: e.clientX - pan.x, startY: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (drag.type === 'node' && drag.nodeId) {
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      setNodes((prev) => prev.map((n) =>
        n.id === drag.nodeId ? { ...n, position: { x: world.x - (drag.offsetX || 0), y: world.y - (drag.offsetY || 0) } } : n
      ));
    } else if (drag.type === 'pan') {
      setPan({ x: e.clientX - (drag.startX || 0), y: e.clientY - (drag.startY || 0) });
    } else if (drag.type === 'wire') {
      setDrag(prev => ({ ...prev, wireEnd: { x: e.clientX - rect.left, y: e.clientY - rect.top } }));
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (drag.type === 'wire' && drag.wireFrom) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const targetPort = findPort(world.x, world.y, true);

        if (targetPort && targetPort.nodeId !== drag.wireFrom.nodeId) {
          // Validate compatibility
          if (arePortsCompatible(drag.wireFrom.portType, targetPort.portType)) {
            const newConn: FlowConnection = {
              id: `c${Date.now()}`,
              sourceNode: drag.wireFrom.nodeId,
              sourcePort: drag.wireFrom.portId,
              targetNode: targetPort.nodeId,
              targetPort: targetPort.portId,
            };
            setConnections(prev => [...prev, newConn]);
          }
        }
      }
    }
    setDrag({ type: null });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.2, Math.min(3, z * factor)));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/signalforge-node');
    if (!data) return;

    const item = JSON.parse(data);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const newNode: EditorNode = {
      id: `n${Date.now()}`,
      type: item.type,
      position: { x: world.x - 70, y: world.y - 35 },
      params: {},
      name: item.name,
      icon: item.icon,
      color: item.color,
      category: item.category,
      width: 150,
      height: 70,
    };
    setNodes((prev) => [...prev, newNode]);
  };

  // Save/load
  const saveFlowgraph = () => {
    const data = JSON.stringify({ nodes, connections }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'flowgraph.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const loadFlowgraph = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.nodes) setNodes(data.nodes);
      if (data.connections) setConnections(data.connections);
    };
    input.click();
  };

  const deleteNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setConnections(prev => prev.filter(c => c.sourceNode !== nodeId && c.targetNode !== nodeId));
    setSelectedNode(null);
    setShowConfig(false);
  };

  const selectedNodeData = nodes.find(n => n.id === selectedNode);
  const nodeParams = selectedNodeData ? NODE_PARAMS[selectedNodeData.type] : null;

  return (
    <div className="h-full w-full relative">
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
      />

      {/* Toolbar */}
      <div className="absolute top-3 right-3 flex gap-2 z-10">
        <button onClick={saveFlowgraph} className="bg-forge-bg/90 border border-forge-border px-3 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">
          💾 Save
        </button>
        <button onClick={loadFlowgraph} className="bg-forge-bg/90 border border-forge-border px-3 py-1.5 rounded text-[10px] font-mono text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">
          📂 Load
        </button>
        <span className="bg-forge-bg/80 px-3 py-1.5 rounded border border-forge-border text-[10px] font-mono text-forge-text-dim">
          {nodes.length} nodes · {connections.length} connections · {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Node config panel */}
      {showConfig && selectedNodeData && (
        <div className="absolute top-3 left-3 w-56 panel-border rounded-lg p-3 z-10 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-forge-cyan flex items-center gap-2">
              <span>{selectedNodeData.icon}</span>
              {selectedNodeData.name}
            </h3>
            <button onClick={() => setShowConfig(false)} className="text-forge-text-dim hover:text-forge-text text-xs">✕</button>
          </div>

          <div className="text-[9px] font-mono text-forge-text-dim">{selectedNodeData.type} · {selectedNodeData.category}</div>

          {nodeParams && nodeParams.map(param => (
            <div key={param.id}>
              <label className="text-[10px] font-mono text-forge-text-dim">{param.label}</label>
              {param.type === 'select' ? (
                <select
                  value={String(selectedNodeData.params[param.id] ?? param.default)}
                  onChange={(e) => setNodes(prev => prev.map(n => n.id === selectedNode ? { ...n, params: { ...n.params, [param.id]: e.target.value } } : n))}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-[10px] text-forge-text mt-0.5"
                >
                  {param.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input
                  type={param.type === 'number' ? 'number' : 'text'}
                  value={String(selectedNodeData.params[param.id] ?? param.default ?? '')}
                  onChange={(e) => setNodes(prev => prev.map(n => n.id === selectedNode ? { ...n, params: { ...n.params, [param.id]: param.type === 'number' ? parseFloat(e.target.value) : e.target.value } } : n))}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-[10px] text-forge-text mt-0.5"
                />
              )}
            </div>
          ))}

          <button
            onClick={() => deleteNode(selectedNodeData.id)}
            className="w-full mt-2 py-1 rounded border border-forge-red/30 text-[10px] font-mono text-forge-red/70 hover:bg-forge-red/10 hover:text-forge-red transition-all"
          >
            🗑 Delete Node
          </button>
        </div>
      )}
    </div>
  );
};
