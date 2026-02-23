import EventEmitter from 'events';
import type { Narration, NarrationRequest, NarratorConfig } from '@signalforge/shared';

export class NarratorService extends EventEmitter {
  private narrations: Narration[] = [];
  private config: NarratorConfig = {
    enabled: true,
    autoNarrate: false,
    autoNarrateIntervalMs: 30000,
    anomalyThreshold: 0.7,
    maxNarrations: 200,
  };

  // Signal database for narrative context
  private readonly knownBands: Array<{ startHz: number; endHz: number; name: string; usage: string }> = [
    { startHz: 87500000, endHz: 108000000, name: 'FM Broadcast', usage: 'Commercial FM radio stations' },
    { startHz: 118000000, endHz: 137000000, name: 'Airband', usage: 'Aviation communications — ATC, ATIS, VOLMET, ACARS' },
    { startHz: 144000000, endHz: 146000000, name: '2m Amateur', usage: 'Amateur radio VHF band — FM repeaters, SSB, packet' },
    { startHz: 156000000, endHz: 162000000, name: 'Marine VHF', usage: 'Maritime communications — Ch16 distress, ship-to-shore' },
    { startHz: 162400000, endHz: 162550000, name: 'NOAA Weather', usage: 'NOAA Weather Radio — continuous weather broadcasts' },
    { startHz: 430000000, endHz: 440000000, name: '70cm Amateur', usage: 'Amateur radio UHF band — FM, DMR, D-STAR, C4FM repeaters' },
    { startHz: 433050000, endHz: 434790000, name: 'ISM 433', usage: 'ISM band — wireless sensors, keyfobs, weather stations, IoT devices' },
    { startHz: 462562500, endHz: 467712500, name: 'FRS/GMRS', usage: 'Family Radio Service / General Mobile Radio Service' },
    { startHz: 868000000, endHz: 868600000, name: 'ISM 868', usage: 'European ISM band — LoRa, smart meters, alarms' },
    { startHz: 935000000, endHz: 960000000, name: 'GSM 900 DL', usage: 'GSM 900 MHz downlink — mobile phone base stations' },
    { startHz: 1090000000, endHz: 1090000000, name: 'ADS-B', usage: 'Aircraft transponder — position, altitude, callsign' },
    { startHz: 1575420000, endHz: 1575420000, name: 'GPS L1', usage: 'GPS navigation satellite signal' },
    { startHz: 137000000, endHz: 138000000, name: 'NOAA/Meteor Sat', usage: 'Weather satellite downlinks — NOAA APT, Meteor LRPT' },
    { startHz: 145800000, endHz: 145800000, name: 'ISS APRS', usage: 'International Space Station APRS digipeater' },
    { startHz: 1544000000, endHz: 1545000000, name: 'Inmarsat', usage: 'Inmarsat satellite communications' },
  ];

  constructor() {
    super();
  }

  narrate(request: NarrationRequest): Narration {
    const band = this.knownBands.find(b => request.frequencyHz >= b.startHz && request.frequencyHz <= b.endHz);
    const freqStr = this.formatFrequency(request.frequencyHz);
    let text = '';
    let isAnomaly = false;
    const tags: string[] = [];

    if (band) {
      tags.push(band.name);
      text = this.generateKnownBandNarration(request, band, freqStr);
    } else {
      text = this.generateUnknownNarration(request, freqStr);
    }

    if (request.classifierResult) {
      tags.push(request.classifierResult);
      text += ` Signal classifier identifies this as ${request.classifierResult}.`;
    }

    if (request.decoderOutput) {
      text += ` Decoder output: ${request.decoderOutput}`;
    }

    if (request.signalStrengthDbm) {
      const strength = request.signalStrengthDbm;
      if (strength > -30) text += ' Extremely strong signal — likely a very nearby transmitter.';
      else if (strength > -60) text += ' Strong signal — transmitter within a few kilometres.';
      else if (strength > -90) text += ' Moderate signal strength.';
      else text += ' Weak signal — distant or obstructed transmitter.';
    }

    // Anomaly check
    if (!band && request.signalStrengthDbm && request.signalStrengthDbm > -70) {
      isAnomaly = true;
      text += ' ⚠️ This is an unidentified signal with notable strength — worth investigating.';
    }

    const narration: Narration = {
      id: `nar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      frequencyHz: request.frequencyHz,
      text,
      timestamp: Date.now(),
      confidence: band ? 0.85 : 0.4,
      tags,
      isAnomaly,
    };

    this.narrations.unshift(narration);
    if (this.narrations.length > this.config.maxNarrations) {
      this.narrations = this.narrations.slice(0, this.config.maxNarrations);
    }

    this.emit('narration', narration);
    return narration;
  }

  private generateKnownBandNarration(req: NarrationRequest, band: { name: string; usage: string }, freqStr: string): string {
    const intros = [
      `You're tuned to ${freqStr}, within the ${band.name} allocation.`,
      `At ${freqStr}, you're in the ${band.name} band.`,
      `Frequency ${freqStr} falls within ${band.name}.`,
    ];
    const intro = intros[Math.floor(Math.random() * intros.length)];
    return `${intro} ${band.usage}.${req.mode ? ` Mode: ${req.mode}.` : ''}`;
  }

  private generateUnknownNarration(req: NarrationRequest, freqStr: string): string {
    return `You're tuned to ${freqStr}${req.mode ? ` in ${req.mode} mode` : ''}. This frequency doesn't match a well-known allocation in the database — could be a utility station, unlicensed transmitter, or intermodulation product.`;
  }

  private formatFrequency(hz: number): string {
    if (hz >= 1000000000) return `${(hz / 1000000000).toFixed(3)} GHz`;
    if (hz >= 1000000) return `${(hz / 1000000).toFixed(3)} MHz`;
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
    return `${hz} Hz`;
  }

  getNarrations(limit = 50): Narration[] { return this.narrations.slice(0, limit); }
  getConfig(): NarratorConfig { return { ...this.config }; }
  updateConfig(partial: Partial<NarratorConfig>): NarratorConfig {
    Object.assign(this.config, partial);
    return this.config;
  }
}
