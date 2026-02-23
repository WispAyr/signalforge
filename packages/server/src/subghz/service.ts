// ============================================================================
// SignalForge — Sub-GHz Analyzer Service (HackRF)
// ============================================================================
import { EventEmitter } from 'events';
import type { SubGHzSignal, SubGHzSweepResult, SubGHzProtocolMatch, SubGHzDeviceType, HackRFConfig, SubGHzStatus } from '@signalforge/shared';

const KNOWN_PROTOCOLS: { freq: number; bw: number; protocol: string; device: SubGHzDeviceType; mod: string; desc: string }[] = [
  { freq: 315e6, bw: 200e3, protocol: 'ASK/OOK', device: 'garage_door', mod: 'OOK', desc: 'US garage doors, keyfobs' },
  { freq: 390e6, bw: 200e3, protocol: 'ASK/OOK', device: 'garage_door', mod: 'OOK', desc: 'US garage doors (Chamberlain)' },
  { freq: 433.92e6, bw: 500e3, protocol: 'ASK/OOK/FSK', device: 'remote_control', mod: 'OOK/FSK', desc: 'EU ISM band — remotes, weather stations' },
  { freq: 868e6, bw: 500e3, protocol: 'LoRa/FSK', device: 'remote_control', mod: 'FSK', desc: 'EU SRD band — IoT, alarms' },
  { freq: 915e6, bw: 500e3, protocol: 'LoRa/FSK', device: 'remote_control', mod: 'FSK', desc: 'US ISM band — IoT' },
];

export class SubGHzService extends EventEmitter {
  private signals: SubGHzSignal[] = [];
  private sweepResults: SubGHzSweepResult[] = [];
  private config: HackRFConfig = {
    enabled: false, mode: 'sweep', startFreq: 300e6, endFreq: 928e6,
    lnaGain: 32, vgaGain: 20, sampleRate: 20e6,
  };
  private replayDetections = 0;
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getSignals(limit = 100): SubGHzSignal[] { return this.signals.slice(0, limit); }
  getSweepResults(limit = 50): SubGHzSweepResult[] { return this.sweepResults.slice(0, limit); }

  identifyProtocol(frequency: number): SubGHzProtocolMatch[] {
    return KNOWN_PROTOCOLS.filter(p => Math.abs(p.freq - frequency) < p.bw)
      .map(p => ({
        protocol: p.protocol, confidence: 1 - Math.abs(p.freq - frequency) / p.bw,
        frequency: p.freq, modulation: p.mod, deviceType: p.device, description: p.desc,
      }));
  }

  getStatus(): SubGHzStatus {
    return {
      connected: this.config.enabled, sweeping: !!this.demoInterval,
      signalsDetected: this.signals.length, protocolsIdentified: this.signals.filter(s => s.protocol).length,
      replayAttemptsDetected: this.replayDetections, config: this.config,
    };
  }

  getConfig(): HackRFConfig { return this.config; }
  updateConfig(cfg: Partial<HackRFConfig>): HackRFConfig { Object.assign(this.config, cfg); return this.config; }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    this.demoInterval = setInterval(() => {
      // Generate sweep
      const numBins = 128;
      const powers = new Array(numBins).fill(0).map(() => -80 + Math.random() * 20);
      // Add some signals
      const sigBin = Math.floor(Math.random() * numBins);
      powers[sigBin] = -40 + Math.random() * 20;
      if (sigBin > 0) powers[sigBin - 1] = -50 + Math.random() * 10;
      if (sigBin < numBins - 1) powers[sigBin + 1] = -50 + Math.random() * 10;

      const sweep: SubGHzSweepResult = {
        timestamp: Date.now(), startFreq: this.config.startFreq, endFreq: this.config.endFreq,
        stepSize: (this.config.endFreq - this.config.startFreq) / numBins, powers,
        peakFrequency: this.config.startFreq + sigBin * ((this.config.endFreq - this.config.startFreq) / numBins),
        peakPower: powers[sigBin],
      };
      this.sweepResults.unshift(sweep);
      if (this.sweepResults.length > 200) this.sweepResults = this.sweepResults.slice(0, 200);
      this.emit('sweep', sweep);

      // Occasionally detect a signal
      if (Math.random() > 0.7) {
        const proto = KNOWN_PROTOCOLS[Math.floor(Math.random() * KNOWN_PROTOCOLS.length)];
        const isReplay = Math.random() > 0.9;
        const signal: SubGHzSignal = {
          id: `sg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(), frequency: proto.freq + (Math.random() - 0.5) * 100e3,
          bandwidth: 200e3, power: -30 - Math.random() * 30,
          protocol: proto.protocol, deviceType: proto.device, modulation: proto.mod,
          isReplay, replayCount: isReplay ? Math.floor(Math.random() * 5) + 2 : 0,
        };
        this.signals.unshift(signal);
        if (this.signals.length > 1000) this.signals = this.signals.slice(0, 1000);
        if (isReplay) this.replayDetections++;
        this.emit('signal', signal);
      }
    }, 3000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
