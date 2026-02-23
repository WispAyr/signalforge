import { EventEmitter } from 'events';
import type { DXSpot, DXClusterConfig, DXFilter, DXSpotAlert } from '@signalforge/shared';

export class DXClusterService extends EventEmitter {
  private config: DXClusterConfig = {
    connected: false,
    host: 'dxc.ww1r.com',
    port: 7300,
    callsign: 'SIGNALFORGE',
    filters: [],
  };
  private spots: DXSpot[] = [];
  private alerts: DXSpotAlert[] = [];
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  connect(host?: string, port?: number, callsign?: string): DXClusterConfig {
    if (host) this.config.host = host;
    if (port) this.config.port = port;
    if (callsign) this.config.callsign = callsign;
    this.config.connected = true;
    this.startDemo();
    this.emit('connected', this.config);
    return this.config;
  }

  disconnect(): DXClusterConfig {
    this.config.connected = false;
    this.stopDemo();
    this.emit('disconnected');
    return this.config;
  }

  getConfig(): DXClusterConfig { return this.config; }
  getSpots(limit = 100): DXSpot[] { return this.spots.slice(0, limit); }
  getAlerts(): DXSpotAlert[] { return this.alerts; }

  addFilter(filter: Omit<DXFilter, 'id'>): DXFilter {
    const f: DXFilter = { ...filter, id: `df-${Date.now()}` };
    this.config.filters.push(f);
    return f;
  }

  removeFilter(id: string) {
    this.config.filters = this.config.filters.filter(f => f.id !== id);
  }

  addAlert(alert: Omit<DXSpotAlert, 'id'>): DXSpotAlert {
    const a: DXSpotAlert = { ...alert, id: `da-${Date.now()}` };
    this.alerts.push(a);
    return a;
  }

  removeAlert(id: string) {
    this.alerts = this.alerts.filter(a => a.id !== id);
  }

  private startDemo() {
    if (this.demoInterval) return;
    const spotters = ['G4ABC', 'DL1XYZ', 'W1AW', 'JA1ABC', 'VK2DEF', 'ZL1GHI', 'F5JKL', 'I2MNO'];
    const spotted = ['3B8CF', 'VP8LP', 'ZD7BG', 'A71A', 'JY5HX', 'P29VCX', 'V51WH', 'T32AZ', 'KH1/K7A', 'ZS8Z'];
    const entities = ['Mauritius', 'Falkland Is.', 'St Helena', 'Qatar', 'Jordan', 'Papua New Guinea', 'Namibia', 'Kiribati', 'Baker Howland Is.', 'Prince Edward & Marion Is.'];
    const continents = ['AF', 'SA', 'AF', 'AS', 'AS', 'OC', 'AF', 'OC', 'OC', 'AF'];
    const bands = [1.8, 3.5, 7.0, 10.1, 14.0, 18.068, 21.0, 24.89, 28.0, 50.0];
    const modes = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY'];

    this.demoInterval = setInterval(() => {
      if (!this.config.connected) return;
      const idx = Math.floor(Math.random() * spotted.length);
      const bandIdx = Math.floor(Math.random() * bands.length);
      const freq = bands[bandIdx] + Math.random() * 0.3;

      const spot: DXSpot = {
        id: `dx-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        spotter: spotters[Math.floor(Math.random() * spotters.length)],
        spotted: spotted[idx],
        frequency: freq * 1e6,
        mode: modes[Math.floor(Math.random() * modes.length)],
        comment: `${Math.floor(-50 - Math.random() * 30)} dB ${Math.floor(15 + Math.random() * 20)} WPM`,
        timestamp: Date.now(),
        entity: entities[idx],
        continent: continents[idx],
        cqZone: Math.floor(Math.random() * 40) + 1,
        ituZone: Math.floor(Math.random() * 75) + 1,
        isRare: Math.random() > 0.7,
      };

      this.spots.unshift(spot);
      if (this.spots.length > 1000) this.spots.length = 1000;

      // Check alerts
      for (const alert of this.alerts) {
        if (!alert.enabled) continue;
        if (alert.conditions.entities?.includes(spot.entity || '')) {
          this.emit('spot_alert', { alert, spot });
        }
        if (alert.conditions.callsignPatterns?.some(p => spot.spotted.includes(p))) {
          this.emit('spot_alert', { alert, spot });
        }
      }

      this.emit('spot', spot);
    }, 8000);
  }

  private stopDemo() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
  }
}
