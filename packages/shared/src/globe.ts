// Phase 8: 3D Globe types

export interface GlobePoint {
  lat: number;
  lng: number;
  alt?: number; // km above surface
  label?: string;
  color?: string;
  size?: number;
}

export interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color?: string;
  stroke?: number;
  label?: string;
}

export interface GlobeOrbitPath {
  noradId: number;
  name: string;
  points: Array<{ lat: number; lng: number; alt: number }>;
  color: string;
}

export interface GlobeFootprint {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  color: string;
  opacity: number;
  label?: string;
}

export interface GlobeConfig {
  showSatellites: boolean;
  showAircraft: boolean;
  showVessels: boolean;
  showEdgeNodes: boolean;
  showDayNight: boolean;
  showAtmosphere: boolean;
  showFootprints: boolean;
  showOrbits: boolean;
  showGroundStations: boolean;
  autoRotate: boolean;
  darkMode: boolean;
  textureSet: 'dark' | 'blue-marble' | 'night-lights';
}

export interface GlobeCameraState {
  lat: number;
  lng: number;
  altitude: number; // km
  followTarget?: string; // norad ID or entity ID
}
