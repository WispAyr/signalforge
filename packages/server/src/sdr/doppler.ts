import { EventEmitter } from 'events';
import type { DopplerCorrection } from '@signalforge/shared';

/**
 * Doppler Correction Service — calculates and applies Doppler shift
 * for satellite communications.
 * 
 * Doppler shift formula:
 *   f_received = f_transmitted * (1 + v_rel / c)
 * where v_rel is the relative velocity (range rate) between observer and satellite.
 * 
 * When satellite approaches: positive shift (higher frequency)
 * When satellite recedes: negative shift (lower frequency)
 */

const SPEED_OF_LIGHT = 299792458; // m/s

export interface SatellitePositionData {
  name: string;
  latitude: number;
  longitude: number;
  altitude: number; // km
  velocity?: { x: number; y: number; z: number }; // km/s ECI
}

export interface ObserverData {
  latitude: number;
  longitude: number;
  altitude: number; // meters
}

export class DopplerService extends EventEmitter {
  private tracking = false;
  private satelliteName = '';
  private nominalFrequency = 0;
  private lastRangeRate = 0;
  private lastCorrection: DopplerCorrection | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  // Position update callback
  private getSatPosition: (() => SatellitePositionData | null) | null = null;
  private getObserver: (() => ObserverData) | null = null;
  private lastSatPos: { lat: number; lon: number; alt: number; time: number } | null = null;

  startTracking(
    satelliteName: string,
    nominalFrequency: number,
    getSatPosition: () => SatellitePositionData | null,
    getObserver: () => ObserverData,
  ) {
    this.tracking = true;
    this.satelliteName = satelliteName;
    this.nominalFrequency = nominalFrequency;
    this.getSatPosition = getSatPosition;
    this.getObserver = getObserver;

    // Update Doppler correction every 100ms for smooth tuning
    this.updateInterval = setInterval(() => this.update(), 100);
    console.log(`🎯 Doppler tracking started: ${satelliteName} @ ${(nominalFrequency / 1e6).toFixed(3)} MHz`);
  }

  stopTracking() {
    this.tracking = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.getSatPosition = null;
    this.getObserver = null;
    this.lastSatPos = null;
    console.log(`🎯 Doppler tracking stopped`);
  }

  get isTracking() { return this.tracking; }
  get currentCorrection() { return this.lastCorrection; }

  private update() {
    if (!this.getSatPosition || !this.getObserver) return;

    const satPos = this.getSatPosition();
    const observer = this.getObserver();
    if (!satPos) return;

    // Calculate range rate (change in distance over time)
    const now = Date.now();
    const satLat = satPos.latitude * Math.PI / 180;
    const satLon = satPos.longitude * Math.PI / 180;
    const satAlt = satPos.altitude; // km
    const obsLat = observer.latitude * Math.PI / 180;
    const obsLon = observer.longitude * Math.PI / 180;
    const obsAlt = observer.altitude / 1000; // convert m to km

    // Simple range calculation using law of cosines on sphere
    const R = 6371; // Earth radius km
    const satR = R + satAlt;
    const obsR = R + obsAlt;

    const cosAngle = Math.sin(obsLat) * Math.sin(satLat) +
                     Math.cos(obsLat) * Math.cos(satLat) * Math.cos(satLon - obsLon);
    const range = Math.sqrt(obsR * obsR + satR * satR - 2 * obsR * satR * cosAngle);

    // Compute range rate from successive positions
    if (this.lastSatPos) {
      const dt = (now - this.lastSatPos.time) / 1000; // seconds
      if (dt > 0 && dt < 2) {
        const lastSatLat = this.lastSatPos.lat * Math.PI / 180;
        const lastSatLon = this.lastSatPos.lon * Math.PI / 180;
        const lastSatR = R + this.lastSatPos.alt;
        const lastCosAngle = Math.sin(obsLat) * Math.sin(lastSatLat) +
                             Math.cos(obsLat) * Math.cos(lastSatLat) * Math.cos(lastSatLon - obsLon);
        const lastRange = Math.sqrt(obsR * obsR + lastSatR * lastSatR - 2 * obsR * lastSatR * lastCosAngle);

        this.lastRangeRate = (range - lastRange) / dt; // km/s

        // Doppler shift
        const dopplerShift = -this.nominalFrequency * (this.lastRangeRate * 1000) / SPEED_OF_LIGHT;
        const correctedFrequency = this.nominalFrequency + dopplerShift;

        this.lastCorrection = {
          satelliteName: this.satelliteName,
          nominalFrequency: this.nominalFrequency,
          correctedFrequency,
          dopplerShift,
          rangeRate: this.lastRangeRate,
          timestamp: now,
        };

        this.emit('correction', this.lastCorrection);
      }
    }

    this.lastSatPos = {
      lat: satPos.latitude,
      lon: satPos.longitude,
      alt: satPos.altitude,
      time: now,
    };
  }

  /**
   * Calculate Doppler shift for a given range rate
   */
  static calculateShift(nominalFrequency: number, rangeRateKmS: number): number {
    return -nominalFrequency * (rangeRateKmS * 1000) / SPEED_OF_LIGHT;
  }
}
