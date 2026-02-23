// ============================================================================
// SignalForge Satellite Types
// ============================================================================

export interface TLE {
  name: string;
  line1: string;
  line2: string;
  catalogNumber: number;
  epoch: string;
}

export interface SatellitePosition {
  latitude: number;   // degrees
  longitude: number;  // degrees
  altitude: number;   // km
  velocity: number;   // km/s
  azimuth: number;    // degrees from observer
  elevation: number;  // degrees from observer
  range: number;      // km from observer
  timestamp: number;
}

export interface GroundStation {
  name: string;
  latitude: number;
  longitude: number;
  altitude: number;  // meters above sea level
}

export interface SatellitePass {
  satellite: string;
  aos: Date;         // acquisition of signal
  los: Date;         // loss of signal
  tca: Date;         // time of closest approach
  maxElevation: number;
  aosAzimuth: number;
  losAzimuth: number;
  duration: number;  // seconds
}

export interface TLESource {
  name: string;
  url: string;
  category: string;
  lastUpdated?: string;
}

export const DEFAULT_TLE_SOURCES: TLESource[] = [
  { name: 'Active Satellites', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle', category: 'active' },
  { name: 'Weather', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle', category: 'weather' },
  { name: 'NOAA', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=noaa&FORMAT=tle', category: 'noaa' },
  { name: 'Amateur Radio', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle', category: 'amateur' },
  { name: 'Space Stations', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', category: 'stations' },
  { name: 'Starlink', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', category: 'starlink' },
];
