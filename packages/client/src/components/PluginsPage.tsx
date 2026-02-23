import React, { useState, useEffect } from 'react';
import type { PluginManifest, PluginStatus } from '@signalforge/shared';

export const PluginsPage: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/plugins').then(r => r.json()).then(p => { setPlugins(p); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const togglePlugin = async (id: string, enabled: boolean) => {
    await fetch(`/api/plugins/${id}/${enabled ? 'disable' : 'enable'}`, { method: 'POST' });
    setPlugins(prev => prev.map(p => p.id === id ? { ...p, enabled: !enabled } : p));
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider mb-1">⚡ PLUGIN DIRECTORY</h2>
        <p className="text-xs font-mono text-forge-text-dim mb-6">Extend SignalForge with custom decoders, sources, and display nodes</p>

        {loading ? (
          <div className="text-center text-forge-text-dim font-mono text-sm py-12">Loading plugins...</div>
        ) : (
          <div className="grid gap-4">
            {plugins.map(plugin => (
              <div key={plugin.id} className="panel-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{plugin.icon || '🔌'}</span>
                    <div>
                      <h3 className="font-mono text-sm text-forge-text font-medium">{plugin.name}</h3>
                      <p className="text-[10px] font-mono text-forge-text-dim">v{plugin.version} · by {plugin.author}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => togglePlugin(plugin.id, plugin.enabled)}
                    className={`px-3 py-1 rounded text-[10px] font-mono border transition-colors ${
                      plugin.enabled
                        ? 'bg-forge-green/20 border-forge-green/40 text-forge-green'
                        : 'bg-forge-panel border-forge-border text-forge-text-dim'
                    }`}
                  >
                    {plugin.enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>
                <p className="text-xs font-mono text-forge-text-dim mt-2">{plugin.description}</p>

                {/* Node list */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {plugin.nodes.map(node => (
                    <div key={node.type} className="flex items-center gap-1.5 px-2 py-1 rounded bg-forge-bg border border-forge-border text-[10px] font-mono">
                      <span>{node.icon}</span>
                      <span className="text-forge-text">{node.name}</span>
                      <span className="text-forge-text-dim">({node.category})</span>
                    </div>
                  ))}
                </div>

                {/* Ports info */}
                {plugin.nodes.map(node => (
                  <div key={node.type} className="mt-2 flex gap-3 text-[9px] font-mono text-forge-text-dim">
                    <span>Inputs: {node.inputs.map(i => `${i.name} [${i.type}]`).join(', ') || 'none'}</span>
                    <span>→</span>
                    <span>Outputs: {node.outputs.map(o => `${o.name} [${o.type}]`).join(', ') || 'none'}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Plugin API Info */}
        <div className="mt-8 panel-border rounded-lg p-4">
          <h3 className="text-xs font-mono text-forge-amber tracking-wider mb-2">📋 PLUGIN API</h3>
          <div className="text-[10px] font-mono text-forge-text-dim space-y-1">
            <p>Plugins extend SignalForge with custom signal processing nodes.</p>
            <p>Each plugin provides a manifest with node definitions, input/output ports, and parameters.</p>
            <p className="text-forge-cyan">POST /api/plugins — Register a new plugin</p>
            <p className="text-forge-cyan">GET /api/plugins/nodes — List all available plugin nodes</p>
          </div>
        </div>
      </div>
    </div>
  );
};
