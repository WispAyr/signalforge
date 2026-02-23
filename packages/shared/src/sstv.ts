// SSTV Decoder Types

export type SSTVMode = 'Martin1' | 'Martin2' | 'Scottie1' | 'Scottie2' | 'ScottieDX' | 'Robot36' | 'Robot72' | 'PD90' | 'PD120' | 'PD160' | 'PD180' | 'PD240';

export interface SSTVImage {
  id: string;
  timestamp: number;
  mode: SSTVMode;
  frequency: number;
  width: number;
  height: number;
  progress: number;
  complete: boolean;
  thumbnailBase64?: string;
  imageBase64?: string;
  source: string;
  snr?: number;
  notes?: string;
}

export interface SSTVBand {
  name: string;
  frequency: number;
  description: string;
  active: boolean;
}

export const SSTV_BANDS: SSTVBand[] = [
  { name: 'ISS', frequency: 145.8e6, description: 'ISS SSTV (145.800 MHz)', active: false },
  { name: '80m', frequency: 3.73e6, description: '80m SSTV (3.730 MHz)', active: false },
  { name: '40m', frequency: 7.171e6, description: '40m SSTV (7.171 MHz)', active: false },
  { name: '20m', frequency: 14.23e6, description: '20m SSTV (14.230 MHz)', active: false },
  { name: '15m', frequency: 21.34e6, description: '15m SSTV (21.340 MHz)', active: false },
];

export interface SSTVConfig {
  enabled: boolean;
  monitoredBands: string[];
  autoDetect: boolean;
  saveImages: boolean;
  galleryPath: string;
}

export interface SSTVStatus {
  active: boolean;
  currentMode: SSTVMode | null;
  receiving: boolean;
  imagesDecoded: number;
  monitoredFrequencies: number[];
}
