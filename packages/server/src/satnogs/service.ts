import { EventEmitter } from 'events';
import type { SatNOGSObservation, SatNOGSTransmitter, SatNOGSStation, SatNOGSFlowgraphConfig } from '@signalforge/shared';

const SATNOGS_API = 'https://network.satnogs.org/api';
const SATNOGS_DB_API = 'https://db.satnogs.org/api';

export class SatNOGSService extends EventEmitter {
  private transmitterCache = new Map<number, SatNOGSTransmitter[]>();
  private observationCache: SatNOGSObservation[] = [];
  private stationCache: SatNOGSStation[] = [];
  private lastFetch = 0;

  async getObservations(params?: { satellite?: number; ground_station?: number; status?: string; limit?: number }): Promise<SatNOGSObservation[]> {
    try {
      const query = new URLSearchParams();
      if (params?.satellite) query.set('satellite__norad_cat_id', String(params.satellite));
      if (params?.ground_station) query.set('ground_station', String(params.ground_station));
      if (params?.status) query.set('vetted_status', params.status);
      query.set('format', 'json');

      const res = await fetch(`${SATNOGS_API}/observations/?${query}`, {
        headers: { 'User-Agent': 'SignalForge/0.6.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`SatNOGS API ${res.status}`);
      const data = await res.json();
      this.observationCache = data.slice(0, params?.limit || 50);
      return this.observationCache;
    } catch (err) {
      console.error('SatNOGS observations fetch failed:', err);
      return this.observationCache;
    }
  }

  async getTransmitters(noradId: number): Promise<SatNOGSTransmitter[]> {
    if (this.transmitterCache.has(noradId)) return this.transmitterCache.get(noradId)!;
    try {
      const res = await fetch(`${SATNOGS_DB_API}/transmitters/?format=json&satellite__norad_cat_id=${noradId}`, {
        headers: { 'User-Agent': 'SignalForge/0.6.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`SatNOGS DB API ${res.status}`);
      const data = await res.json();
      this.transmitterCache.set(noradId, data);
      return data;
    } catch (err) {
      console.error('SatNOGS transmitters fetch failed:', err);
      return [];
    }
  }

  async getStations(): Promise<SatNOGSStation[]> {
    if (this.stationCache.length > 0 && Date.now() - this.lastFetch < 300000) return this.stationCache;
    try {
      const res = await fetch(`${SATNOGS_API}/stations/?format=json&status=2`, {
        headers: { 'User-Agent': 'SignalForge/0.6.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`SatNOGS API ${res.status}`);
      this.stationCache = await res.json();
      this.lastFetch = Date.now();
      return this.stationCache;
    } catch (err) {
      console.error('SatNOGS stations fetch failed:', err);
      return this.stationCache;
    }
  }

  // Stub for future observation submission
  async submitObservation(_params: { noradId: number; transmitterUuid: string; start: string; end: string; stationId: number }): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Observation submission not yet implemented — requires SatNOGS API token' };
  }

  async autoConfigureFlowgraph(noradId: number, satelliteName: string): Promise<SatNOGSFlowgraphConfig | null> {
    const transmitters = await this.getTransmitters(noradId);
    if (transmitters.length === 0) return null;

    const active = transmitters.filter(t => t.alive && t.status === 'active');
    const best = active[0] || transmitters[0];

    const freq = best.downlink_low || best.uplink_low || 0;
    const mode = best.mode || 'FM';
    const bw = best.downlink_high && best.downlink_low
      ? best.downlink_high - best.downlink_low
      : mode === 'FM' ? 25000 : mode === 'CW' ? 500 : 6000;

    return {
      satelliteName,
      noradId,
      transmitters: active.length > 0 ? active : transmitters,
      selectedTransmitter: best.uuid,
      flowgraphPreset: mode.includes('FM') ? 'fm-receiver' : mode.includes('CW') ? 'cw-decoder' : 'satellite-monitor',
      frequency: freq,
      mode,
      bandwidth: bw,
      baud: best.baud || undefined,
    };
  }
}
