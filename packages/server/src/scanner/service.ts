// ============================================================================
// SignalForge Frequency Scanner Service
// ============================================================================
import { EventEmitter } from 'events';
import type { ScanConfig, ScanListEntry, ScanActivity, ScannerState } from '@signalforge/shared';

export class FrequencyScanner extends EventEmitter {
  private configs = new Map<string, ScanConfig>();
  private scanList = new Map<string, ScanListEntry>();
  private activities: ScanActivity[] = [];
  private state: ScannerState = {
    active: false, currentFrequency: 0, signalDetected: false,
    signalStrength: -120, scanDirection: 'up', scannedCount: 0, hitCount: 0,
  };
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private maxActivities = 1000;

  // Demo scanner that simulates scanning
  startScan(configId?: string) {
    if (this.state.active) return;
    const config = configId ? this.configs.get(configId) : this.getDefaultConfig();
    if (!config) return;

    this.state = {
      active: true, currentFrequency: config.startFrequency,
      signalDetected: false, signalStrength: -120,
      scanConfigId: config.id, scanDirection: 'up',
      scannedCount: 0, hitCount: 0, startedAt: Date.now(),
    };

    const step = config.stepSize;
    const speedMs = config.scanSpeed === 'slow' ? 200 : config.scanSpeed === 'fast' ? 30 : 80;

    this.scanInterval = setInterval(() => {
      // Simulate scanning with occasional signal hits
      if (this.state.scanDirection === 'up') {
        this.state.currentFrequency += step;
        if (this.state.currentFrequency >= config.endFrequency) {
          this.state.scanDirection = 'down';
        }
      } else {
        this.state.currentFrequency -= step;
        if (this.state.currentFrequency <= config.startFrequency) {
          this.state.scanDirection = 'up';
        }
      }

      // Check priority channels first
      const priorityHit = this.checkPriorityChannels();
      if (priorityHit) {
        this.handleSignalDetected(priorityHit.frequency, priorityHit.mode, -60 + Math.random() * 30);
        return;
      }

      // Simulate random signal detection
      const noiseFloor = -110 + Math.random() * 10;
      const hasSignal = Math.random() < 0.02; // 2% chance per step
      const strength = hasSignal ? -80 + Math.random() * 40 : noiseFloor;

      this.state.signalStrength = strength;
      this.state.scannedCount++;

      if (strength > config.squelchThreshold) {
        this.state.signalDetected = true;
        this.state.hitCount++;
        this.handleSignalDetected(this.state.currentFrequency, config.mode, strength);
      } else {
        this.state.signalDetected = false;
      }

      this.emit('scan_update', this.state);
    }, speedMs);

    this.emit('scan_started', this.state);
  }

  stopScan() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.state.active = false;
    this.emit('scan_stopped', this.state);
  }

  private handleSignalDetected(frequency: number, mode: string, strength: number) {
    const activity: ScanActivity = {
      id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      frequency, mode, timestamp: Date.now(),
      duration: 0, signalStrength: strength,
    };
    this.activities.push(activity);
    if (this.activities.length > this.maxActivities) this.activities.shift();
    this.emit('signal_detected', activity);
  }

  private checkPriorityChannels(): ScanListEntry | null {
    const priorities = Array.from(this.scanList.values()).filter(e => e.priority);
    if (priorities.length === 0) return null;
    // Randomly check a priority channel (simulated)
    if (Math.random() < 0.005) {
      return priorities[Math.floor(Math.random() * priorities.length)];
    }
    return null;
  }

  private getDefaultConfig(): ScanConfig {
    return {
      id: 'default', name: 'Default Scan',
      startFrequency: 87.5e6, endFrequency: 108e6,
      stepSize: 100e3, mode: 'fm', squelchThreshold: -90,
      dwellTime: 100, scanSpeed: 'normal', resumeDelay: 2000, active: true,
    };
  }

  // Config management
  addConfig(config: Omit<ScanConfig, 'id'>): ScanConfig {
    const c = { ...config, id: `cfg-${Date.now()}` };
    this.configs.set(c.id, c);
    return c;
  }

  getConfigs(): ScanConfig[] { return Array.from(this.configs.values()); }
  deleteConfig(id: string) { this.configs.delete(id); }

  // Scan list management
  addToScanList(entry: Omit<ScanListEntry, 'id' | 'hitCount'>): ScanListEntry {
    const e = { ...entry, id: `sl-${Date.now()}`, hitCount: 0 };
    this.scanList.set(e.id, e);
    return e;
  }

  getScanList(): ScanListEntry[] { return Array.from(this.scanList.values()); }
  removeFromScanList(id: string) { this.scanList.delete(id); }
  togglePriority(id: string) {
    const e = this.scanList.get(id);
    if (e) e.priority = !e.priority;
  }

  getActivities(limit = 100): ScanActivity[] { return this.activities.slice(-limit); }
  getState(): ScannerState { return { ...this.state }; }
}
