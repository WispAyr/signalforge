import React, { useState, useEffect } from 'react';
import type { Integration, IntegrationType, IntegrationTestResult } from '@signalforge/shared';
import { INTEGRATION_DEFINITIONS } from '@signalforge/shared';

export const IntegrationsView: React.FC = () => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedId, setSelectedId] = useState<IntegrationType | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<IntegrationTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/integrations').then(r => r.json()).then(setIntegrations).catch(() => {});
  }, []);

  const selected = integrations.find(i => i.id === selectedId);
  const selectedDef = INTEGRATION_DEFINITIONS.find(d => d.id === selectedId);

  const configure = async () => {
    if (!selectedId) return;
    await fetch(`/api/integrations/${selectedId}/configure`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(configValues),
    });
    const res = await fetch('/api/integrations');
    setIntegrations(await res.json());
  };

  const testIntegration = async () => {
    if (!selectedId) return;
    setTesting(true);
    setTestResult(null);
    const res = await fetch(`/api/integrations/${selectedId}/test`, { method: 'POST' });
    setTestResult(await res.json());
    setTesting(false);
    const refresh = await fetch('/api/integrations');
    setIntegrations(await refresh.json());
  };

  const toggleEnabled = async (id: IntegrationType, enabled: boolean) => {
    await fetch(`/api/integrations/${id}/${enabled ? 'disable' : 'enable'}`, { method: 'POST' });
    const res = await fetch('/api/integrations');
    setIntegrations(await res.json());
  };

  const statusColors: Record<string, string> = {
    connected: 'text-green-400 bg-green-500/20',
    connecting: 'text-amber-400 bg-amber-500/20',
    error: 'text-red-400 bg-red-500/20',
    disconnected: 'text-gray-400 bg-gray-500/20',
  };

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">🔗 Integration Hub</span>
        <span className="text-xs font-mono text-gray-500">
          {integrations.filter(i => i.status === 'connected').length} / {integrations.length} connected
        </span>
      </div>

      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {/* Integration List */}
        <div className="w-72 flex-shrink-0 overflow-y-auto space-y-2">
          {integrations.map(integ => (
            <div key={integ.id} onClick={() => { setSelectedId(integ.id); setConfigValues(integ.config); setTestResult(null); }}
              className={`bg-forge-surface border rounded p-3 cursor-pointer transition-colors ${selectedId === integ.id ? 'border-cyan-500/50' : 'border-forge-border hover:border-cyan-500/20'}`}>
              <div className="flex items-center gap-2">
                <span className="text-lg">{integ.iconEmoji}</span>
                <div className="flex-1">
                  <div className="text-sm font-mono text-white">{integ.name}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{integ.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${statusColors[integ.status]}`}>
                  {integ.status}
                </span>
                <div className="flex-1" />
                <button onClick={(e) => { e.stopPropagation(); toggleEnabled(integ.id, integ.enabled); }}
                  className={`w-8 h-4 rounded-full transition-colors relative ${integ.enabled ? 'bg-cyan-500' : 'bg-gray-600'}`}>
                  <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${integ.enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Config Panel */}
        <div className="flex-1 overflow-y-auto">
          {selected && selectedDef ? (
            <div className="bg-forge-surface border border-forge-border rounded p-4">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{selected.iconEmoji}</span>
                <div>
                  <h2 className="text-lg font-mono text-white font-bold">{selected.name}</h2>
                  <p className="text-xs text-gray-400">{selected.description}</p>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                {selectedDef.configFields.map(field => (
                  <div key={field.key}>
                    <label className="text-xs text-gray-500 font-mono">{field.label} {field.required && '*'}</label>
                    <input type={field.type === 'password' ? 'password' : 'text'}
                      value={configValues[field.key] || ''}
                      onChange={e => setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1.5 text-sm text-white font-mono mt-1" />
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={configure}
                  className="px-4 py-2 rounded text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
                  💾 Save Config
                </button>
                <button onClick={testIntegration} disabled={testing}
                  className="px-4 py-2 rounded text-xs font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-50">
                  {testing ? '⏳ Testing...' : '🧪 Test Connection'}
                </button>
              </div>

              {testResult && (
                <div className={`mt-3 p-3 rounded text-xs font-mono ${testResult.success ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
                  {testResult.success ? '✓' : '✗'} {testResult.message}
                  {testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
              <div className="text-center">
                <div className="text-4xl mb-3">🔗</div>
                <div>Select an integration to configure</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
