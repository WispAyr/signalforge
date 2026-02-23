// Phase 8: Cinematic Mode / Screensaver types

export type CinematicScene = 'globe' | 'waterfall' | 'aircraft' | 'heatmap' | 'spectrum' | 'satellites';

export interface CinematicConfig {
  enabled: boolean;
  scenes: CinematicScene[];
  cycleDurationSec: number;
  autoCycle: boolean;
  showBranding: boolean;
  brandingText: string;
  brandingLogo?: string;
  showClock: boolean;
  showStats: boolean;
  transitionEffect: 'fade' | 'slide' | 'zoom';
  idleTimeoutMin: number; // auto-start after idle
}
