import React, { useState, useEffect } from 'react';
import type { SSTVImage, SSTVStatus } from '@signalforge/shared';

export const SSTVView: React.FC = () => {
  const [gallery, setGallery] = useState<SSTVImage[]>([]);
  const [status, setStatus] = useState<SSTVStatus | null>(null);
  const [selected, setSelected] = useState<SSTVImage | null>(null);

  const fetchData = async () => {
    try {
      const [gRes, sRes] = await Promise.all([fetch('/api/sstv/gallery?limit=50'), fetch('/api/sstv/status')]);
      setGallery(await gRes.json());
      setStatus(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'sstv_image') setGallery(prev => [msg.image, ...prev].slice(0, 100));
      } catch {}
    };
    return () => ws.close();
  }, []);

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-display font-bold text-forge-cyan tracking-wider">📺 SSTV DECODER</h2>
        {status && (
          <div className="flex gap-3 text-xs font-mono text-forge-text-dim">
            <span className={status.active ? 'text-green-400' : 'text-red-400'}>{status.active ? '● ACTIVE' : '○ OFFLINE'}</span>
            {status.receiving && <span className="text-forge-amber animate-pulse">◉ RECEIVING {status.currentMode}</span>}
            <span>{status.imagesDecoded} images decoded</span>
          </div>
        )}
      </div>

      <div className="flex gap-3 mb-3 text-[10px] font-mono">
        {['ISS 145.800', '80m 3.730', '40m 7.171', '20m 14.230', '15m 21.340'].map(band => (
          <span key={band} className="px-2 py-1 rounded bg-forge-panel border border-forge-border text-forge-text-dim">{band} MHz</span>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {selected ? (
          <div className="flex flex-col items-center">
            <button onClick={() => setSelected(null)} className="self-start mb-3 text-xs text-forge-cyan hover:underline">← Back to gallery</button>
            <div className="bg-forge-panel rounded-lg border border-forge-border p-6 max-w-2xl w-full">
              <div className="aspect-[4/3] bg-forge-bg rounded flex items-center justify-center mb-4">
                {selected.imageBase64 ? (
                  <img src={`data:image/png;base64,${selected.imageBase64}`} alt="SSTV" className="max-w-full max-h-full" />
                ) : (
                  <div className="text-forge-text-dim text-sm">
                    <div className="text-4xl mb-2">📺</div>
                    <div>{selected.mode} — {selected.width}×{selected.height}</div>
                    <div className="text-[10px] mt-1">Image data not stored in demo mode</div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div><span className="text-forge-text-dim">Mode:</span> <span className="text-forge-cyan">{selected.mode}</span></div>
                <div><span className="text-forge-text-dim">Freq:</span> <span className="text-forge-amber">{(selected.frequency / 1e6).toFixed(3)} MHz</span></div>
                <div><span className="text-forge-text-dim">Size:</span> {selected.width}×{selected.height}</div>
                <div><span className="text-forge-text-dim">SNR:</span> {selected.snr?.toFixed(1) || '?'} dB</div>
                <div><span className="text-forge-text-dim">Source:</span> {selected.source}</div>
                <div><span className="text-forge-text-dim">Time:</span> {new Date(selected.timestamp).toLocaleString()}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {gallery.map(img => (
              <div key={img.id} onClick={() => setSelected(img)}
                className="bg-forge-panel rounded-lg border border-forge-border p-3 cursor-pointer hover:border-forge-cyan/30 transition-colors">
                <div className="aspect-[4/3] bg-forge-bg rounded flex items-center justify-center mb-2">
                  <span className="text-3xl">📺</span>
                </div>
                <div className="text-xs font-mono">
                  <div className="text-forge-cyan">{img.mode}</div>
                  <div className="text-forge-text-dim">{img.source}</div>
                  <div className="text-forge-text-dim">{new Date(img.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
            {gallery.length === 0 && <div className="col-span-full text-center py-10 text-forge-text-dim text-sm">No SSTV images received yet.</div>}
          </div>
        )}
      </div>
    </div>
  );
};
