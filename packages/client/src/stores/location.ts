import { create } from 'zustand';
import type { ObserverLocation, LocationSettings, LocationSource } from '@signalforge/shared';
import { DEFAULT_LOCATION, DEFAULT_LOCATION_SETTINGS } from '@signalforge/shared';

interface LocationStore {
  observer: ObserverLocation;
  settings: LocationSettings;
  loaded: boolean;

  fetchSettings: () => Promise<void>;
  setManualLocation: (lat: number, lon: number, alt?: number, name?: string) => Promise<void>;
  setSource: (source: LocationSource) => Promise<void>;
  updateSettings: (partial: Partial<LocationSettings>) => Promise<void>;
  useBrowserGPS: () => void;
}

export const useLocationStore = create<LocationStore>((set, get) => ({
  observer: { ...DEFAULT_LOCATION },
  settings: { ...DEFAULT_LOCATION_SETTINGS },
  loaded: false,

  fetchSettings: async () => {
    try {
      const res = await fetch('/api/settings/location');
      const settings = await res.json();
      set({ settings, observer: settings.observer, loaded: true });
    } catch { /* retry later */ }
  },

  setManualLocation: async (latitude, longitude, altitude = 0, name) => {
    try {
      const res = await fetch('/api/observer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude, altitude, name, source: 'manual' }),
      });
      const observer = await res.json();
      set({ observer });
    } catch { /* ignore */ }
  },

  setSource: async (source) => {
    try {
      const res = await fetch('/api/settings/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const settings = await res.json();
      set({ settings, observer: settings.observer });
    } catch { /* ignore */ }
  },

  updateSettings: async (partial) => {
    try {
      const res = await fetch('/api/settings/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const settings = await res.json();
      set({ settings, observer: settings.observer });
    } catch { /* ignore */ }
  },

  useBrowserGPS: () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await get().setManualLocation(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.altitude || 0,
          'Browser GPS',
        );
        // Update source to browser
        await fetch('/api/settings/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'browser' as LocationSource }),
        });
      },
      (err) => console.error('Browser GPS error:', err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  },
}));
