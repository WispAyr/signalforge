// ============================================================================
// SignalForge Frequency Scanner Types
// ============================================================================

export interface ScanConfig {
  id: string;
  name: string;
  startFrequency: number;
  endFrequency: number;
  stepSize: number;
  mode: 'am' | 'fm' | 'ssb';
  squelchThreshold: number; // dB
  dwellTime: number; // ms
  scanSpeed: 'slow' | 'normal' | 'fast';
  resumeDelay: number; // ms after signal lost
  active: boolean;
}

export interface ScanListEntry {
  id: string;
  name: string;
  frequency: number;
  mode: string;
  priority: boolean;
  squelchOverride?: number;
  tags?: string[];
  lastActive?: number;
  hitCount: number;
}

export interface ScanActivity {
  id: string;
  frequency: number;
  mode: string;
  timestamp: number;
  duration: number; // ms
  signalStrength: number; // dBm
  description?: string;
  scanConfigId?: string;
}

export interface ScannerState {
  active: boolean;
  currentFrequency: number;
  signalDetected: boolean;
  signalStrength: number;
  scanConfigId?: string;
  scanDirection: 'up' | 'down';
  scannedCount: number;
  hitCount: number;
  startedAt?: number;
}
