import EventEmitter from 'events';
import type { VDL2Message, VDL2Status } from '@signalforge/shared';

export class VDL2Service extends EventEmitter {
  private messages: VDL2Message[] = [];
  private connected = false;
  private messagesDecoded = 0;
  private uniqueAircraft = new Set<string>();
  private config = {
    enabled: true,
    frequency: 136975000,
    groundStations: ['LON', 'PAR', 'FRA'],
    logAll: true,
    acarsOnly: false,
  };

  constructor() {
    super();
  }

  startDemo() {
    this.connected = true;
    setInterval(() => this.generateDemoMessage(), 5000);
  }

  stopDemo() {
    this.connected = false;
  }

  private generateDemoMessage() {
    if (!this.connected) return;

    const acarsLabels = ['Q0', '15', 'H1', '5L', '10'];
    const callsigns = ['BAW123', 'AFR456', 'UAE789', 'DLH101', 'VIR234'];
    const registrations = ['G-EUNA', 'F-ABCD', 'A6-EOK', 'D-ABYT', 'N123US'];
    const flights = ['BA123', 'AF456', 'EK789', 'LH101', 'VS234'];
    const types = ['A320', 'B738', 'A350', 'B77W', 'A380'];
    const stations = ['LON', 'PAR', 'FRA', 'AMS', 'MAD'];

    const message: VDL2Message = {
      id: `vdl2-${Date.now()}`,
      timestamp: Date.now(),
      frequency: this.config.frequency,
      groundStation: stations[Math.floor(Math.random() * stations.length)],
      messageType: Math.random() > 0.7 ? 'ADS-C' : Math.random() > 0.5 ? 'CPDLC' : 'ACARS',
      callsign: callsigns[Math.floor(Math.random() * callsigns.length)],
      flightNumber: flights[Math.floor(Math.random() * flights.length)],
      registration: registrations[Math.floor(Math.random() * registrations.length)],
      aircraftType: types[Math.floor(Math.random() * types.length)],
      acarsLabel: acarsLabels[Math.floor(Math.random() * acarsLabels.length)],
      acarsText: Math.random() > 0.5 ? `POS RPT ${Math.floor(Math.random() * 1000)}N ${Math.floor(Math.random() * 1000)}W` : `ETA ${Math.floor(Math.random() * 24)}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}Z`,
      altitude: Math.random() > 0.3 ? 33000 + Math.floor(Math.random() * 5000) : undefined,
      latitude: Math.random() > 0.5 ? 51.5 + Math.random() * 5 : undefined,
      longitude: Math.random() > 0.5 ? -0.1 + Math.random() * 5 : undefined,
      speed: Math.random() > 0.4 ? 480 + Math.floor(Math.random() * 80) : undefined,
      heading: Math.random() > 0.4 ? Math.floor(Math.random() * 360) : undefined,
    };

    this.messages.unshift(message);
    this.messagesDecoded++;
    this.uniqueAircraft.add(message.registration || message.callsign || 'unknown');

    if (this.messages.length > 1000) this.messages.pop();

    this.emit('message', message);
  }

  getMessages(limit = 100): VDL2Message[] {
    return this.messages.slice(0, limit);
  }

  getStatus(): VDL2Status {
    return {
      connected: this.connected,
      messagesDecoded: this.messagesDecoded,
      uniqueAircraft: this.uniqueAircraft.size,
      acarsMessages: this.messages.filter(m => m.messageType === 'ACARS').length,
      lastMessage: this.messages[0]?.timestamp || null,
      config: this.config,
    };
  }

  getConfig() {
    return this.config;
  }

  updateConfig(newConfig: Partial<typeof this.config>) {
    this.config = { ...this.config, ...newConfig };
    return this.config;
  }
}