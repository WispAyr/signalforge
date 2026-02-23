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
}

const PORT_COLORS: Record<string, string> = {
  iq: '#00e5ff',
  audio: '#00e676',
  fft: '#ffab00',
  bits: '#ff1744',
  packets: '#aa00ff',
  control: '#6a6a8a',
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
  const [connections] = useState<FlowConnection[]>(DEFAULT_CONNECTIONS);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState>({ type: null });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const animFrame = useRef<number>(0);

  const getPortPos = useCallback((node: EditorNode, portId: string, isInput: boolean): { x: number; y: number } => {
    const ports = NODE_PORTS[node.type] || { inputs: [], outputs: [] };
    const list = isInput ? ports.inputs : ports.outputs;
    const idx = list.findIndex((_, i) => {
      const expected = `${list[i]}-${isInput ? 'in' : 'out'}-${i}`;
      return expected === portId;
    });
    const portIdx = idx >= 0 ? idx : 0;
    const total = list.length || 1;
    const spacing = node.height / (total + 1);

    return {
      x: node.position.x + (isInput ? 0 : node.width),
      y: node.position.y + spacing * (portIdx + 1),
    };
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

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Grid
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const gridSize = 40;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.lineWidth = 0.5;
    const startX = -pan.x / zoom - gridSize;
    const startY = -pan.y / zoom - gridSize;
    const endX = (rect.width - pan.x) / zoom + gridSize;
    const endY = (rect.height - pan.y) / zoom + gridSize;

    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }

    // Draw connections
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

      // Animated glow
      const time = Date.now() / 1000;
      const alpha = 0.5 + 0.3 * Math.sin(time * 2 + parseInt(conn.id.slice(1)));
      ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Draw nodes
    for (const node of nodes) {
      const isSelected = node.id === selectedNode;

      // Node background
      ctx.fillStyle = isSelected ? 'rgba(0, 229, 255, 0.08)' : 'rgba(18, 18, 26, 0.95)';
      ctx.strokeStyle = isSelected ? node.color : node.color + '40';
      ctx.lineWidth = isSelected ? 2 : 1;

      // Rounded rect
      const r = 8;
      ctx.beginPath();
      ctx.roundRect(node.position.x, node.position.y, node.width, node.height, r);
      ctx.fill();

      if (isSelected) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 15;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Header bar
      ctx.fillStyle = node.color + '20';
      ctx.beginPath();
      ctx.roundRect(node.position.x, node.position.y, node.width, 28, [r, r, 0, 0]);
      ctx.fill();

      // Category indicator line
      ctx.fillStyle = node.color;
      ctx.fillRect(node.position.x, node.position.y, 3, node.height);

      // Node title
      ctx.fillStyle = '#e0e0e8';
      ctx.font = '11px "JetBrains Mono"';
      ctx.fillText(`${node.icon} ${node.name}`, node.position.x + 12, node.position.y + 18);

      // Ports
      const ports = NODE_PORTS[node.type] || { inputs: [], outputs: [] };

      // Input ports
      ports.inputs.forEach((portType, i) => {
        const pos = getPortPos(node, `${portType}-in-${i}`, true);
        ctx.fillStyle = PORT_COLORS[portType] || '#666';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Output ports
      ports.outputs.forEach((portType, i) => {
        const pos = getPortPos(node, `${portType}-out-${i}`, false);
        ctx.fillStyle = PORT_COLORS[portType] || '#666';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    ctx.restore();
    animFrame.current = requestAnimationFrame(render);
  }, [nodes, connections, pan, zoom, selectedNode, getPortPos]);

  useEffect(() => {
    animFrame.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrame.current);
  }, [render]);

  const screenToWorld = (sx: number, sy: number) => ({
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // Check if clicking on a node
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (world.x >= n.position.x && world.x <= n.position.x + n.width &&
          world.y >= n.position.y && world.y <= n.position.y + n.height) {
        setSelectedNode(n.id);
        setDrag({
          type: 'node',
          nodeId: n.id,
          offsetX: world.x - n.position.x,
          offsetY: world.y - n.position.y,
        });
        return;
      }
    }

    // Pan
    setSelectedNode(null);
    setDrag({ type: 'pan', startX: e.clientX - pan.x, startY: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (drag.type === 'node' && drag.nodeId) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === drag.nodeId
            ? { ...n, position: { x: world.x - (drag.offsetX || 0), y: world.y - (drag.offsetY || 0) } }
            : n
        )
      );
    } else if (drag.type === 'pan') {
      setPan({ x: e.clientX - (drag.startX || 0), y: e.clientY - (drag.startY || 0) });
    }
  };

  const handleMouseUp = () => setDrag({ type: null });

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

  return (
    <div className="h-full w-full relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      />

      {/* Overlay info */}
      <div className="absolute top-3 right-3 text-[10px] font-mono text-forge-text-dim bg-forge-bg/80 px-3 py-1.5 rounded border border-forge-border">
        {nodes.length} nodes · {connections.length} connections · {Math.round(zoom * 100)}%
      </div>
    </div>
  );
};
