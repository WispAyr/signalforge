import React, { useState, useEffect } from 'react';
import type { EdgeNode } from '@signalforge/shared';

export const EdgeNodesPage: React.FC = () => {
  const [nodes, setNodes] = useState<EdgeNode[]>([]);

  useEffect(() => {
    fetch('/api/edge/nodes').then(r => r.json()).then(setNodes).catch(() => {});
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'edge_nodes') setNodes(msg.nodes);
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, []);

  const formatBytes = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`;
  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider mb-1">🖥️ EDGE NODES</h2>
        <p className="text-xs font-mono text-forge-text-dim mb-6">Distributed SDR network — remote receivers on Pi, Van, and field devices</p>

        {nodes.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🖥️</div>
            <p className="text-sm font-mono text-forge-text-dim">No edge nodes connected</p>
            <p className="text-[10px] font-mono text-forge-text-dim mt-2">
              Run <code className="text-forge-cyan">npx @signalforge/edge-node</code> on a Pi or remote machine
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {nodes.map(node => (
              <div key={node.id} className="panel-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      node.status === 'online' ? 'bg-forge-green animate-pulse-slow' :
                      node.status === 'degraded' ? 'bg-forge-amber animate-pulse' :
                      'bg-forge-red'
                    }`} />
                    <h3 className="font-mono text-sm text-forge-text">{node.name}</h3>
                    <span className="text-[9px] font-mono text-forge-text-dim px-1.5 py-0.5 rounded bg-forge-bg">{node.status.toUpperCase()}</span>
                  </div>
                  <span className="text-[9px] font-mono text-forge-text-dim">v{node.version}</span>
                </div>

                {/* System info */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono mb-3">
                  <div><span className="text-forge-text-dim">Host:</span> <span className="text-forge-text">{node.hostname}</span></div>
                  <div><span className="text-forge-text-dim">IP:</span> <span className="text-forge-text">{node.ip}</span></div>
                  <div><span className="text-forge-text-dim">CPU:</span> <span className="text-forge-text">{node.system.cpuCores}× {node.system.arch}</span></div>
                  <div><span className="text-forge-text-dim">RAM:</span> <span className="text-forge-text">{formatBytes(node.system.memoryFree)} / {formatBytes(node.system.memoryTotal)}</span></div>
                  <div><span className="text-forge-text-dim">Load:</span> <span className="text-forge-text">{node.system.loadAvg.map(l => l.toFixed(2)).join(' ')}</span></div>
                  <div><span className="text-forge-text-dim">Uptime:</span> <span className="text-forge-text">{formatUptime(node.system.uptime)}</span></div>
                  {node.system.temperature && (
                    <div><span className="text-forge-text-dim">Temp:</span> <span className={`${node.system.temperature > 70 ? 'text-forge-red' : 'text-forge-text'}`}>{node.system.temperature.toFixed(1)}°C</span></div>
                  )}
                </div>

                {/* Capabilities */}
                <div className="flex gap-1.5 mb-3">
                  {node.hasGPS && <span className="px-1.5 py-0.5 rounded bg-forge-green/10 text-forge-green text-[9px] font-mono border border-forge-green/20">📍 GPS</span>}
                  {node.hasHailo && <span className="px-1.5 py-0.5 rounded bg-forge-amber/10 text-forge-amber text-[9px] font-mono border border-forge-amber/20">🧠 HAILO-8</span>}
                  {node.sdrDevices.length > 0 && <span className="px-1.5 py-0.5 rounded bg-forge-cyan/10 text-forge-cyan text-[9px] font-mono border border-forge-cyan/20">📡 SDR×{node.sdrDevices.length}</span>}
                </div>

                {/* SDR Devices */}
                {node.sdrDevices.length > 0 && (
                  <div className="space-y-1">
                    {node.sdrDevices.map(dev => (
                      <div key={dev.id} className="flex items-center gap-2 px-2 py-1 rounded bg-forge-bg text-[10px] font-mono">
                        <span className={`w-1.5 h-1.5 rounded-full ${dev.available ? 'bg-forge-green' : 'bg-forge-red'}`} />
                        <span className="text-forge-text">{dev.name}</span>
                        <span className="text-forge-text-dim">({dev.type})</span>
                        {dev.currentFrequency && <span className="text-forge-amber ml-auto">{(dev.currentFrequency / 1e6).toFixed(3)} MHz</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Location */}
                {node.location && (
                  <div className="mt-2 text-[10px] font-mono text-forge-text-dim">
                    📍 {node.location.latitude.toFixed(4)}°, {node.location.longitude.toFixed(4)}° ({node.location.source})
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
