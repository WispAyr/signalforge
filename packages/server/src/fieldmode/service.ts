import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import type { FieldModeStatus, CachedAsset, FieldChecklist, FieldArchive } from '@signalforge/shared';

export class FieldModeService extends EventEmitter {
  private enabled = false;
  private cachedAssets: CachedAsset[] = [];
  private checklists: FieldChecklist[] = [];
  private archives: FieldArchive[] = [];

  private assetPaths = {
    tle: 'data/tle/active.txt',
    freqalloc: 'data/frequency-allocation.json',
    signals: 'data/signals.json',
    stations: 'data/number-stations.json',
  };

  constructor() {
    super();
    this.initializeCache().catch(console.error);
  }

  private async initializeCache() {
    // Simulate cached assets
    this.cachedAssets = [
      { type: 'tle', name: 'Satellite TLE Database', version: '2026-02-22', size: 1024 * 512, lastUpdated: Date.now() - 86400000, availableOffline: true },
      { type: 'freqalloc', name: 'Frequency Allocation Chart', version: '2025', size: 1024 * 120, lastUpdated: Date.now() - 172800000, availableOffline: true },
      { type: 'signals', name: 'Known Signal Database', version: '1.2', size: 1024 * 280, lastUpdated: Date.now() - 43200000, availableOffline: true },
      { type: 'stations', name: 'Number Stations Database', version: '2026-01', size: 1024 * 85, lastUpdated: Date.now() - 259200000, availableOffline: true },
    ];

    this.checklists = [
      {
        id: 'cl1',
        name: 'Field Deployment v1',
        items: [
          { id: 'i1', label: 'Verify GPS lock', category: 'navigation', checked: true },
          { id: 'i2', label: 'Check antenna connections', category: 'hardware', checked: true },
          { id: 'i3', label: 'Confirm battery level > 80%', category: 'power', checked: false },
          { id: 'i4', label: 'Cache TLE database', category: 'data', checked: true },
          { id: 'i5', label: 'Download offline maps', category: 'data', checked: false },
          { id: 'i6', label: 'Test SDR connection', category: 'hardware', checked: true },
          { id: 'i7', label: 'Set up field laptop', category: 'hardware', checked: false },
          { id: 'i8', label: 'Verify offline mode enabled', category: 'software', checked: true },
        ],
        createdAt: Date.now() - 3600000,
        completedAt: null,
      },
    ];

    this.archives = [
      { id: 'arc1', name: 'Full Dataset 2026-02', size: 1024 * 1500, createdAt: Date.now() - 604800000 },
      { id: 'arc2', name: 'Satellite Passes Only', size: 1024 * 320, createdAt: Date.now() - 259200000 },
    ];
  }

  enable() {
    this.enabled = true;
    this.emit('field_mode_enabled');
  }

  disable() {
    this.enabled = false;
    this.emit('field_mode_disabled');
  }

  getStatus(): FieldModeStatus {
    const offlineReady = this.cachedAssets.every(a => a.availableOffline);
    const totalStorage = 1024 * 1024 * 50; // 50 MB
    const usedStorage = this.cachedAssets.reduce((sum, a) => sum + a.size, 0) +
      this.archives.reduce((sum, a) => sum + a.size, 0);

    return {
      enabled: this.enabled,
      offlineReady,
      storageUsed: usedStorage,
      storageAvailable: totalStorage,
      cachedAssets: this.cachedAssets,
      lastSync: Date.now() - 86400000,
      syncInterval: 86400000, // 24h
    };
  }

  getCachedAssets(): CachedAsset[] {
    return this.cachedAssets;
  }

  refreshAsset(type: string): CachedAsset | null {
    const asset = this.cachedAssets.find(a => a.type === type);
    if (!asset) return null;

    // Simulate refresh
    asset.lastUpdated = Date.now();
    asset.version = new Date().toISOString().slice(0, 10);
    asset.size = Math.floor(asset.size * (0.9 + Math.random() * 0.2));

    this.emit('asset_refreshed', asset);
    return asset;
  }

  getChecklists(): FieldChecklist[] {
    return this.checklists;
  }

  createChecklist(name: string): FieldChecklist {
    const defaultItems = [
      { id: 'gps', label: 'GPS lock', category: 'navigation', checked: false },
      { id: 'battery', label: 'Battery > 50%', category: 'power', checked: false },
      { id: 'antenna', label: 'Antenna secure', category: 'hardware', checked: false },
      { id: 'sdr', label: 'SDR connected', category: 'hardware', checked: false },
      { id: 'offline', label: 'Offline mode enabled', category: 'software', checked: false },
      { id: 'maps', label: 'Offline maps cached', category: 'data', checked: false },
      { id: 'tle', label: 'TLE database updated', category: 'data', checked: false },
      { id: 'notes', label: 'Mission notes prepared', category: 'ops', checked: false },
    ];

    const cl: FieldChecklist = {
      id: `cl${Date.now()}`,
      name,
      items: defaultItems,
      createdAt: Date.now(),
      completedAt: null,
    };

    this.checklists.push(cl);
    this.emit('checklist_created', cl);
    return cl;
  }

  updateChecklistItem(clId: string, itemId: string, checked: boolean): FieldChecklist | null {
    const cl = this.checklists.find(c => c.id === clId);
    if (!cl) return null;

    const item = cl.items.find(i => i.id === itemId);
    if (!item) return null;

    item.checked = checked;

    // If all items checked, mark completed
    if (cl.items.every(i => i.checked) && !cl.completedAt) {
      cl.completedAt = Date.now();
      this.emit('checklist_completed', cl);
    }

    this.emit('checklist_updated', cl);
    return cl;
  }

  getArchives(): FieldArchive[] {
    return this.archives;
  }

  createArchive(name: string, includes: string[]): FieldArchive {
    const size = 1024 * (800 + Math.floor(Math.random() * 500));
    const archive: FieldArchive = {
      id: `arc${Date.now()}`,
      name,
      size,
      createdAt: Date.now(),
      includes: includes.length > 0 ? includes : ['tle', 'signals', 'stations'],
      downloadUrl: `/api/fieldmode/archives/${Date.now()}.zip`,
    };

    this.archives.push(archive);
    this.emit('archive_created', archive);
    return archive;
  }
}