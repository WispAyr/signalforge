// ============================================================================
// SignalForge Theme Types
// ============================================================================

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  fonts?: {
    mono?: string;
    display?: string;
    body?: string;
  };
  borderRadius?: string;
  glowIntensity?: number;
}

export interface ThemeColors {
  bg: string;
  surface: string;
  panel: string;
  border: string;
  primary: string;
  primaryDim: string;
  secondary: string;
  secondaryDim: string;
  accent: string;
  danger: string;
  success: string;
  text: string;
  textDim: string;
  gridOverlay: string;
}

export const THEMES: Record<string, ThemeDefinition> = {
  default: {
    id: 'default',
    name: 'Signal Cyan',
    description: 'Default dark theme with cyan accents',
    colors: {
      bg: '#0a0a0f', surface: '#12121a', panel: '#1a1a2e', border: '#2a2a4a',
      primary: '#00e5ff', primaryDim: '#006677', secondary: '#ffab00', secondaryDim: '#664400',
      accent: '#aa00ff', danger: '#ff1744', success: '#00e676',
      text: '#e0e0e8', textDim: '#6a6a8a', gridOverlay: 'rgba(0, 229, 255, 0.03)',
    },
  },
  tactical: {
    id: 'tactical',
    name: 'Tactical',
    description: 'Military-style green/amber theme',
    colors: {
      bg: '#0a0f0a', surface: '#121a12', panel: '#1a2e1a', border: '#2a4a2a',
      primary: '#33ff33', primaryDim: '#116611', secondary: '#ffaa00', secondaryDim: '#664400',
      accent: '#ff6600', danger: '#ff3333', success: '#33ff33',
      text: '#ccffcc', textDim: '#558855', gridOverlay: 'rgba(51, 255, 51, 0.03)',
    },
    fonts: { mono: "'Courier New', monospace", display: "'Courier New', monospace" },
  },
  lcars: {
    id: 'lcars',
    name: 'LCARS',
    description: 'Star Trek LCARS interface theme',
    colors: {
      bg: '#000000', surface: '#111111', panel: '#1a1a1a', border: '#FF9900',
      primary: '#FF9900', primaryDim: '#996600', secondary: '#CC99CC', secondaryDim: '#664466',
      accent: '#9999FF', danger: '#CC6666', success: '#99CC99',
      text: '#FF9900', textDim: '#CC99CC', gridOverlay: 'rgba(255, 153, 0, 0.02)',
    },
    fonts: { mono: "'Antonio', sans-serif", display: "'Antonio', sans-serif" },
    borderRadius: '24px 8px 24px 8px',
    glowIntensity: 0.2,
  },
  classic: {
    id: 'classic',
    name: 'Classic Light',
    description: 'Clean light theme for daytime use',
    colors: {
      bg: '#f0f2f5', surface: '#ffffff', panel: '#e8eaed', border: '#d0d5dd',
      primary: '#1a73e8', primaryDim: '#8ab4f8', secondary: '#e8710a', secondaryDim: '#fdd663',
      accent: '#9334e6', danger: '#d93025', success: '#1e8e3e',
      text: '#202124', textDim: '#80868b', gridOverlay: 'rgba(0, 0, 0, 0.02)',
    },
    glowIntensity: 0,
  },
};
