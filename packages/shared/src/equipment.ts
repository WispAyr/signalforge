// Phase 8: Equipment Manager types

export type SDRHardwareType = 'rtlsdr' | 'hackrf' | 'airspy' | 'sdrplay' | 'limesdr' | 'usrp' | 'kiwisdr';

export interface SDRHardware {
  id: SDRHardwareType;
  name: string;
  manufacturer: string;
  frequencyRange: [number, number]; // Hz
  maxBandwidthHz: number;
  bitsADC: number;
  txCapable: boolean;
  price: string;
  driverRequired: string;
  supportedDecoders: string[];
  features: string[];
  imageUrl?: string;
}

export interface UserEquipment {
  id: string;
  hardwareType: SDRHardwareType;
  nickname?: string;
  serialNumber?: string;
  antenna?: string;
  nodeId?: string; // linked edge node
  addedAt: number;
  notes?: string;
}

export interface CompatibilityEntry {
  decoder: string;
  hardware: SDRHardwareType[];
  minBandwidthHz: number;
  notes?: string;
}

export interface ShoppingListItem {
  hardware: SDRHardware;
  reason: string;
  requiredFor: string[];
}

export const SDR_DATABASE: SDRHardware[] = [
  { id: 'rtlsdr', name: 'RTL-SDR V3/V4', manufacturer: 'RTL-SDR Blog', frequencyRange: [500000, 1766000000], maxBandwidthHz: 2400000, bitsADC: 8, txCapable: false, price: '£25-35', driverRequired: 'rtl-sdr', supportedDecoders: ['adsb', 'acars', 'ais', 'aprs', 'fm', 'am', 'ssb', 'pocsag', 'rtl433', 'vdl2', 'apt', 'sstv', 'dmr'], features: ['Wideband RX', 'Direct sampling mode', 'Bias-T'] },
  { id: 'hackrf', name: 'HackRF One', manufacturer: 'Great Scott Gadgets', frequencyRange: [1000000, 6000000000], maxBandwidthHz: 20000000, bitsADC: 8, txCapable: true, price: '£200-300', driverRequired: 'hackrf', supportedDecoders: ['adsb', 'acars', 'ais', 'aprs', 'fm', 'am', 'ssb', 'pocsag', 'rtl433', 'vdl2', 'apt', 'sstv', 'dmr', 'lora', 'bluetooth', 'wifi'], features: ['TX capable', '1 MHz - 6 GHz', '20 MHz bandwidth', 'Portapack compatible'] },
  { id: 'airspy', name: 'Airspy R2 / Mini', manufacturer: 'Airspy', frequencyRange: [24000000, 1800000000], maxBandwidthHz: 10000000, bitsADC: 12, txCapable: false, price: '£150-200', driverRequired: 'airspy', supportedDecoders: ['adsb', 'acars', 'ais', 'aprs', 'fm', 'am', 'ssb', 'pocsag', 'vdl2', 'apt', 'dmr'], features: ['12-bit ADC', '10 MSPS', 'Low noise', 'Excellent dynamic range'] },
  { id: 'sdrplay', name: 'SDRplay RSPdx', manufacturer: 'SDRplay', frequencyRange: [1000, 2000000000], maxBandwidthHz: 10000000, bitsADC: 14, txCapable: false, price: '£200-250', driverRequired: 'sdrplay', supportedDecoders: ['adsb', 'acars', 'ais', 'aprs', 'fm', 'am', 'ssb', 'pocsag', 'rtl433', 'vdl2', 'apt', 'sstv', 'dmr'], features: ['14-bit ADC', '1 kHz - 2 GHz', 'Multiple antenna ports', 'HDR mode'] },
  { id: 'limesdr', name: 'LimeSDR Mini 2.0', manufacturer: 'Lime Microsystems', frequencyRange: [10000000, 3500000000], maxBandwidthHz: 30720000, bitsADC: 12, txCapable: true, price: '£200-300', driverRequired: 'limesdr', supportedDecoders: ['adsb', 'acars', 'ais', 'aprs', 'fm', 'am', 'ssb', 'pocsag', 'lora', 'dmr'], features: ['Full duplex TX/RX', 'MIMO', 'Wide bandwidth', 'FPGA based'] },
  { id: 'usrp', name: 'Ettus USRP B210', manufacturer: 'Ettus Research', frequencyRange: [70000000, 6000000000], maxBandwidthHz: 56000000, bitsADC: 12, txCapable: true, price: '£1500+', driverRequired: 'uhd', supportedDecoders: ['adsb', 'acars', 'ais', 'aprs', 'fm', 'am', 'ssb', 'pocsag', 'lora', 'dmr', 'bluetooth', 'wifi'], features: ['Professional grade', '2x2 MIMO', '56 MHz bandwidth', 'Full duplex'] },
  { id: 'kiwisdr', name: 'KiwiSDR', manufacturer: 'KiwiSDR', frequencyRange: [10000, 30000000], maxBandwidthHz: 30000000, bitsADC: 14, txCapable: false, price: '£250-300', driverRequired: 'none (web)', supportedDecoders: ['am', 'ssb', 'fm', 'aprs', 'sstv'], features: ['Web-based', 'HF coverage', '14-bit ADC', 'GPS disciplined', 'Multi-user'] },
];
