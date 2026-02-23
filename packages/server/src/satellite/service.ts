import * as satellite from 'satellite.js';
import type { TLE, SatellitePosition, GroundStation, SatellitePass, TLESource } from '@signalforge/shared';
import { DEFAULT_TLE_SOURCES } from '@signalforge/shared';

interface StoredSatellite {
  tle: TLE;
  satrec: satellite.SatRec;
}

export class SatelliteService {
  private satellites: Map<number, StoredSatellite> = new Map();
  private loaded = false;

  async loadTLEs(source?: TLESource): Promise<number> {
    const url = source?.url || DEFAULT_TLE_SOURCES[0].url;
    try {
      const response = await fetch(url);
      const text = await response.text();
      const lines = text.trim().split('\n');

      let count = 0;
      for (let i = 0; i < lines.length - 2; i += 3) {
        const name = lines[i].trim();
        const line1 = lines[i + 1].trim();
        const line2 = lines[i + 2].trim();

        if (!line1.startsWith('1') || !line2.startsWith('2')) continue;

        try {
          const satrec = satellite.twoline2satrec(line1, line2);
          const catalogNumber = parseInt(line1.substring(2, 7));
          this.satellites.set(catalogNumber, {
            tle: { name, line1, line2, catalogNumber, epoch: new Date().toISOString() },
            satrec,
          });
          count++;
        } catch {
          // Skip invalid TLEs
        }
      }

      this.loaded = true;
      console.log(`🛰️  Loaded ${count} satellites from ${source?.name || 'default'}`);
      return count;
    } catch (err) {
      console.error(`Failed to load TLEs: ${err}`);
      return 0;
    }
  }

  async getSatellites(): Promise<TLE[]> {
    if (!this.loaded) await this.loadTLEs();
    return Array.from(this.satellites.values()).map((s) => s.tle);
  }

  getPosition(catalogNumber: number, time?: Date): SatellitePosition | null {
    const sat = this.satellites.get(catalogNumber);
    if (!sat) return null;

    const now = time || new Date();
    const positionAndVelocity = satellite.propagate(sat.satrec, now);

    if (typeof positionAndVelocity.position === 'boolean') return null;
    const posEci = positionAndVelocity.position;

    const gmst = satellite.gstime(now);
    const posGd = satellite.eciToGeodetic(posEci, gmst);

    return {
      latitude: satellite.degreesLat(posGd.latitude),
      longitude: satellite.degreesLong(posGd.longitude),
      altitude: posGd.height,
      velocity: 0, // simplified
      azimuth: 0,
      elevation: 0,
      range: 0,
      timestamp: now.getTime(),
    };
  }

  async predictPasses(observer: GroundStation, hours: number = 24): Promise<SatellitePass[]> {
    if (!this.loaded) await this.loadTLEs();

    const passes: SatellitePass[] = [];
    const observerGd = {
      longitude: satellite.degreesToRadians(observer.longitude),
      latitude: satellite.degreesToRadians(observer.latitude),
      height: observer.altitude / 1000, // km
    };

    const now = new Date();
    const end = new Date(now.getTime() + hours * 3600000);
    const step = 60000; // 1 minute steps

    for (const [, sat] of this.satellites) {
      let inPass = false;
      let passStart = now;
      let maxEl = 0;
      let maxElTime = now;

      for (let t = now.getTime(); t < end.getTime(); t += step) {
        const time = new Date(t);
        const posVel = satellite.propagate(sat.satrec, time);
        if (typeof posVel.position === 'boolean') continue;

        const gmst = satellite.gstime(time);
        const lookAngles = satellite.ecfToLookAngles(
          observerGd,
          satellite.eciToEcf(posVel.position, gmst)
        );
        const elDeg = (satellite as any).radiansToDegrees(lookAngles.elevation);

        if (elDeg > 0) {
          if (!inPass) {
            inPass = true;
            passStart = time;
            maxEl = elDeg;
            maxElTime = time;
          }
          if (elDeg > maxEl) {
            maxEl = elDeg;
            maxElTime = time;
          }
        } else if (inPass) {
          inPass = false;
          if (maxEl > 5) { // Only include passes > 5° elevation
            passes.push({
              satellite: sat.tle.name,
              aos: passStart,
              los: time,
              tca: maxElTime,
              maxElevation: maxEl,
              aosAzimuth: 0,
              losAzimuth: 0,
              duration: (time.getTime() - passStart.getTime()) / 1000,
            });
          }
        }
      }

      // Limit passes per satellite
      if (passes.length > 200) break;
    }

    return passes.sort((a, b) => a.aos.getTime() - b.aos.getTime());
  }

  async predictPassesForSat(catalogNumber: number, observer: GroundStation, hours: number = 24): Promise<SatellitePass[]> {
    if (!this.loaded) await this.loadTLEs();

    const sat = this.satellites.get(catalogNumber);
    if (!sat) return [];

    const passes: SatellitePass[] = [];
    const observerGd = {
      longitude: satellite.degreesToRadians(observer.longitude),
      latitude: satellite.degreesToRadians(observer.latitude),
      height: observer.altitude / 1000,
    };

    const now = new Date();
    const end = new Date(now.getTime() + hours * 3600000);
    const step = 30000; // 30-second steps for better precision

    let inPass = false;
    let passStart = now;
    let maxEl = 0;
    let maxElTime = now;

    for (let t = now.getTime(); t < end.getTime(); t += step) {
      const time = new Date(t);
      const posVel = satellite.propagate(sat.satrec, time);
      if (typeof posVel.position === 'boolean') continue;

      const gmst = satellite.gstime(time);
      const lookAngles = satellite.ecfToLookAngles(
        observerGd,
        satellite.eciToEcf(posVel.position, gmst)
      );
      const elDeg = (satellite as any).radiansToDegrees(lookAngles.elevation);

      if (elDeg > 0) {
        if (!inPass) {
          inPass = true;
          passStart = time;
          maxEl = elDeg;
          maxElTime = time;
        }
        if (elDeg > maxEl) {
          maxEl = elDeg;
          maxElTime = time;
        }
      } else if (inPass) {
        inPass = false;
        if (maxEl > 2) {
          passes.push({
            satellite: sat.tle.name,
            aos: passStart,
            los: time,
            tca: maxElTime,
            maxElevation: maxEl,
            aosAzimuth: 0,
            losAzimuth: 0,
            duration: (time.getTime() - passStart.getTime()) / 1000,
          });
        }
      }
    }

    return passes.sort((a, b) => a.aos.getTime() - b.aos.getTime());
  }
}
