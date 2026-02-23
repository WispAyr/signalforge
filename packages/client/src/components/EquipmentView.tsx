import React, { useState, useEffect } from 'react';
import type { SDRHardware, UserEquipment, CompatibilityEntry, ShoppingListItem, SDRHardwareType } from '@signalforge/shared';

export const EquipmentView: React.FC = () => {
  const [database, setDatabase] = useState<SDRHardware[]>([]);
  const [myEquipment, setMyEquipment] = useState<UserEquipment[]>([]);
  const [compatibility, setCompatibility] = useState<CompatibilityEntry[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [tab, setTab] = useState<'database' | 'mine' | 'compatibility' | 'shopping'>('database');
  const [selectedHw, setSelectedHw] = useState<SDRHardware | null>(null);
  const [addType, setAddType] = useState<SDRHardwareType>('rtlsdr');
  const [addNickname, setAddNickname] = useState('');
  const [shoppingCaps, setShoppingCaps] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/equipment/database').then(r => r.json()).then(setDatabase).catch(() => {});
    fetch('/api/equipment/mine').then(r => r.json()).then(setMyEquipment).catch(() => {});
    fetch('/api/equipment/compatibility').then(r => r.json()).then(setCompatibility).catch(() => {});
  }, []);

  const addEquipment = async () => {
    const res = await fetch('/api/equipment/mine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hardwareType: addType, nickname: addNickname }),
    });
    const eq = await res.json();
    setMyEquipment(prev => [...prev, eq]);
    setAddNickname('');
  };

  const removeEquipment = async (id: string) => {
    await fetch(`/api/equipment/mine/${id}`, { method: 'DELETE' });
    setMyEquipment(prev => prev.filter(e => e.id !== id));
  };

  const generateShoppingList = async () => {
    const res = await fetch('/api/equipment/shopping-list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: shoppingCaps }),
    });
    setShoppingList(await res.json());
  };

  const formatFreq = (hz: number) => hz >= 1e9 ? `${(hz / 1e9).toFixed(1)} GHz` : hz >= 1e6 ? `${(hz / 1e6).toFixed(0)} MHz` : `${(hz / 1e3).toFixed(0)} kHz`;

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">📡 Equipment Manager</span>
        <span className="text-xs font-mono text-gray-500">{myEquipment.length} registered devices</span>
        <div className="flex-1" />
        {(['database', 'mine', 'compatibility', 'shopping'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 rounded text-xs font-mono ${tab === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-500 border border-forge-border'}`}>
            {t === 'database' ? '📋 Database' : t === 'mine' ? '🔧 My Equipment' : t === 'compatibility' ? '✓ Compatibility' : '🛒 Shopping'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'database' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {database.map(hw => (
              <div key={hw.id} className={`bg-forge-surface border rounded p-4 cursor-pointer transition-colors ${selectedHw?.id === hw.id ? 'border-cyan-500/50' : 'border-forge-border hover:border-cyan-500/20'}`}
                onClick={() => setSelectedHw(hw)}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl">📡</div>
                  <div className="flex-1">
                    <h3 className="text-sm font-mono text-white font-bold">{hw.name}</h3>
                    <p className="text-xs text-gray-500">{hw.manufacturer}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs font-mono">
                      <div><span className="text-gray-500">Range:</span> <span className="text-cyan-400">{formatFreq(hw.frequencyRange[0])} - {formatFreq(hw.frequencyRange[1])}</span></div>
                      <div><span className="text-gray-500">BW:</span> <span className="text-cyan-400">{formatFreq(hw.maxBandwidthHz)}</span></div>
                      <div><span className="text-gray-500">ADC:</span> <span className="text-cyan-400">{hw.bitsADC}-bit</span></div>
                      <div><span className="text-gray-500">TX:</span> <span className={hw.txCapable ? 'text-green-400' : 'text-red-400'}>{hw.txCapable ? 'Yes' : 'No'}</span></div>
                      <div><span className="text-gray-500">Price:</span> <span className="text-amber-400">{hw.price}</span></div>
                      <div><span className="text-gray-500">Driver:</span> <span className="text-gray-400">{hw.driverRequired}</span></div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {hw.features.map(f => (
                        <span key={f} className="px-1 py-0.5 rounded text-[9px] font-mono bg-forge-bg text-gray-500 border border-forge-border">{f}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'mine' && (
          <div className="space-y-3">
            <div className="bg-forge-surface border border-forge-border rounded p-3 flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-mono">Hardware Type</label>
                <select value={addType} onChange={e => setAddType(e.target.value as SDRHardwareType)}
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono mt-1">
                  {database.map(hw => <option key={hw.id} value={hw.id}>{hw.name}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-mono">Nickname</label>
                <input type="text" value={addNickname} onChange={e => setAddNickname(e.target.value)} placeholder="My RTL-SDR..."
                  className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-sm text-white font-mono mt-1" />
              </div>
              <button onClick={addEquipment} className="px-4 py-1.5 rounded text-xs font-mono bg-green-500/20 text-green-400 border border-green-500/30">+ Add</button>
            </div>
            {myEquipment.length === 0 ? (
              <div className="text-center text-gray-500 font-mono text-sm py-8">No equipment registered — add your SDR hardware above</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {myEquipment.map(eq => {
                  const hw = database.find(d => d.id === eq.hardwareType);
                  return (
                    <div key={eq.id} className="bg-forge-surface border border-forge-border rounded p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">📡</span>
                        <div className="flex-1">
                          <div className="text-sm font-mono text-white">{eq.nickname || hw?.name || eq.hardwareType}</div>
                          <div className="text-xs text-gray-500 font-mono">{hw?.name} • Added {new Date(eq.addedAt).toLocaleDateString()}</div>
                        </div>
                        <button onClick={() => removeEquipment(eq.id)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'compatibility' && (
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-forge-surface">
              <tr className="text-gray-500 border-b border-forge-border">
                <th className="text-left py-2 px-3">Decoder</th>
                <th className="text-left py-2 px-3">Compatible Hardware</th>
                <th className="text-right py-2 px-3">Min BW</th>
                <th className="text-left py-2 px-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {compatibility.map(c => (
                <tr key={c.decoder} className="border-b border-forge-border/30 text-gray-300">
                  <td className="py-2 px-3 text-cyan-400 uppercase font-bold">{c.decoder}</td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-1">
                      {c.hardware.map(h => {
                        const owned = myEquipment.some(e => e.hardwareType === h);
                        return (
                          <span key={h} className={`px-1.5 py-0.5 rounded text-[10px] border ${owned ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-forge-bg text-gray-500 border-forge-border'}`}>
                            {h} {owned && '✓'}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right text-amber-400">{formatFreq(c.minBandwidthHz)}</td>
                  <td className="py-2 px-3 text-gray-500">{c.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'shopping' && (
          <div className="space-y-3">
            <div className="bg-forge-surface border border-forge-border rounded p-3">
              <div className="text-xs text-gray-400 font-mono mb-2">What do you want to do? Select capabilities:</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {['adsb', 'acars', 'ais', 'aprs', 'apt', 'dmr', 'lora', 'bluetooth', 'wifi', 'rtl433'].map(cap => (
                  <button key={cap} onClick={() => setShoppingCaps(prev => prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap])}
                    className={`px-2 py-1 rounded text-xs font-mono ${shoppingCaps.includes(cap) ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-500 border border-forge-border'}`}>
                    {cap.toUpperCase()}
                  </button>
                ))}
              </div>
              <button onClick={generateShoppingList} className="px-4 py-2 rounded text-xs font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">🛒 Generate Shopping List</button>
            </div>
            {shoppingList.length > 0 ? (
              <div className="space-y-2">
                {shoppingList.map((item, i) => (
                  <div key={i} className="bg-forge-surface border border-amber-500/30 rounded p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🛒</span>
                      <div className="flex-1">
                        <div className="text-sm font-mono text-white font-bold">{item.hardware.name}</div>
                        <div className="text-xs text-gray-400">{item.reason}</div>
                        <div className="text-xs text-amber-400 font-mono mt-1">Price: {item.hardware.price} • Needed for: {item.requiredFor.join(', ').toUpperCase()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : shoppingCaps.length > 0 ? (
              <div className="text-center text-green-400 font-mono text-sm py-4">✓ Your current equipment covers all selected capabilities!</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
