import { EventEmitter } from 'events';
import type { SolarData, BandCondition, PropagationPrediction, GreylineData } from '@signalforge/shared';

const NOAA_SOLAR_API = 'https://services.swpc.noaa.gov/json';

export class PropagationService extends EventEmitter {
  private solarData: SolarData | null = null;
  private bandConditions: BandCondition[] = [];
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  async start() {
    await this.fetchSolarData();
    this.updateBandConditions();
    // Refresh every 15 minutes
    this.updateInterval = setInterval(async () => {
      await this.fetchSolarData();
      this.updateBandConditions();
    }, 900000);
  }

  stop() {
    if (this.updateInterval) clearInterval(this.updateInterval);
  }

  async fetchSolarData(): Promise<SolarData> {
    try {
      // Fetch current conditions from NOAA
      const [fluxRes, kpRes] = await Promise.allSettled([
        fetch(`${NOAA_SOLAR_API}/f107_cm_flux.json`, { signal: AbortSignal.timeout(8000) }),
        fetch(`${NOAA_SOLAR_API}/planetary_k_index_1m.json`, { signal: AbortSignal.timeout(8000) }),
      ]);

      let sfi = 150;
      let kp = 2;

      if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
        const data = await fluxRes.value.json();
        if (Array.isArray(data) && data.length > 1) {
          const latest = data[data.length - 1];
          sfi = parseFloat(latest.flux || latest.adjusted_flux || '150');
        }
      }

      if (kpRes.status === 'fulfilled' && kpRes.value.ok) {
        const data = await kpRes.value.json();
        if (Array.isArray(data) && data.length > 1) {
          const latest = data[data.length - 1];
          kp = parseFloat(latest.kp_index || latest.Kp || '2');
        }
      }

      // Calculate A-index from K
      const aIndex = Math.round(kp * 8);
      const geoField = kp < 2 ? 'quiet' : kp < 4 ? 'unsettled' : kp < 6 ? 'active' : kp < 8 ? 'storm' : 'major_storm';

      this.solarData = {
        solarFlux: sfi,
        aIndex,
        kIndex: kp,
        sunspotNumber: Math.round((sfi - 64) / 0.88), // rough approx
        geomagField: geoField as SolarData['geomagField'],
        updatedAt: Date.now(),
        source: 'NOAA/SWPC',
      };

      this.emit('solar_update', this.solarData);
      return this.solarData;
    } catch (err) {
      console.error('Solar data fetch failed:', err);
      // Return cached or demo data
      if (!this.solarData) {
        this.solarData = {
          solarFlux: 155, aIndex: 8, kIndex: 2, sunspotNumber: 103,
          geomagField: 'quiet', updatedAt: Date.now(), source: 'demo',
        };
      }
      return this.solarData;
    }
  }

  getSolarData(): SolarData | null {
    return this.solarData;
  }

  updateBandConditions() {
    const sfi = this.solarData?.solarFlux || 150;
    const kp = this.solarData?.kIndex || 2;
    const hour = new Date().getUTCHours();
    const isDay = hour >= 6 && hour <= 18;

    const bands = [
      { band: '160m', freq: '1.8-2.0 MHz', mufThreshold: 30 },
      { band: '80m', freq: '3.5-4.0 MHz', mufThreshold: 50 },
      { band: '40m', freq: '7.0-7.3 MHz', mufThreshold: 80 },
      { band: '30m', freq: '10.1-10.15 MHz', mufThreshold: 100 },
      { band: '20m', freq: '14.0-14.35 MHz', mufThreshold: 120 },
      { band: '17m', freq: '18.068-18.168 MHz', mufThreshold: 140 },
      { band: '15m', freq: '21.0-21.45 MHz', mufThreshold: 160 },
      { band: '12m', freq: '24.89-24.99 MHz', mufThreshold: 180 },
      { band: '10m', freq: '28.0-29.7 MHz', mufThreshold: 200 },
      { band: '6m', freq: '50.0-54.0 MHz', mufThreshold: 250 },
    ];

    // Approximate MUF from SFI
    const approxMuf = sfi * 0.18 + 5; // rough MHz

    this.bandConditions = bands.map(b => {
      const freqMid = b.mufThreshold / 10;
      const dayOpen = approxMuf > freqMid;
      const nightOpen = freqMid < 10; // lower bands better at night

      const dayStatus = dayOpen ? (kp < 3 ? 'open' : kp < 5 ? 'fair' : 'poor') : 'closed';
      const nightStatus = nightOpen ? (kp < 3 ? 'open' : kp < 5 ? 'fair' : 'poor') : (freqMid < 20 ? 'fair' : 'closed');

      return {
        band: b.band,
        frequency: b.freq,
        dayCondition: dayStatus as BandCondition['dayCondition'],
        nightCondition: nightStatus as BandCondition['nightCondition'],
        muf: approxMuf,
      };
    });

    this.emit('band_update', this.bandConditions);
  }

  getBandConditions(): BandCondition[] {
    return this.bandConditions;
  }

  predict(fromGrid: string, toGrid: string): PropagationPrediction {
    const fromPos = this.gridToLatLng(fromGrid);
    const toPos = this.gridToLatLng(toGrid);
    const distance = this.haversine(fromPos.lat, fromPos.lng, toPos.lat, toPos.lng);
    const bearing = this.calcBearing(fromPos.lat, fromPos.lng, toPos.lat, toPos.lng);

    // Simple MUF estimation based on distance and SFI
    const sfi = this.solarData?.solarFlux || 150;
    const muf = Math.max(5, sfi * 0.15 + distance / 500);
    const luf = Math.max(2, muf * 0.3);
    const fot = muf * 0.85;

    return {
      fromGrid, toGrid, distance, bearing,
      bands: this.bandConditions,
      muf, luf, fot,
      timestamp: Date.now(),
    };
  }

  getGreyline(): GreylineData {
    const now = new Date();
    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
    const declination = -23.44 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));

    const hourAngle = (now.getUTCHours() + now.getUTCMinutes() / 60) * 15 - 180;
    const subsolarLat = declination;
    const subsolarLng = -hourAngle;

    // Generate terminator points
    const points: { lat: number; lng: number }[] = [];
    for (let lng = -180; lng <= 180; lng += 2) {
      const lat = Math.atan(-Math.cos((lng + hourAngle) * Math.PI / 180) / Math.tan(declination * Math.PI / 180)) * 180 / Math.PI;
      points.push({ lat, lng });
    }

    return {
      solarDeclination: declination,
      subsolarLat,
      subsolarLng,
      terminatorPoints: points,
      timestamp: Date.now(),
    };
  }

  private gridToLatLng(grid: string): { lat: number; lng: number } {
    if (grid.length < 4) return { lat: 51.5, lng: -0.1 };
    const lng = (grid.charCodeAt(0) - 65) * 20 + parseInt(grid[2]) * 2 - 180 + 1;
    const lat = (grid.charCodeAt(1) - 65) * 10 + parseInt(grid[3]) - 90 + 0.5;
    return { lat, lng };
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private calcBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }
}
