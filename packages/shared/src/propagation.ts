// Propagation Tools Types

export interface SolarData {
  solarFlux: number; // SFI (Solar Flux Index)
  aIndex: number;
  kIndex: number;
  sunspotNumber: number;
  xrayFlux?: string; // e.g. 'B5.2'
  protonFlux?: number;
  electronFlux?: number;
  geomagField: 'quiet' | 'unsettled' | 'active' | 'storm' | 'major_storm';
  updatedAt: number;
  source: string;
}

export interface BandCondition {
  band: string; // e.g. '80m', '40m', '20m', '15m', '10m'
  frequency: string; // e.g. '3.5-4.0 MHz'
  dayCondition: 'open' | 'fair' | 'poor' | 'closed';
  nightCondition: 'open' | 'fair' | 'poor' | 'closed';
  muf?: number; // Maximum Usable Frequency for that path
}

export interface PropagationPrediction {
  fromGrid: string;
  toGrid: string;
  distance: number; // km
  bearing: number; // degrees
  bands: BandCondition[];
  muf: number; // MHz
  luf: number; // MHz
  fot: number; // Frequency of Optimum Traffic
  timestamp: number;
}

export interface GreylineData {
  solarDeclination: number;
  subsolarLat: number;
  subsolarLng: number;
  terminatorPoints: { lat: number; lng: number }[];
  timestamp: number;
}
