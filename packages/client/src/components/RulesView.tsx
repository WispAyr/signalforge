import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Rule, RuleEvent } from '@signalforge/shared';

const API = '/api';

const SOURCE_ICONS: Record<string, string> = {
  aprs: '📍', adsb: '✈️', ais: '🚢', acars: '📡', rtl433: '🌡️',
  weather: '🌦️', satellite: '🛰️', meshtastic: '📡', any: '⭐',
};

const CONDITION_LABELS: Record<string, string> = {
  geofence_enter: '🔲 Geofence Enter', geofence_exit: '🔲 Geofence Exit',
  callsign_match: '🔤 Callsign', squawk_match: '🚨 Squawk',
  speed_above: '⚡ Speed >', speed_below: '⚡ Speed <',
  altitude_above: '📏 Alt >', altitude_below: '📏 Alt <',
  temp_above: '🌡️ Temp >', temp_below: '🌡️ Temp <',
  pressure_below: '🌀 Pressure <', wind_above: '💨 Wind >',
  new_entity: '✨ New Entity', entity_lost: '👻 Entity Lost',
  rate_of_change: '📈 Rate of Change', keyword_match: '🔍 Keyword',
  emergency: '🆘 Emergency', custom_js: '📜 Custom JS',
};

const ACTION_ICONS: Record<string, string> = {
  webhook: '🌐', mqtt: '📤', telegram: '✈️', log: '📝',
  sound: '🔔', highlight_map: '🗺️', tts: '🗣️', record_signal: '⏺️',
  tag_entity: '🏷️', chain_rule: '🔗',
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Stats {
  total: number; active: number; disabled: number;
  triggersLastHour: number; triggers24h: number; mostActive: string | null;
}

export function RulesView() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<RuleEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [showEventFeed, setShowEventFeed] = useState(true);
  const [testResult, setTestResult] = useState<{ matched: boolean; conditions: { type: string; matched: boolean }[] } | null>(null);
  const eventsRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [r, e, s] = await Promise.all([
        fetch(`${API}/rules`).then(r => r.json()),
        fetch(`${API}/rules/events?limit=50`).then(r => r.json()),
        fetch(`${API}/rules/stats`).then(r => r.json()),
      ]);
      setRules(r);
      setEvents(e);
      setStats(s);
    } catch {}
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // WebSocket for live events
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'rule_triggered') {
          setEvents(prev => [{
            id: `live-${Date.now()}`,
            ruleId: msg.ruleId,
            ruleName: msg.ruleName,
            timestamp: msg.timestamp,
            source: msg.source,
            entity: msg.entity,
            matchedConditions: msg.conditions || [],
            actionsExecuted: msg.actions || [],
            data: {},
          }, ...prev].slice(0, 100));
          // Refresh stats
          fetch(`${API}/rules/stats`).then(r => r.json()).then(setStats).catch(() => {});
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const toggleRule = useCallback(async (id: string, enabled: boolean) => {
    await fetch(`${API}/rules/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' });
    fetchAll();
  }, [fetchAll]);

  const deleteRule = useCallback(async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    await fetch(`${API}/rules/${id}`, { method: 'DELETE' });
    if (selectedRule === id) setSelectedRule(null);
    fetchAll();
  }, [fetchAll, selectedRule]);

  const saveRule = useCallback(async () => {
    if (!editing) return;
    try {
      if (editing.id) {
        await fetch(`${API}/rules/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing),
        });
      } else {
        await fetch(`${API}/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editing.name || 'New Rule',
            description: editing.description || '',
            enabled: editing.enabled ?? false,
            source: editing.source || { type: 'any' },
            conditions: editing.conditions || [],
            conditionLogic: editing.conditionLogic || 'AND',
            actions: editing.actions || [],
            cooldownMs: editing.cooldownMs ?? 60000,
            triggerCount: 0,
          }),
        });
      }
      setEditing(null);
      fetchAll();
    } catch {}
  }, [editing, fetchAll]);

  const testRule = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/rules/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      setTestResult(await res.json());
    } catch {}
  }, []);

  const rule = rules.find(r => r.id === selectedRule);

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0a0f' }}>
      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[#1a1a2e]" style={{ background: '#0e0e1a' }}>
        <span className="text-amber-400 text-sm font-bold">⚡ Rules Engine</span>
        {stats && (
          <>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-green-400">{stats.active}</span>
              <span className="text-gray-600">active</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-500">{stats.disabled}</span>
              <span className="text-gray-600">disabled</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-amber-400">{stats.triggersLastHour}</span>
              <span className="text-gray-600">/ hr</span>
              <span className="text-gray-600">·</span>
              <span className="text-amber-400">{stats.triggers24h}</span>
              <span className="text-gray-600">/ 24h</span>
            </div>
            {stats.mostActive && (
              <div className="text-xs text-gray-500">🏆 {stats.mostActive}</div>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEditing({ name: '', source: { type: 'any' }, conditions: [], conditionLogic: 'AND', actions: [], cooldownMs: 60000, enabled: false })}
            className="bg-amber-600/20 border border-amber-600/40 text-amber-400 hover:bg-amber-600/30 px-3 py-1 rounded text-xs font-medium"
          >
            + New Rule
          </button>
          <button
            onClick={() => setShowEventFeed(!showEventFeed)}
            className={`px-2 py-1 rounded text-xs ${showEventFeed ? 'text-amber-400 bg-amber-400/10' : 'text-gray-500'}`}
          >
            📜 Feed
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Rules list */}
        <div className="w-[380px] flex-shrink-0 border-r border-[#1a1a2e] overflow-y-auto custom-scrollbar">
          {rules.length === 0 && (
            <div className="p-8 text-center text-gray-600 text-sm">
              <div className="text-3xl mb-2">⚡</div>
              No rules yet. Create one to get started.
            </div>
          )}
          {rules.map(r => {
            const isActive = selectedRule === r.id;
            const isCooling = r.lastTriggered && r.cooldownMs > 0 && (Date.now() - r.lastTriggered) < r.cooldownMs;
            return (
              <div
                key={r.id}
                onClick={() => { setSelectedRule(r.id); setEditing(null); setTestResult(null); }}
                className={`p-3 border-b border-[#1a1a2e] cursor-pointer transition-colors ${
                  isActive ? 'bg-[#1a1a2e]' : 'hover:bg-[#12121f]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: r.enabled ? (isCooling ? '#ffab00' : '#00e676') : '#444' }}
                    title={r.enabled ? (isCooling ? 'Cooldown' : 'Active') : 'Disabled'}
                  />
                  <span className="text-sm text-gray-200 font-medium truncate">{r.name}</span>
                  <span className="ml-auto text-xs text-gray-600">{SOURCE_ICONS[r.source.type] || '⭐'}</span>
                </div>
                {r.description && (
                  <div className="text-xs text-gray-500 mb-1 truncate pl-4">{r.description}</div>
                )}
                <div className="flex items-center gap-3 pl-4 text-[10px] text-gray-600">
                  <span>{r.conditions.length} condition{r.conditions.length !== 1 ? 's' : ''}</span>
                  <span>{r.actions.length} action{r.actions.length !== 1 ? 's' : ''}</span>
                  <span className="text-amber-400/60">{r.triggerCount}× triggered</span>
                  {r.lastTriggered && <span>{timeAgo(r.lastTriggered)}</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleRule(r.id, !r.enabled); }}
                    className={`ml-auto px-1.5 py-0.5 rounded text-[10px] ${r.enabled ? 'bg-green-600/20 text-green-400' : 'bg-gray-700/20 text-gray-500'}`}
                  >
                    {r.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right panel — detail or event feed */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {editing ? (
            // Rule editor
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className="max-w-xl space-y-4">
                <h3 className="text-sm font-bold text-amber-400">{editing.id ? 'Edit Rule' : 'New Rule'}</h3>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Name</label>
                  <input
                    className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-3 py-2 text-sm text-gray-200 focus:border-amber-500 outline-none"
                    value={editing.name || ''}
                    onChange={e => setEditing(prev => prev ? { ...prev, name: e.target.value } : null)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Description</label>
                  <input
                    className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-3 py-2 text-sm text-gray-200 focus:border-amber-500 outline-none"
                    value={editing.description || ''}
                    onChange={e => setEditing(prev => prev ? { ...prev, description: e.target.value } : null)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Source</label>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(SOURCE_ICONS).map(([type, icon]) => (
                      <button
                        key={type}
                        onClick={() => setEditing(prev => prev ? { ...prev, source: { type } as any } : null)}
                        className={`px-2 py-1 rounded text-xs border ${
                          (editing.source as any)?.type === type
                            ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                            : 'border-[#2a2a4a] text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {icon} {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Conditions
                    <button
                      onClick={() => setEditing(prev => prev ? { ...prev, conditionLogic: prev.conditionLogic === 'AND' ? 'OR' : 'AND' } : null)}
                      className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[#141428] border border-[#2a2a4a] text-amber-400"
                    >
                      {editing.conditionLogic || 'AND'}
                    </button>
                  </label>
                  <div className="space-y-1">
                    {(editing.conditions || []).map((c, i) => (
                      <div key={i} className="flex items-center gap-1 bg-[#141428] rounded px-2 py-1 border border-[#2a2a4a]">
                        <span className="text-xs text-gray-300">{CONDITION_LABELS[c.type] || c.type}</span>
                        {'threshold' in c && <span className="text-xs text-amber-400 font-mono ml-1">{(c as any).threshold}</span>}
                        {'pattern' in c && <span className="text-xs text-amber-400 font-mono ml-1">{(c as any).pattern}</span>}
                        {'codes' in c && <span className="text-xs text-amber-400 font-mono ml-1">{(c as any).codes?.join(',')}</span>}
                        <button
                          onClick={() => setEditing(prev => {
                            if (!prev) return null;
                            const conds = [...(prev.conditions || [])];
                            conds.splice(i, 1);
                            return { ...prev, conditions: conds };
                          })}
                          className="ml-auto text-red-400/60 hover:text-red-400 text-xs"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                  <select
                    className="mt-1 w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-400 focus:border-amber-500 outline-none"
                    value=""
                    onChange={e => {
                      const type = e.target.value;
                      if (!type) return;
                      const base: any = { type };
                      if (type.includes('above') || type.includes('below')) base.threshold = 0;
                      if (type === 'callsign_match') base.pattern = '.*';
                      if (type === 'squawk_match') base.codes = ['7700'];
                      if (type === 'entity_lost') base.timeoutMs = 300000;
                      if (type === 'rate_of_change') { base.field = 'altitude'; base.threshold = 1000; base.direction = 'falling'; }
                      if (type === 'keyword_match') { base.field = 'comment'; base.pattern = ''; }
                      if (type === 'custom_js') base.expression = 'data.speed > 100';
                      if (type === 'geofence_enter' || type === 'geofence_exit') base.zoneId = '';
                      setEditing(prev => prev ? { ...prev, conditions: [...(prev.conditions || []), base] } : null);
                    }}
                  >
                    <option value="">+ Add condition...</option>
                    {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Actions</label>
                  <div className="space-y-1">
                    {(editing.actions || []).map((a, i) => (
                      <div key={i} className="flex items-center gap-1 bg-[#141428] rounded px-2 py-1 border border-[#2a2a4a]">
                        <span className="text-xs">{ACTION_ICONS[a.type] || '⚡'}</span>
                        <span className="text-xs text-gray-300">{a.type}</span>
                        {'url' in a && <span className="text-xs text-amber-400/60 font-mono ml-1 truncate">{(a as any).url}</span>}
                        {'message' in a && <span className="text-xs text-amber-400/60 font-mono ml-1 truncate">{(a as any).message}</span>}
                        <button
                          onClick={() => setEditing(prev => {
                            if (!prev) return null;
                            const acts = [...(prev.actions || [])];
                            acts.splice(i, 1);
                            return { ...prev, actions: acts };
                          })}
                          className="ml-auto text-red-400/60 hover:text-red-400 text-xs"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                  <select
                    className="mt-1 w-full bg-[#141428] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-gray-400 focus:border-amber-500 outline-none"
                    value=""
                    onChange={e => {
                      const type = e.target.value;
                      if (!type) return;
                      const base: any = { type };
                      if (type === 'webhook') { base.url = ''; base.method = 'POST'; }
                      if (type === 'mqtt') { base.topic = 'signalforge/alerts'; }
                      if (type === 'telegram') { base.chatId = ''; base.message = '⚡ {{entity}} triggered {{ruleName}}'; }
                      if (type === 'log') base.level = 'info';
                      if (type === 'sound') base.sound = 'alert';
                      if (type === 'highlight_map') base.duration = 10000;
                      if (type === 'tts') base.message = 'Alert: {{entity}} detected';
                      if (type === 'record_signal') base.durationMs = 30000;
                      if (type === 'tag_entity') base.tags = [];
                      if (type === 'chain_rule') base.ruleId = '';
                      setEditing(prev => prev ? { ...prev, actions: [...(prev.actions || []), base] } : null);
                    }}
                  >
                    <option value="">+ Add action...</option>
                    {Object.keys(ACTION_ICONS).map(k => (
                      <option key={k} value={k}>{ACTION_ICONS[k]} {k}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Cooldown (ms)</label>
                  <input
                    type="number"
                    className="w-32 bg-[#141428] border border-[#2a2a4a] rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 outline-none"
                    value={editing.cooldownMs ?? 60000}
                    onChange={e => setEditing(prev => prev ? { ...prev, cooldownMs: parseInt(e.target.value) || 0 } : null)}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveRule}
                    className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded text-xs font-medium"
                  >
                    💾 Save Rule
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="bg-[#141428] border border-[#2a2a4a] text-gray-400 hover:text-gray-200 px-4 py-1.5 rounded text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : rule ? (
            // Rule detail
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className="max-w-xl">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">{SOURCE_ICONS[rule.source.type]}</span>
                  <h3 className="text-lg font-bold text-gray-200">{rule.name}</h3>
                  <span className={`ml-2 px-2 py-0.5 rounded text-[10px] ${rule.enabled ? 'bg-green-600/20 text-green-400' : 'bg-gray-700/20 text-gray-500'}`}>
                    {rule.enabled ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>
                {rule.description && <p className="text-sm text-gray-400 mb-4">{rule.description}</p>}

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-[#141428] rounded p-3 border border-[#2a2a4a]">
                    <div className="text-[10px] text-gray-600 mb-1">TRIGGER COUNT</div>
                    <div className="text-2xl font-bold text-amber-400">{rule.triggerCount}</div>
                  </div>
                  <div className="bg-[#141428] rounded p-3 border border-[#2a2a4a]">
                    <div className="text-[10px] text-gray-600 mb-1">LAST TRIGGERED</div>
                    <div className="text-sm text-gray-300">{rule.lastTriggered ? timeAgo(rule.lastTriggered) : 'Never'}</div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-1">Conditions ({rule.conditionLogic})</div>
                  <div className="flex flex-wrap gap-1">
                    {rule.conditions.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs">
                        {CONDITION_LABELS[c.type] || c.type}
                        {'threshold' in c && <span className="ml-1 font-mono">{(c as any).threshold}</span>}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-1">Actions</div>
                  <div className="flex flex-wrap gap-1">
                    {rule.actions.map((a, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs">
                        {ACTION_ICONS[a.type] || '⚡'} {a.type}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-gray-600 mb-4">
                  Cooldown: {rule.cooldownMs}ms · Source: {rule.source.type} · Created: {new Date(rule.createdAt).toLocaleDateString()}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing({ ...rule })}
                    className="bg-[#141428] border border-[#2a2a4a] text-gray-300 hover:text-amber-400 px-3 py-1 rounded text-xs"
                  >✏️ Edit</button>
                  <button
                    onClick={() => testRule(rule.id)}
                    className="bg-[#141428] border border-[#2a2a4a] text-gray-300 hover:text-green-400 px-3 py-1 rounded text-xs"
                  >🧪 Test</button>
                  <button
                    onClick={() => toggleRule(rule.id, !rule.enabled)}
                    className="bg-[#141428] border border-[#2a2a4a] text-gray-300 hover:text-amber-400 px-3 py-1 rounded text-xs"
                  >{rule.enabled ? '⏸️ Disable' : '▶️ Enable'}</button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="bg-[#141428] border border-red-500/30 text-red-400/60 hover:text-red-400 px-3 py-1 rounded text-xs"
                  >🗑️ Delete</button>
                </div>

                {testResult && (
                  <div className={`mt-4 p-3 rounded border ${testResult.matched ? 'bg-green-900/20 border-green-600/30' : 'bg-red-900/20 border-red-600/30'}`}>
                    <div className="text-xs font-bold mb-1" style={{ color: testResult.matched ? '#00e676' : '#ff5252' }}>
                      {testResult.matched ? '✅ Rule would trigger' : '❌ Rule would NOT trigger'}
                    </div>
                    <div className="space-y-0.5">
                      {testResult.conditions.map((c, i) => (
                        <div key={i} className="text-xs">
                          <span style={{ color: c.matched ? '#00e676' : '#ff5252' }}>{c.matched ? '✓' : '✕'}</span>
                          <span className="text-gray-400 ml-1">{CONDITION_LABELS[c.type] || c.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Events for this rule */}
                <div className="mt-6">
                  <div className="text-xs text-gray-500 mb-2">Recent Events</div>
                  {events.filter(e => e.ruleId === rule.id).slice(0, 10).map(ev => (
                    <div key={ev.id} className="flex items-center gap-2 py-1 border-b border-[#1a1a2e] text-xs">
                      <span className="text-gray-600 font-mono w-16">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                      <span className="text-amber-400 font-mono">{ev.entity}</span>
                      <span className="text-gray-500">{ev.source}</span>
                      <div className="flex gap-0.5 ml-auto">
                        {ev.actionsExecuted.map((a, i) => (
                          <span key={i} className="text-blue-400/60">{ACTION_ICONS[a.split(':')[0]] || '⚡'}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              Select a rule or create a new one
            </div>
          )}

          {/* Live event feed */}
          {showEventFeed && (
            <div className="h-48 border-t border-[#1a1a2e] overflow-y-auto custom-scrollbar" ref={eventsRef} style={{ background: '#0a0a0f' }}>
              <div className="sticky top-0 bg-[#0e0e1a] px-3 py-1 border-b border-[#1a1a2e] z-10">
                <span className="text-[10px] text-amber-400/60 font-bold tracking-wider">LIVE EVENT FEED</span>
              </div>
              {events.length === 0 ? (
                <div className="p-4 text-center text-gray-600 text-xs">No events yet. Enable some rules!</div>
              ) : events.map(ev => (
                <div key={ev.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-[#0e0e1a] hover:bg-[#0e0e1a] text-xs">
                  <span className="text-gray-600 font-mono text-[10px] w-14 flex-shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[10px] truncate max-w-[120px]">
                    {ev.ruleName}
                  </span>
                  <span className="text-gray-400 font-mono">{ev.entity}</span>
                  <span className="text-gray-600">{ev.source}</span>
                  <div className="flex gap-0.5 ml-auto flex-shrink-0">
                    {ev.matchedConditions.map((c, i) => (
                      <span key={i} className="px-1 py-0.5 rounded bg-orange-500/10 text-orange-400/60 text-[9px]">{c}</span>
                    ))}
                  </div>
                  <div className="flex gap-0.5 flex-shrink-0">
                    {ev.actionsExecuted.map((a, i) => (
                      <span key={i} className="text-blue-400/60">{ACTION_ICONS[a.split(':')[0]] || '⚡'}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
