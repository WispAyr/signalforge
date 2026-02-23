// Offline / Field Mode Types

export interface FieldModeStatus {
  enabled: boolean;
  offlineReady: boolean;
  cachedAssets: CachedAsset[];
  lastSync: number;
  storageUsed: number;
  storageAvailable: number;
  syncInterval?: number;
}

export interface CachedAsset {
  type: string;
  name: string;
  size: number;
  lastUpdated: number;
  version: string;
  availableOffline?: boolean;
}

export interface FieldChecklist {
  id: string;
  name: string;
  items: FieldChecklistItem[];
  createdAt?: number;
  completedAt?: number | null;
}

export interface FieldChecklistItem {
  id: string;
  label: string;
  category: string;
  checked: boolean;
  notes?: string;
}

export interface FieldArchive {
  id: string;
  name: string;
  createdAt: number;
  size: number;
  includes?: string[];
  checksum?: string;
  downloadUrl?: string;
}

export interface DataArchive extends FieldArchive {}

export const DEFAULT_CHECKLIST: FieldChecklistItem[] = [
  { id: 'hw-sdr', label: 'SDR dongle + antenna', category: 'hardware', checked: false },
  { id: 'hw-hackrf', label: 'HackRF One (optional)', category: 'hardware', checked: false },
  { id: 'hw-laptop', label: 'Laptop / field device', category: 'hardware', checked: false },
  { id: 'hw-cables', label: 'Cables & adapters', category: 'hardware', checked: false },
  { id: 'pwr-battery', label: 'Battery pack (charged)', category: 'power', checked: false },
  { id: 'pwr-solar', label: 'Solar panel (optional)', category: 'power', checked: false },
  { id: 'sw-tle', label: 'TLE data cached', category: 'data', checked: false },
  { id: 'sw-freq', label: 'Frequency database cached', category: 'data', checked: false },
  { id: 'sw-signals', label: 'Signal database cached', category: 'data', checked: false },
  { id: 'sw-offline', label: 'Service worker installed', category: 'software', checked: false },
  { id: 'comms-mesh', label: 'Meshtastic radio (optional)', category: 'comms', checked: false },
  { id: 'comms-sat', label: 'Satellite phone (optional)', category: 'comms', checked: false },
];
