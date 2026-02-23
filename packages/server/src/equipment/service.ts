import EventEmitter from 'events';
import { execSync } from 'child_process';
import { platform } from 'os';
import type { SDRHardware, UserEquipment, CompatibilityEntry, ShoppingListItem, SDRHardwareType } from '@signalforge/shared';
import { SDR_DATABASE } from '@signalforge/shared';

// Known SDR USB VID:PID mappings
const SDR_USB_IDS: Record<string, { vid: string; pid: string; type: SDRHardwareType; name: string }[]> = {
  rtlsdr: [
    { vid: '0bda', pid: '2838', type: 'rtlsdr', name: 'RTL-SDR (RTL2838)' },
    { vid: '0bda', pid: '2832', type: 'rtlsdr', name: 'RTL-SDR (RTL2832)' },
  ],
  airspy: [
    { vid: '1d50', pid: '60a1', type: 'airspy' as SDRHardwareType, name: 'Airspy' },
  ],
  hackrf: [
    { vid: '1d50', pid: '6089', type: 'hackrf', name: 'HackRF One' },
  ],
  limesdr: [
    { vid: '0403', pid: '601f', type: 'limesdr' as SDRHardwareType, name: 'LimeSDR' },
  ],
};

const ALL_USB_IDS = Object.values(SDR_USB_IDS).flat();

export interface DetectedDevice {
  type: SDRHardwareType;
  name: string;
  vid: string;
  pid: string;
  detected: true;
  usbPath?: string;
}

export interface RunningService {
  name: string;
  pid: number;
  running: true;
}

export interface ScanResult {
  hardware: DetectedDevice[];
  services: RunningService[];
  timestamp: number;
}

export class EquipmentService extends EventEmitter {
  private userEquipment: UserEquipment[] = [];
  private compatibility: CompatibilityEntry[] = [];
  private lastScan: ScanResult | null = null;

  constructor() {
    super();
    this.loadCompatibility();
  }

  private loadCompatibility() {
    this.compatibility = [
      { decoder: 'adsb', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay', 'limesdr', 'usrp'], minBandwidthHz: 2000000, notes: 'RTL-SDR is the most popular choice for ADS-B' },
      { decoder: 'acars', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay', 'limesdr', 'usrp'], minBandwidthHz: 200000 },
      { decoder: 'ais', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay', 'limesdr', 'usrp'], minBandwidthHz: 48000, notes: 'Dual-channel requires 2 MHz+ bandwidth' },
      { decoder: 'aprs', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay', 'limesdr', 'usrp'], minBandwidthHz: 24000 },
      { decoder: 'apt', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay', 'limesdr', 'usrp'], minBandwidthHz: 48000, notes: 'V-dipole or QFH antenna recommended' },
      { decoder: 'dmr', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay', 'limesdr', 'usrp'], minBandwidthHz: 12500 },
      { decoder: 'lora', hardware: ['hackrf', 'limesdr', 'usrp'], minBandwidthHz: 500000, notes: 'Needs wideband RX — RTL-SDR may struggle' },
      { decoder: 'bluetooth', hardware: ['hackrf', 'usrp'], minBandwidthHz: 2000000, notes: 'Requires 2.4 GHz coverage' },
      { decoder: 'wifi', hardware: ['hackrf', 'usrp'], minBandwidthHz: 20000000, notes: 'Requires wide bandwidth at 2.4/5 GHz' },
      { decoder: 'rtl433', hardware: ['rtlsdr', 'hackrf', 'airspy', 'sdrplay'], minBandwidthHz: 250000 },
    ];
  }

  /**
   * Scan for connected USB SDR devices
   */
  scanHardware(): DetectedDevice[] {
    const detected: DetectedDevice[] = [];
    const os = platform();

    try {
      if (os === 'darwin') {
        // macOS: use system_profiler
        const output = execSync('system_profiler SPUSBDataType 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        for (const entry of ALL_USB_IDS) {
          // system_profiler shows Vendor ID and Product ID in hex with 0x prefix
          const vidPattern = `0x${entry.vid}`;
          const pidPattern = `0x${entry.pid}`;
          if (output.toLowerCase().includes(vidPattern) && output.toLowerCase().includes(pidPattern)) {
            detected.push({ type: entry.type, name: entry.name, vid: entry.vid, pid: entry.pid, detected: true });
          }
        }
      } else if (os === 'linux') {
        // Linux: use lsusb
        let output = '';
        try {
          output = execSync('lsusb 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        } catch {
          // Try reading /sys/bus/usb/devices
          try {
            const devs = execSync('cat /sys/bus/usb/devices/*/idVendor /sys/bus/usb/devices/*/idProduct 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
            output = devs;
          } catch {}
        }
        for (const entry of ALL_USB_IDS) {
          const pattern = `${entry.vid}:${entry.pid}`;
          if (output.toLowerCase().includes(pattern) || (output.includes(entry.vid) && output.includes(entry.pid))) {
            detected.push({ type: entry.type, name: entry.name, vid: entry.vid, pid: entry.pid, detected: true });
          }
        }
      }
    } catch (err) {
      console.error('USB scan error:', err);
    }

    return detected;
  }

  /**
   * Check for running SDR-related services/processes
   */
  scanServices(): RunningService[] {
    const services: RunningService[] = [];
    const processNames = ['rtl_tcp', 'SoapySDRServer', 'dump1090', 'dump1090-mutability', 'dump1090-fa', 'rtl_433', 'direwolf', 'rtl_ais'];

    try {
      for (const name of processNames) {
        try {
          const output = execSync(`pgrep -x "${name}" 2>/dev/null || pgrep -f "${name}" 2>/dev/null`, { encoding: 'utf8', timeout: 2000 });
          const pids = output.trim().split('\n').filter(Boolean);
          if (pids.length > 0) {
            services.push({ name, pid: parseInt(pids[0], 10), running: true });
          }
        } catch {
          // Process not found — normal
        }
      }
    } catch {}

    return services;
  }

  /**
   * Full scan: hardware + services
   */
  scan(): ScanResult {
    const result: ScanResult = {
      hardware: this.scanHardware(),
      services: this.scanServices(),
      timestamp: Date.now(),
    };
    this.lastScan = result;
    this.emit('scan', result);
    return result;
  }

  getLastScan(): ScanResult | null {
    return this.lastScan;
  }

  getHardwareDatabase(): SDRHardware[] { return SDR_DATABASE; }
  getHardware(id: SDRHardwareType): SDRHardware | undefined { return SDR_DATABASE.find(h => h.id === id); }

  getUserEquipment(): UserEquipment[] { return [...this.userEquipment]; }

  addEquipment(data: Omit<UserEquipment, 'id' | 'addedAt'>): UserEquipment {
    const eq: UserEquipment = { ...data, id: `eq-${Date.now()}`, addedAt: Date.now() };
    this.userEquipment.push(eq);
    this.emit('equipment-added', eq);
    return eq;
  }

  removeEquipment(id: string): boolean {
    const idx = this.userEquipment.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.userEquipment.splice(idx, 1);
    return true;
  }

  getCompatibility(): CompatibilityEntry[] { return [...this.compatibility]; }

  getCompatibleHardware(decoder: string): SDRHardware[] {
    const entry = this.compatibility.find(c => c.decoder === decoder);
    if (!entry) return SDR_DATABASE;
    return SDR_DATABASE.filter(h => entry.hardware.includes(h.id));
  }

  getShoppingList(desiredCapabilities: string[]): ShoppingListItem[] {
    const owned = new Set(this.userEquipment.map(e => e.hardwareType));
    const needed: ShoppingListItem[] = [];

    for (const cap of desiredCapabilities) {
      const compat = this.compatibility.find(c => c.decoder === cap);
      if (!compat) continue;
      const hasCompatible = compat.hardware.some(h => owned.has(h));
      if (!hasCompatible) {
        const options = SDR_DATABASE.filter(h => compat.hardware.includes(h.id)).sort((a, b) => parseInt(a.price.replace(/[^0-9]/g, '')) - parseInt(b.price.replace(/[^0-9]/g, '')));
        if (options.length) {
          const existing = needed.find(n => n.hardware.id === options[0].id);
          if (existing) existing.requiredFor.push(cap);
          else needed.push({ hardware: options[0], reason: `Required for ${cap} decoding`, requiredFor: [cap] });
        }
      }
    }
    return needed;
  }
}
