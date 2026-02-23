// ============================================================================
// SignalForge — WiFi Scanner Service
// ============================================================================
import { EventEmitter } from 'events';
import type { WiFiAP, WiFiClient, WiFiDeauthEvent, WiFiChannelUtil, WiFiConfig, WiFiStatus } from '@signalforge/shared';

const DEMO_SSIDS = ['SKY-ROUTER-A1B2', 'BT-Hub6-XYZ', 'NETGEAR-5G', 'virginmedia123', 'EE-Hub-abc', 'TP-Link_Guest', 'IoT_Network', 'Hidden_Network', 'CoffeeShopFree', 'Neighbours_WiFi'];
const DEMO_VENDORS = ['Intel', 'Apple', 'Samsung', 'Qualcomm', 'Broadcom', 'MediaTek', 'Realtek'];

function randomMac(): string {
  return Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':');
}

export class WiFiService extends EventEmitter {
  private aps = new Map<string, WiFiAP>();
  private deauthEvents: WiFiDeauthEvent[] = [];
  private config: WiFiConfig = {
    enabled: false, interface: 'wlan0', channelHop: true, hopInterval: 500,
    channels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 36, 40, 44, 48], monitorDeauth: true,
  };
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getAPs(): WiFiAP[] { return Array.from(this.aps.values()); }
  getAP(bssid: string): WiFiAP | undefined { return this.aps.get(bssid); }
  getDeauthEvents(limit = 100): WiFiDeauthEvent[] { return this.deauthEvents.slice(0, limit); }

  getChannelUtilization(): WiFiChannelUtil[] {
    const channels = new Map<number, { aps: number; totalSignal: number }>();
    for (const ap of this.aps.values()) {
      const entry = channels.get(ap.channel) || { aps: 0, totalSignal: 0 };
      entry.aps++;
      entry.totalSignal += ap.signalStrength;
      channels.set(ap.channel, entry);
    }
    return Array.from(channels.entries()).map(([ch, data]) => ({
      channel: ch, frequency: ch <= 14 ? 2407 + ch * 5 : 5000 + ch * 5,
      utilization: Math.min(100, data.aps * 15 + Math.random() * 20),
      apCount: data.aps, noiseFloor: -90 + Math.random() * 10,
    }));
  }

  getStatus(): WiFiStatus {
    let clientCount = 0;
    for (const ap of this.aps.values()) clientCount += ap.clients.length;
    return {
      scanning: this.config.enabled, interface: this.config.interface,
      monitorMode: this.config.enabled, apCount: this.aps.size,
      clientCount, deauthEvents: this.deauthEvents.length, config: this.config,
    };
  }

  getConfig(): WiFiConfig { return this.config; }
  updateConfig(cfg: Partial<WiFiConfig>): WiFiConfig { Object.assign(this.config, cfg); return this.config; }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    // Seed initial APs
    for (let i = 0; i < 8; i++) {
      const bssid = randomMac();
      const ch = [1, 6, 11, 36, 44][Math.floor(Math.random() * 5)];
      const ap: WiFiAP = {
        bssid, ssid: DEMO_SSIDS[i % DEMO_SSIDS.length], channel: ch,
        frequency: ch <= 14 ? 2407 + ch * 5 : 5000 + ch * 5,
        signalStrength: -30 - Math.random() * 50,
        encryption: (['WPA2', 'WPA3', 'WPA2-Enterprise', 'OPEN'] as const)[Math.floor(Math.random() * 4)],
        manufacturer: DEMO_VENDORS[Math.floor(Math.random() * DEMO_VENDORS.length)],
        firstSeen: Date.now(), lastSeen: Date.now(), clients: [],
        beaconCount: Math.floor(Math.random() * 10000), dataFrames: Math.floor(Math.random() * 5000),
      };
      // Add some clients
      const numClients = Math.floor(Math.random() * 5);
      for (let j = 0; j < numClients; j++) {
        ap.clients.push({
          mac: randomMac(), signalStrength: -40 - Math.random() * 40,
          firstSeen: Date.now(), lastSeen: Date.now(), dataFrames: Math.floor(Math.random() * 1000),
          manufacturer: DEMO_VENDORS[Math.floor(Math.random() * DEMO_VENDORS.length)],
          probeRequests: Math.random() > 0.5 ? [DEMO_SSIDS[Math.floor(Math.random() * DEMO_SSIDS.length)]] : [],
        });
      }
      this.aps.set(bssid, ap);
    }

    this.demoInterval = setInterval(() => {
      // Update existing APs
      for (const ap of this.aps.values()) {
        ap.lastSeen = Date.now();
        ap.signalStrength += (Math.random() - 0.5) * 4;
        ap.beaconCount += Math.floor(Math.random() * 10);
        ap.dataFrames += Math.floor(Math.random() * 5);
        for (const c of ap.clients) {
          c.lastSeen = Date.now();
          c.signalStrength += (Math.random() - 0.5) * 3;
          c.dataFrames += Math.floor(Math.random() * 3);
        }
      }
      this.emit('update', this.getAPs());

      // Occasional deauth
      if (Math.random() > 0.9) {
        const aps = Array.from(this.aps.values());
        const ap = aps[Math.floor(Math.random() * aps.length)];
        const evt: WiFiDeauthEvent = {
          id: `da-${Date.now()}`, timestamp: Date.now(),
          sourceMac: randomMac(), targetMac: ap.clients[0]?.mac || 'ff:ff:ff:ff:ff:ff',
          bssid: ap.bssid, reason: 7, count: Math.floor(Math.random() * 10) + 1,
        };
        this.deauthEvents.unshift(evt);
        if (this.deauthEvents.length > 500) this.deauthEvents = this.deauthEvents.slice(0, 500);
        this.emit('deauth', evt);
      }
    }, 4000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
