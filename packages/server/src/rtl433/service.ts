// ============================================================================
// SignalForge — rtl_433 IoT Sensor Decoder Service
// ============================================================================
import { EventEmitter } from 'events';
import type { ISMDevice, ISMReading, ISMDeviceType, RTL433Config, RTL433Status } from '@signalforge/shared';

const DEVICE_TYPE_MAP: Record<string, ISMDeviceType> = {
  'Acurite': 'weather_station', 'Oregon': 'weather_station', 'LaCrosse': 'weather_station',
  'Bresser': 'weather_station', 'Fine Offset': 'weather_station', 'Ambient Weather': 'weather_station',
  'TPMS': 'tpms', 'Toyota': 'tpms', 'Schrader': 'tpms', 'Citroen': 'tpms',
  'Honeywell': 'smoke_detector', 'GE': 'smoke_detector',
  'Ecowitt': 'soil_moisture',
  'Inkbird': 'pool_thermometer',
};

function detectDeviceType(model: string, protocol: string): ISMDeviceType {
  for (const [key, type] of Object.entries(DEVICE_TYPE_MAP)) {
    if (model.toLowerCase().includes(key.toLowerCase()) || protocol.toLowerCase().includes(key.toLowerCase())) return type;
  }
  if (model.includes('weather') || model.includes('temp') || model.includes('thermo')) return 'weather_station';
  if (model.includes('tire') || model.includes('tpms')) return 'tpms';
  if (model.includes('door') || model.includes('bell')) return 'doorbell';
  if (model.includes('smoke') || model.includes('fire')) return 'smoke_detector';
  if (model.includes('soil') || model.includes('moisture')) return 'soil_moisture';
  if (model.includes('pool')) return 'pool_thermometer';
  return 'unknown';
}

export class RTL433Service extends EventEmitter {
  private devices = new Map<string, ISMDevice>();
  private config: RTL433Config = {
    enabled: false, source: 'tcp', host: 'localhost', port: 1433, protocols: [], hopInterval: 0,
  };
  private messagesReceived = 0;
  private lastMessage = 0;
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  constructor() { super(); }

  getDevices(): ISMDevice[] { return Array.from(this.devices.values()); }
  getDevice(id: string): ISMDevice | undefined { return this.devices.get(id); }

  getStatus(): RTL433Status {
    return {
      connected: this.config.enabled,
      devicesDiscovered: this.devices.size,
      messagesReceived: this.messagesReceived,
      lastMessage: this.lastMessage,
      config: this.config,
    };
  }

  getConfig(): RTL433Config { return this.config; }
  updateConfig(cfg: Partial<RTL433Config>): RTL433Config {
    Object.assign(this.config, cfg);
    return this.config;
  }

  processMessage(data: Record<string, unknown>) {
    const model = String(data.model || 'Unknown');
    const protocol = String(data.protocol || '');
    const deviceId = data.id ? Number(data.id) : Math.floor(Math.random() * 65535);
    const channel = data.channel ? Number(data.channel) : undefined;
    const key = `${model}-${deviceId}-${channel || 0}`;

    const reading: ISMReading = {
      timestamp: Date.now(),
      temperature: data.temperature_C != null ? Number(data.temperature_C) : undefined,
      humidity: data.humidity != null ? Number(data.humidity) : undefined,
      pressure: data.pressure_hPa != null ? Number(data.pressure_hPa) : undefined,
      windSpeed: data.wind_avg_km_h != null ? Number(data.wind_avg_km_h) : undefined,
      windDirection: data.wind_dir_deg != null ? Number(data.wind_dir_deg) : undefined,
      rainfall: data.rain_mm != null ? Number(data.rain_mm) : undefined,
      battery: data.battery_ok != null ? String(data.battery_ok) : undefined,
      tirePressure: data.pressure_kPa != null ? Number(data.pressure_kPa) : undefined,
      tireTemperature: data.temperature_C != null && model.includes('TPMS') ? Number(data.temperature_C) : undefined,
      moisture: data.moisture != null ? Number(data.moisture) : undefined,
      uv: data.uv != null ? Number(data.uv) : undefined,
      raw: data,
    };

    let device = this.devices.get(key);
    if (!device) {
      device = {
        id: key, protocol, model, deviceType: detectDeviceType(model, protocol),
        deviceId, channel, firstSeen: Date.now(), lastSeen: Date.now(),
        readings: [], lastReading: null, rssi: data.rssi ? Number(data.rssi) : undefined,
      };
      this.devices.set(key, device);
    }

    device.lastSeen = Date.now();
    device.lastReading = reading;
    device.readings.push(reading);
    if (device.readings.length > 500) device.readings = device.readings.slice(-500);
    if (data.rssi) device.rssi = Number(data.rssi);

    this.messagesReceived++;
    this.lastMessage = Date.now();

    this.emit('device_update', device);
    this.emit('reading', { device, reading });
  }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    const demoDevices = [
      { model: 'Acurite-5n1', id: 1234, ch: 1, type: 'weather_station' as const },
      { model: 'Oregon-THR228N', id: 5678, ch: 2, type: 'weather_station' as const },
      { model: 'Schrader-TPMS', id: 9012, ch: undefined, type: 'tpms' as const },
      { model: 'LaCrosse-TX141', id: 3456, ch: 1, type: 'weather_station' as const },
      { model: 'Ecowitt-WH51', id: 7890, ch: 1, type: 'soil_moisture' as const },
      { model: 'Inkbird-IBS-P01R', id: 2345, ch: 1, type: 'pool_thermometer' as const },
    ];
    this.demoInterval = setInterval(() => {
      const dev = demoDevices[Math.floor(Math.random() * demoDevices.length)];
      const data: Record<string, unknown> = { model: dev.model, id: dev.id, channel: dev.ch, protocol: 'rtl_433' };
      if (dev.type === 'weather_station') {
        data.temperature_C = 15 + Math.random() * 15;
        data.humidity = 40 + Math.random() * 40;
        data.wind_avg_km_h = Math.random() * 30;
        data.wind_dir_deg = Math.random() * 360;
        data.rain_mm = Math.random() > 0.8 ? Math.random() * 5 : 0;
        data.battery_ok = 1;
      } else if (dev.type === 'tpms') {
        data.pressure_kPa = 220 + Math.random() * 40;
        data.temperature_C = 20 + Math.random() * 30;
      } else if (dev.type === 'soil_moisture') {
        data.moisture = 20 + Math.random() * 60;
        data.battery_ok = 1;
      } else if (dev.type === 'pool_thermometer') {
        data.temperature_C = 22 + Math.random() * 8;
      }
      data.rssi = -40 - Math.random() * 50;
      this.processMessage(data);
    }, 5000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
