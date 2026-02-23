// ============================================================================
// SignalForge Signal Database Types
// ============================================================================

export interface SignalEntry {
  id: string;
  name: string;
  frequency: number;      // Hz
  bandwidth?: number;      // Hz
  mode: string;            // FM, AM, SSB, digital, etc.
  category: SignalCategory;
  description: string;
  country?: string;
  active: boolean;
  notes?: string;
}

export type SignalCategory =
  | 'broadcast'
  | 'aviation'
  | 'maritime'
  | 'amateur'
  | 'satellite'
  | 'weather'
  | 'utility'
  | 'iot'
  | 'military'
  | 'emergency'
  | 'pmr';

export interface Bookmark {
  id: string;
  name: string;
  frequency: number;
  mode?: string;
  category?: string;
  notes?: string;
  created: string;
}

export interface Recording {
  id: string;
  filename: string;
  frequency: number;
  mode?: string;
  sampleRate?: number;
  duration: number;        // seconds
  size: number;            // bytes
  format: 'iq' | 'wav' | 'raw';
  metadata: {
    startTime: string;
    location?: { latitude: number; longitude: number; altitude: number };
    decoded?: string;
    notes?: string;
  };
  created: string;
}

export interface NotificationConfig {
  id: string;
  type: 'satellite_pass' | 'aircraft_detected' | 'signal_detected' | 'frequency_active';
  enabled: boolean;
  params: Record<string, unknown>;
  label: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  data?: Record<string, unknown>;
}

// ============================================================================
// Built-in Signal Database
// ============================================================================

export const SIGNAL_DATABASE: SignalEntry[] = [
  // FM Broadcast
  { id: 'fm-broadcast', name: 'FM Broadcast Band', frequency: 98e6, bandwidth: 20e6, mode: 'WFM', category: 'broadcast', description: 'Commercial FM radio (87.5-108 MHz)', active: true },

  // Airband
  { id: 'airband-guard', name: 'Aviation Guard', frequency: 121.5e6, bandwidth: 25e3, mode: 'AM', category: 'aviation', description: 'International aviation emergency frequency', active: true },
  { id: 'airband-atis', name: 'ATIS (typical)', frequency: 127.85e6, bandwidth: 25e3, mode: 'AM', category: 'aviation', description: 'Automatic Terminal Information Service', active: true },
  { id: 'adsb-1090', name: 'ADS-B', frequency: 1090e6, bandwidth: 2e6, mode: 'Pulse', category: 'aviation', description: 'Mode S / ADS-B aircraft transponder', active: true },
  { id: 'acars', name: 'ACARS', frequency: 131.55e6, bandwidth: 25e3, mode: 'AM/MSK', category: 'aviation', description: 'Aircraft Communications Addressing and Reporting System', active: true },

  // Maritime
  { id: 'marine-ch16', name: 'Marine Ch 16', frequency: 156.8e6, bandwidth: 25e3, mode: 'NFM', category: 'maritime', description: 'International maritime distress & calling', active: true },
  { id: 'ais-a', name: 'AIS Channel A', frequency: 161.975e6, bandwidth: 25e3, mode: 'GMSK', category: 'maritime', description: 'Automatic Identification System', active: true },
  { id: 'ais-b', name: 'AIS Channel B', frequency: 162.025e6, bandwidth: 25e3, mode: 'GMSK', category: 'maritime', description: 'Automatic Identification System', active: true },

  // Amateur Radio
  { id: 'ham-2m', name: '2m FM Calling', frequency: 145.5e6, bandwidth: 12.5e3, mode: 'NFM', category: 'amateur', description: 'UK 2m FM calling frequency', active: true },
  { id: 'ham-70cm', name: '70cm FM Calling', frequency: 433.5e6, bandwidth: 12.5e3, mode: 'NFM', category: 'amateur', description: 'UK 70cm FM calling frequency', active: true },
  { id: 'aprs-uk', name: 'APRS (UK/EU)', frequency: 144.8e6, bandwidth: 12.5e3, mode: 'AFSK', category: 'amateur', description: 'Automatic Packet Reporting System', active: true },
  { id: 'ham-hf-20m', name: '20m SSB', frequency: 14.2e6, bandwidth: 2.8e3, mode: 'USB', category: 'amateur', description: 'HF DX band — most popular worldwide', active: true },
  { id: 'ham-hf-40m', name: '40m SSB', frequency: 7.1e6, bandwidth: 2.8e3, mode: 'LSB', category: 'amateur', description: 'HF regional/continental band', active: true },
  { id: 'ft8-20m', name: 'FT8 20m', frequency: 14.074e6, bandwidth: 3e3, mode: 'FT8', category: 'amateur', description: 'FT8 digital mode — very popular for DX', active: true },

  // Satellites
  { id: 'iss-voice', name: 'ISS Voice', frequency: 145.8e6, bandwidth: 12.5e3, mode: 'NFM', category: 'satellite', description: 'ISS amateur radio voice downlink', active: true },
  { id: 'iss-aprs', name: 'ISS APRS', frequency: 145.825e6, bandwidth: 12.5e3, mode: 'AFSK', category: 'satellite', description: 'ISS APRS packet radio digipeater', active: true },
  { id: 'noaa-15', name: 'NOAA 15 APT', frequency: 137.62e6, bandwidth: 40e3, mode: 'APT', category: 'satellite', description: 'Weather satellite image downlink', active: true },
  { id: 'noaa-18', name: 'NOAA 18 APT', frequency: 137.9125e6, bandwidth: 40e3, mode: 'APT', category: 'satellite', description: 'Weather satellite image downlink', active: true },
  { id: 'noaa-19', name: 'NOAA 19 APT', frequency: 137.1e6, bandwidth: 40e3, mode: 'APT', category: 'satellite', description: 'Weather satellite image downlink', active: true },
  { id: 'meteor-m2', name: 'METEOR-M2 LRPT', frequency: 137.1e6, bandwidth: 150e3, mode: 'QPSK', category: 'satellite', description: 'Russian weather satellite LRPT downlink', active: true },

  // PMR / License-free
  { id: 'pmr446', name: 'PMR446', frequency: 446.00625e6, bandwidth: 12.5e3, mode: 'NFM', category: 'pmr', description: 'European license-free PMR radio (Ch 1)', active: true },

  // Utility
  { id: 'time-msf', name: 'MSF Time Signal', frequency: 60e3, bandwidth: 1e3, mode: 'OOK', category: 'utility', description: 'UK national time signal from Anthorn', active: true },
  { id: 'time-dcf77', name: 'DCF77 Time Signal', frequency: 77.5e3, bandwidth: 1e3, mode: 'OOK', category: 'utility', description: 'German time signal', active: true },

  // Weather
  { id: 'navtex-518', name: 'NAVTEX', frequency: 518e3, bandwidth: 500, mode: 'SITOR-B', category: 'weather', description: 'Maritime weather & navigation warnings', active: true },

  // IoT
  { id: 'lorawan-eu', name: 'LoRaWAN EU', frequency: 868e6, bandwidth: 125e3, mode: 'LoRa', category: 'iot', description: 'European LoRaWAN ISM band', active: true },
  { id: 'meshtastic', name: 'Meshtastic', frequency: 869.525e6, bandwidth: 250e3, mode: 'LoRa', category: 'iot', description: 'Off-grid mesh networking', active: true },

  // Emergency
  { id: 'sar-121', name: 'SAR 121.5 MHz', frequency: 121.5e6, bandwidth: 25e3, mode: 'AM', category: 'emergency', description: 'Search and Rescue homing frequency', active: true },
  { id: 'sar-243', name: 'SAR 243 MHz', frequency: 243e6, bandwidth: 25e3, mode: 'AM', category: 'emergency', description: 'Military SAR frequency', active: true },
];
