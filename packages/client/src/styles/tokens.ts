// ============================================================================
// SignalForge Design Tokens — Single Source of Truth
// ============================================================================

// ---------- Colour Palette ----------
export const colors = {
  forge: {
    cyan:    { 50: '#e0f7fa', 100: '#b2ebf2', 200: '#80deea', 300: '#4dd0e1', 400: '#26c6da', 500: '#00e5ff', 600: '#00b8d4', 700: '#0097a7', 800: '#006677', 900: '#004d40' },
    amber:   { 50: '#fff8e1', 100: '#ffecb3', 200: '#ffe082', 300: '#ffd54f', 400: '#ffca28', 500: '#ffab00', 600: '#ff8f00', 700: '#ff6f00', 800: '#664400', 900: '#4e3300' },
    red:     { 50: '#fce4ec', 100: '#ffcdd2', 200: '#ef9a9a', 300: '#e57373', 400: '#ef5350', 500: '#ff1744', 600: '#d50000', 700: '#b71c1c', 800: '#880e4f', 900: '#4a0000' },
    green:   { 50: '#e8f5e9', 100: '#c8e6c9', 200: '#a5d6a7', 300: '#81c784', 400: '#66bb6a', 500: '#00e676', 600: '#00c853', 700: '#00a844', 800: '#1b5e20', 900: '#0d3d12' },
    purple:  { 500: '#aa00ff', 600: '#8e00cc' },
  },
  bg:          'var(--forge-bg)',
  surface:     'var(--forge-surface)',
  panel:       'var(--forge-panel)',
  border:      'var(--forge-border)',
  primary:     'var(--forge-primary)',
  primaryDim:  'var(--forge-primary-dim)',
  secondary:   'var(--forge-secondary)',
  accent:      'var(--forge-accent)',
  danger:      'var(--forge-danger)',
  success:     'var(--forge-success)',
  text:        'var(--forge-text)',
  textDim:     'var(--forge-text-dim)',
} as const;

// ---------- Typography ----------
export const typography = {
  fontFamily: {
    display: "'Orbitron', sans-serif",
    heading: "'Orbitron', sans-serif",
    body:    "'Inter', 'system-ui', sans-serif",
    mono:    "'JetBrains Mono', 'Fira Code', monospace",
    caption: "'JetBrains Mono', monospace",
  },
  fontSize: {
    display:  { size: '2.5rem',  lineHeight: '1.1', weight: 700, letterSpacing: '0.08em' },
    h1:       { size: '1.75rem', lineHeight: '1.2', weight: 700, letterSpacing: '0.06em' },
    h2:       { size: '1.25rem', lineHeight: '1.3', weight: 600, letterSpacing: '0.04em' },
    h3:       { size: '1rem',    lineHeight: '1.4', weight: 600, letterSpacing: '0.03em' },
    body:     { size: '0.875rem',lineHeight: '1.5', weight: 400, letterSpacing: '0' },
    bodySmall:{ size: '0.75rem', lineHeight: '1.5', weight: 400, letterSpacing: '0' },
    mono:     { size: '0.75rem', lineHeight: '1.6', weight: 400, letterSpacing: '0.04em' },
    caption:  { size: '0.625rem',lineHeight: '1.4', weight: 400, letterSpacing: '0.08em' },
  },
} as const;

// ---------- Spacing ----------
export const spacing = {
  0:   '0',
  0.5: '0.125rem',
  1:   '0.25rem',
  1.5: '0.375rem',
  2:   '0.5rem',
  3:   '0.75rem',
  4:   '1rem',
  5:   '1.25rem',
  6:   '1.5rem',
  8:   '2rem',
  10:  '2.5rem',
  12:  '3rem',
  16:  '4rem',
  20:  '5rem',
  24:  '6rem',
} as const;

// ---------- Border Radius ----------
export const radii = {
  none: '0',
  sm:   '0.25rem',
  md:   '0.5rem',
  lg:   '0.75rem',
  xl:   '1rem',
  '2xl':'1.5rem',
  full: '9999px',
} as const;

// ---------- Shadows ----------
export const shadows = {
  sm:    '0 1px 2px rgba(0,0,0,0.3)',
  md:    '0 4px 6px rgba(0,0,0,0.4)',
  lg:    '0 10px 15px rgba(0,0,0,0.5)',
  xl:    '0 20px 25px rgba(0,0,0,0.5)',
  glow: {
    cyan:   '0 0 10px rgba(0,229,255,0.3), inset 0 0 10px rgba(0,229,255,0.1)',
    amber:  '0 0 10px rgba(255,171,0,0.3), inset 0 0 10px rgba(255,171,0,0.1)',
    red:    '0 0 10px rgba(255,23,68,0.3), inset 0 0 10px rgba(255,23,68,0.1)',
    green:  '0 0 10px rgba(0,230,118,0.3), inset 0 0 10px rgba(0,230,118,0.1)',
    purple: '0 0 10px rgba(170,0,255,0.3), inset 0 0 10px rgba(170,0,255,0.1)',
  },
  inner: 'inset 0 2px 4px rgba(0,0,0,0.3)',
} as const;

// ---------- Blur ----------
export const blur = {
  none: '0',
  sm:   '4px',
  md:   '8px',
  lg:   '12px',
  xl:   '24px',
} as const;

// ---------- Animation ----------
export const animation = {
  duration: {
    instant: '0ms',
    fast:    '100ms',
    normal:  '200ms',
    slow:    '350ms',
    slower:  '500ms',
    glacial: '1000ms',
  },
  easing: {
    default:   'cubic-bezier(0.4, 0, 0.2, 1)',
    in:        'cubic-bezier(0.4, 0, 1, 1)',
    out:       'cubic-bezier(0, 0, 0.2, 1)',
    inOut:     'cubic-bezier(0.4, 0, 0.2, 1)',
    bounce:    'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    spring:    'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  },
} as const;

// ---------- Breakpoints ----------
export const breakpoints = {
  sm:  '640px',
  md:  '768px',
  lg:  '1024px',
  xl:  '1280px',
  '2xl': '1536px',
} as const;

// ---------- Z-Index ----------
export const zIndex = {
  base:      0,
  sidebar:   40,
  header:    50,
  dropdown:  60,
  modal:     70,
  toast:     80,
  tooltip:   90,
  command:   100,
} as const;

// ---------- Data Density ----------
export type DataDensity = 'compact' | 'comfortable' | 'spacious';

export const density: Record<DataDensity, { padding: string; gap: string; fontSize: string; lineHeight: string }> = {
  compact:     { padding: '0.25rem 0.5rem', gap: '0.25rem', fontSize: '0.6875rem', lineHeight: '1.4' },
  comfortable: { padding: '0.5rem 0.75rem',  gap: '0.5rem',  fontSize: '0.75rem',   lineHeight: '1.5' },
  spacious:    { padding: '0.75rem 1rem',    gap: '0.75rem', fontSize: '0.875rem',  lineHeight: '1.6' },
};
