import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { THEMES, type ThemeDefinition } from '@signalforge/shared';

interface ThemeContextType {
  theme: ThemeDefinition;
  themeId: string;
  setTheme: (id: string) => void;
  customAccent?: string;
  setCustomAccent: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: THEMES.default,
  themeId: 'default',
  setTheme: () => {},
  setCustomAccent: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const THEME_CLASSES: Record<string, string> = {
  lcars: 'theme-lcars',
  classic: 'theme-light',
  tactical: 'theme-tactical',
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeId, setThemeId] = useState(() => localStorage.getItem('signalforge-theme') || 'default');
  const [customAccent, setCustomAccent] = useState<string | undefined>(() => localStorage.getItem('signalforge-accent') || undefined);

  const theme = THEMES[themeId] || THEMES.default;

  const applyTheme = useCallback((t: ThemeDefinition, accent?: string) => {
    const root = document.documentElement;
    const c = t.colors;
    root.style.setProperty('--forge-bg', c.bg);
    root.style.setProperty('--forge-surface', c.surface);
    root.style.setProperty('--forge-panel', c.panel);
    root.style.setProperty('--forge-border', c.border);
    root.style.setProperty('--forge-primary', accent || c.primary);
    root.style.setProperty('--forge-primary-dim', c.primaryDim);
    root.style.setProperty('--forge-secondary', c.secondary);
    root.style.setProperty('--forge-accent', c.accent);
    root.style.setProperty('--forge-danger', c.danger);
    root.style.setProperty('--forge-success', c.success);
    root.style.setProperty('--forge-text', c.text);
    root.style.setProperty('--forge-text-dim', c.textDim);
    root.style.setProperty('--forge-grid-overlay', c.gridOverlay);

    document.body.style.backgroundColor = c.bg;
    document.body.style.color = c.text;

    // Remove all theme classes, then add the right one
    Object.values(THEME_CLASSES).forEach(cls => document.body.classList.remove(cls));
    if (THEME_CLASSES[t.id]) {
      document.body.classList.add(THEME_CLASSES[t.id]);
    }
  }, []);

  useEffect(() => {
    applyTheme(theme, customAccent);
  }, [theme, customAccent, applyTheme]);

  const setTheme = (id: string) => {
    setThemeId(id);
    localStorage.setItem('signalforge-theme', id);
  };

  const setAccent = (color: string) => {
    setCustomAccent(color);
    localStorage.setItem('signalforge-accent', color);
  };

  return (
    <ThemeContext.Provider value={{ theme, themeId, setTheme, customAccent, setCustomAccent: setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
};
