import EventEmitter from 'events';
import type { SDRHardware, UserEquipment, CompatibilityEntry, ShoppingListItem, SDRHardwareType } from '@signalforge/shared';
import { SDR_DATABASE } from '@signalforge/shared';

export class EquipmentService extends EventEmitter {
  private userEquipment: UserEquipment[] = [];
  private compatibility: CompatibilityEntry[] = [];

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
        // Recommend cheapest compatible hardware
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
