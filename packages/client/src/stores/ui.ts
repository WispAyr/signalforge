// ============================================================================
// UI State Store — sidebar, command palette, density, onboarding
// ============================================================================
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DataDensity } from '../styles/tokens';
import type { View } from '../App';

export interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  sidebarHovered: boolean;
  toggleSidebar: () => void;
  setSidebarPinned: (p: boolean) => void;
  setSidebarHovered: (h: boolean) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (o: boolean) => void;

  // Data density
  density: DataDensity;
  setDensity: (d: DataDensity) => void;

  // Onboarding
  onboardingComplete: boolean;
  setOnboardingComplete: (c: boolean) => void;
  visitedViews: Set<string>;
  markViewVisited: (v: string) => void;

  // Dashboard widgets
  dashboardLayout: string;
  setDashboardLayout: (l: string) => void;

  // Breadcrumb
  activeSection: string;
  setActiveSection: (s: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      sidebarPinned: false,
      sidebarHovered: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarPinned: (p) => set({ sidebarPinned: p, sidebarOpen: p }),
      setSidebarHovered: (h) => set({ sidebarHovered: h }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (o) => set({ commandPaletteOpen: o }),

      density: 'comfortable',
      setDensity: (d) => set({ density: d }),

      onboardingComplete: false,
      setOnboardingComplete: (c) => set({ onboardingComplete: c }),
      visitedViews: new Set<string>(),
      markViewVisited: (v) => set((s) => ({ visitedViews: new Set([...s.visitedViews, v]) })),

      dashboardLayout: 'ops-center',
      setDashboardLayout: (l) => set({ dashboardLayout: l }),

      activeSection: 'Operations',
      setActiveSection: (s) => set({ activeSection: s }),
    }),
    {
      name: 'signalforge-ui',
      partialize: (state) => ({
        sidebarPinned: state.sidebarPinned,
        density: state.density,
        onboardingComplete: state.onboardingComplete,
        visitedViews: Array.from(state.visitedViews),
        dashboardLayout: state.dashboardLayout,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        visitedViews: new Set(persisted?.visitedViews || []),
      }),
    }
  )
);
