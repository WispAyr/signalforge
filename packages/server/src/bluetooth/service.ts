// ============================================================================
// SignalForge — Bluetooth Scanner Service
// ============================================================================
import { EventEmitter } from 'events';
import type { BTDevice, BTDeviceType, TrackerType, BTSignalPoint, BTProximityAlert, BTConfig, BTStatus } from '@signalforge/shared';

const DEMO_NAMES = ['AirPods Pro', 'Galaxy Buds', 'Mi Band 7', 'Apple Watch', 'Tile Mate', 'AirTag', 'SmartTag', 'JBL Flip', 'Fitbit Charge', 'Garmin Venu'];
const TRACKER_PREFIXES: Record<string, TrackerType> = {
  'AirTag': 'airtag', 'Tile': 'tile', 'SmartTag': 'smarttag', 'Chipolo': 'chipolo',
};

function randomMac(): string {
  return Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':');
}

export class BluetoothService extends EventEmitter {
  private devices = new Map<string, BTDevice>();
  private alerts: BTProximityAlert[] = [];
  private config: BTConfig = {
    enabled: false, interface: 'hci0', ubertoothEnabled: false, scanInterval: 5000,
    trackerDetection: true, proximityThreshold: -60, locateMode: false, targetDevices: [],
  };
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getDevices(): BTDevice[] { return Array.from(this.devices.values()); }
  getDevice(id: string): BTDevice | undefined { return this.devices.get(id); }
  getAlerts(limit = 100): BTProximityAlert[] { return this.alerts.slice(0, limit); }
  acknowledgeAlert(id: string): boolean {
    const a = this.alerts.find(a => a.id === id);
    if (a) { a.acknowledged = true; return true; }
    return false;
  }

  getTrackers(): BTDevice[] { return Array.from(this.devices.values()).filter(d => d.trackerType !== 'none'); }

  setTarget(mac: string, isTarget: boolean) {
    const dev = this.devices.get(mac);
    if (dev) dev.isTarget = isTarget;
    if (isTarget && !this.config.targetDevices.includes(mac)) this.config.targetDevices.push(mac);
    if (!isTarget) this.config.targetDevices = this.config.targetDevices.filter(m => m !== mac);
  }

  getStatus(): BTStatus {
    return {
      scanning: this.config.enabled, deviceCount: this.devices.size,
      trackerCount: Array.from(this.devices.values()).filter(d => d.trackerType !== 'none').length,
      ubertoothConnected: this.config.ubertoothEnabled, locateActive: this.config.locateMode,
      config: this.config,
    };
  }

  getConfig(): BTConfig { return this.config; }
  updateConfig(cfg: Partial<BTConfig>): BTConfig { Object.assign(this.config, cfg); return this.config; }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    // Seed devices
    for (let i = 0; i < 12; i++) {
      const mac = randomMac();
      const name = DEMO_NAMES[i % DEMO_NAMES.length];
      let trackerType: TrackerType = 'none';
      for (const [prefix, type] of Object.entries(TRACKER_PREFIXES)) {
        if (name.includes(prefix)) { trackerType = type; break; }
      }
      const dev: BTDevice = {
        id: mac, mac, name, type: Math.random() > 0.3 ? 'ble' : 'classic',
        rssi: -40 - Math.random() * 50, manufacturer: name.split(' ')[0],
        trackerType, services: [], firstSeen: Date.now(), lastSeen: Date.now(),
        seenCount: 1, signalTrail: [], isTarget: false,
      };
      this.devices.set(mac, dev);
    }

    this.demoInterval = setInterval(() => {
      for (const dev of this.devices.values()) {
        dev.lastSeen = Date.now();
        dev.rssi += (Math.random() - 0.5) * 6;
        dev.rssi = Math.max(-100, Math.min(-20, dev.rssi));
        dev.seenCount++;
        if (this.config.locateMode) {
          const pt: BTSignalPoint = { timestamp: Date.now(), rssi: dev.rssi, latitude: 51.5 + (Math.random() - 0.5) * 0.01, longitude: -0.1 + (Math.random() - 0.5) * 0.01 };
          dev.signalTrail.push(pt);
          if (dev.signalTrail.length > 200) dev.signalTrail = dev.signalTrail.slice(-200);
        }
        // Proximity alert for trackers
        if (dev.trackerType !== 'none' && dev.rssi > this.config.proximityThreshold && this.config.trackerDetection) {
          if (Math.random() > 0.95) {
            const alert: BTProximityAlert = {
              id: `bta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              deviceId: dev.id, deviceName: dev.name || dev.mac,
              trackerType: dev.trackerType, rssi: dev.rssi,
              timestamp: Date.now(), acknowledged: false,
            };
            this.alerts.unshift(alert);
            if (this.alerts.length > 200) this.alerts = this.alerts.slice(0, 200);
            this.emit('proximity_alert', alert);
          }
        }
      }
      this.emit('update', this.getDevices());
    }, 5000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
