// ============================================================================
// SignalForge DSP Types
// ============================================================================

export type DemodMode = 'fm' | 'am' | 'usb' | 'lsb' | 'cw' | 'raw';

export type WindowFunction = 'hann' | 'hamming' | 'blackman' | 'kaiser' | 'rectangular';

export interface FFTConfig {
  size: number;            // 1024, 2048, 4096, 8192, 16384
  windowFunction: WindowFunction;
  averaging: number;       // 1 = no averaging
  overlap: number;         // 0.0 to 0.9
}

export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  cutoffLow?: number;
  cutoffHigh?: number;
  order: number;
  gain?: number;
}

export interface DemodConfig {
  mode: DemodMode;
  bandwidth: number;
  squelch?: number;        // dB threshold
  audioRate: number;       // output sample rate (typically 48000)
}

export interface WaterfallConfig {
  colormap: string;
  minDb: number;
  maxDb: number;
  speed: number;          // lines per second
  fftSize: number;
}

// Color maps for waterfall
export const COLORMAPS = {
  cyberether: { name: 'CyberEther', colors: ['#000000', '#00002a', '#000066', '#0033aa', '#0066cc', '#00aadd', '#00ddaa', '#88ee44', '#ffee00', '#ffffff'] },
  cosmic: { name: 'Cosmic', colors: ['#000011', '#0a0a4a', '#1a0a6a', '#4a0a8a', '#8a0a6a', '#ca2a2a', '#fa6a0a', '#faca0a', '#ffffff'] },
  thermal: { name: 'Thermal', colors: ['#000000', '#1a0033', '#4a0066', '#800066', '#cc0033', '#ff3300', '#ff9900', '#ffff00', '#ffffff'] },
  viridis: { name: 'Viridis', colors: ['#440154', '#482777', '#3f4a8a', '#31678e', '#26838f', '#1f9d8a', '#6cce5a', '#b6de2b', '#fee825'] },
  nightvision: { name: 'Night Vision', colors: ['#000000', '#001100', '#003300', '#005500', '#008800', '#00bb00', '#00ff00', '#88ff44', '#ffffff'] },
  inferno: { name: 'Inferno', colors: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'] },
} as const;

export type ColormapName = keyof typeof COLORMAPS;
