import EventEmitter from 'events';
import type { Narration, NarrationRequest, NarratorConfig } from '@signalforge/shared';

interface RFState {
  activeFrequencies: Array<{ freq: number; mode: string; strength: number }>;
  decodedSignals: Array<{ type: string; data: Record<string, unknown> }>;
  satellitePasses: Array<{ name: string; maxElevation: number; aosTime: number; losTime: number }>;
  aprsStations: Array<{ callsign: string; lat: number; lon: number; speed: number; course: number; comment: string }>;
  adsbAircraft: Array<{ callsign: string; altitude: number; heading: number; speed: number }>;
  dxSpots: Array<{ dxCall: string; frequency: number; spotter: string; comment: string }>;
  classifiedSignals: Array<{ freq: number; classification: string; confidence: number; bandwidth: number }>;
}

export class NarratorService extends EventEmitter {
  private narrations: Narration[] = [];
  private currentNarration: string = 'SignalForge initialising — scanning the electromagnetic spectrum...';
  private config: NarratorConfig = {
    enabled: true,
    autoNarrate: true,
    autoNarrateIntervalMs: 10000,
    anomalyThreshold: 0.7,
    maxNarrations: 200,
  };
  private autoNarrateTimer: ReturnType<typeof setInterval> | null = null;
  private rfState: RFState = {
    activeFrequencies: [],
    decodedSignals: [],
    satellitePasses: [],
    aprsStations: [],
    adsbAircraft: [],
    dxSpots: [],
    classifiedSignals: [],
  };
  private ollamaAvailable: boolean | null = null;
  private readonly ollamaUrl = 'http://localhost:11434/api/generate';
  private readonly ollamaModel = 'llama3.1:8b';

  private readonly knownBands: Array<{ startHz: number; endHz: number; name: string; usage: string }> = [
    { startHz: 87500000, endHz: 108000000, name: 'FM Broadcast', usage: 'Commercial FM radio stations' },
    { startHz: 118000000, endHz: 137000000, name: 'Airband', usage: 'Aviation communications' },
    { startHz: 144000000, endHz: 146000000, name: '2m Amateur', usage: 'Amateur radio VHF band' },
    { startHz: 156000000, endHz: 162000000, name: 'Marine VHF', usage: 'Maritime communications' },
    { startHz: 162400000, endHz: 162550000, name: 'NOAA Weather', usage: 'NOAA Weather Radio' },
    { startHz: 430000000, endHz: 440000000, name: '70cm Amateur', usage: 'Amateur radio UHF band' },
    { startHz: 433050000, endHz: 434790000, name: 'ISM 433', usage: 'ISM band — wireless sensors, IoT' },
    { startHz: 446006250, endHz: 446193750, name: 'PMR446', usage: 'PMR446 licence-free radio' },
    { startHz: 462562500, endHz: 467712500, name: 'FRS/GMRS', usage: 'Family/General Mobile Radio' },
    { startHz: 868000000, endHz: 868600000, name: 'ISM 868', usage: 'European ISM — LoRa, smart meters' },
    { startHz: 935000000, endHz: 960000000, name: 'GSM 900 DL', usage: 'GSM mobile base stations' },
    { startHz: 1090000000, endHz: 1090000000, name: 'ADS-B', usage: 'Aircraft transponders' },
    { startHz: 137000000, endHz: 138000000, name: 'NOAA/Meteor Sat', usage: 'Weather satellite downlinks' },
    { startHz: 145800000, endHz: 145800000, name: 'ISS APRS', usage: 'ISS APRS digipeater' },
  ];

  constructor() {
    super();
    this.startAutoNarrate();
    this.checkOllama();
  }

  private async checkOllama(): Promise<void> {
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      this.ollamaAvailable = res.ok;
    } catch {
      this.ollamaAvailable = false;
    }
  }

  updateRFState(partial: Partial<RFState>): void {
    Object.assign(this.rfState, partial);
  }

  private startAutoNarrate(): void {
    if (this.autoNarrateTimer) clearInterval(this.autoNarrateTimer);
    this.autoNarrateTimer = setInterval(() => {
      if (!this.config.enabled || !this.config.autoNarrate) return;
      this.generateContextualNarration();
    }, this.config.autoNarrateIntervalMs);
  }

  private async generateContextualNarration(): Promise<void> {
    const text = this.ollamaAvailable
      ? await this.generateWithOllama().catch(() => this.generateFromTemplates())
      : this.generateFromTemplates();

    this.currentNarration = text;
    const narration: Narration = {
      id: `nar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      frequencyHz: this.rfState.activeFrequencies[0]?.freq || 0,
      text,
      timestamp: Date.now(),
      confidence: this.ollamaAvailable ? 0.9 : 0.75,
      tags: ['auto'],
      isAnomaly: false,
    };
    this.narrations.unshift(narration);
    if (this.narrations.length > this.config.maxNarrations) this.narrations = this.narrations.slice(0, this.config.maxNarrations);
    this.emit('narration', narration);
  }

  private async generateWithOllama(): Promise<string> {
    const stateDesc = this.buildStateDescription();
    const prompt = `You are an AI radio narrator for SignalForge, a software-defined radio application. You speak like a calm, knowledgeable radio operator providing commentary on RF activity. Be concise (2-3 sentences max). Use technical radio terminology naturally. Current RF environment:\n\n${stateDesc}\n\nProvide a brief, engaging narration of what's happening on the radio right now.`;

    const res = await fetch(this.ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.ollamaModel, prompt, stream: false, options: { temperature: 0.7, num_predict: 150 } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json() as { response: string };
    return data.response.trim();
  }

  private buildStateDescription(): string {
    const parts: string[] = [];
    const { activeFrequencies, adsbAircraft, satellitePasses, aprsStations, dxSpots, classifiedSignals } = this.rfState;

    if (activeFrequencies.length > 0) {
      parts.push(`Active frequencies: ${activeFrequencies.map(f => `${(f.freq / 1e6).toFixed(3)}MHz (${f.mode}, ${f.strength}dBm)`).join(', ')}`);
    }
    if (adsbAircraft.length > 0) {
      parts.push(`Aircraft visible: ${adsbAircraft.length}. Notable: ${adsbAircraft.slice(0, 3).map(a => `${a.callsign} FL${Math.round(a.altitude / 100)} hdg ${a.heading}°`).join('; ')}`);
    }
    if (satellitePasses.length > 0) {
      const upcoming = satellitePasses.filter(s => s.aosTime > Date.now()).sort((a, b) => a.aosTime - b.aosTime);
      if (upcoming.length > 0) {
        const next = upcoming[0];
        const minsAway = Math.round((next.aosTime - Date.now()) / 60000);
        parts.push(`Next satellite: ${next.name} in ${minsAway}min, max elevation ${next.maxElevation}°`);
      }
    }
    if (aprsStations.length > 0) {
      parts.push(`APRS stations: ${aprsStations.length}. Recent: ${aprsStations.slice(0, 2).map(a => `${a.callsign} at ${a.speed}km/h`).join(', ')}`);
    }
    if (dxSpots.length > 0) {
      parts.push(`DX spots: ${dxSpots.slice(0, 2).map(d => `${d.dxCall} on ${(d.frequency / 1e3).toFixed(1)}kHz by ${d.spotter}`).join('; ')}`);
    }
    if (classifiedSignals.length > 0) {
      parts.push(`Classified signals: ${classifiedSignals.map(s => `${s.classification} at ${(s.freq / 1e6).toFixed(3)}MHz (${Math.round(s.confidence * 100)}%)`).join(', ')}`);
    }
    return parts.join('\n') || 'No active RF sources detected. The band is quiet.';
  }

  private generateFromTemplates(): string {
    const templates: string[] = [];
    const { activeFrequencies, adsbAircraft, satellitePasses, aprsStations, dxSpots, classifiedSignals } = this.rfState;
    const now = Date.now();

    // Aircraft narration
    if (adsbAircraft.length > 0) {
      const count = adsbAircraft.length;
      const sample = adsbAircraft[Math.floor(Math.random() * adsbAircraft.length)];
      const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      const dir = dirs[Math.round(sample.heading / 45) % 8];
      templates.push(`Monitoring 1090MHz — ${count} aircraft visible. ${sample.callsign} at FL${Math.round(sample.altitude / 100)} heading ${dir} at ${sample.speed}kts.`);
    }

    // Satellite narration
    const upcoming = (satellitePasses || []).filter(s => s.aosTime > now).sort((a, b) => a.aosTime - b.aosTime);
    if (upcoming.length > 0) {
      const next = upcoming[0];
      const mins = Math.round((next.aosTime - now) / 60000);
      if (mins <= 30) {
        templates.push(`Satellite ${next.name} will be visible in ${mins} minutes, maximum elevation ${next.maxElevation}°. ${next.maxElevation > 45 ? 'Good pass — worth tracking.' : 'Low pass — marginal reception expected.'}`);
      }
    }

    // APRS narration
    if (aprsStations.length > 0) {
      const station = aprsStations[Math.floor(Math.random() * aprsStations.length)];
      const bearing = Math.round(station.course);
      templates.push(`APRS station ${station.callsign} reporting — ${station.speed > 0 ? `moving at ${station.speed}km/h heading ${bearing}°` : 'stationary'}. ${station.comment || ''}`);
    }

    // DX Cluster narration
    if (dxSpots.length > 0) {
      const spot = dxSpots[Math.floor(Math.random() * dxSpots.length)];
      templates.push(`DX Cluster: ${spot.dxCall} spotted on ${(spot.frequency / 1e3).toFixed(1)}kHz by ${spot.spotter}${spot.comment ? ` — ${spot.comment}` : ''}.`);
    }

    // Active frequency narration
    if (activeFrequencies.length > 0) {
      const f = activeFrequencies[0];
      const band = this.knownBands.find(b => f.freq >= b.startHz && f.freq <= b.endHz);
      if (band) {
        templates.push(`Tuned to ${(f.freq / 1e6).toFixed(3)}MHz in the ${band.name} allocation. ${band.usage}. Signal: ${f.strength > -60 ? 'strong' : f.strength > -90 ? 'moderate' : 'weak'} at ${f.strength}dBm.`);
      } else {
        templates.push(`Monitoring ${(f.freq / 1e6).toFixed(3)}MHz in ${f.mode} mode. Signal strength ${f.strength}dBm.`);
      }
    }

    // Classified signals
    if (classifiedSignals.length > 0) {
      const sig = classifiedSignals[Math.floor(Math.random() * classifiedSignals.length)];
      templates.push(`Signal classifier: ${sig.classification.toUpperCase()} signal detected at ${(sig.freq / 1e6).toFixed(3)}MHz, bandwidth ${this.formatBW(sig.bandwidth)}, confidence ${Math.round(sig.confidence * 100)}%.`);
    }

    // Quiet band fallback
    if (templates.length === 0) {
      const quietTemplates = [
        'The band is quiet. No significant RF activity detected. A good time to scan for weak signals.',
        'Spectrum is calm — noise floor nominal. Standing by for activity.',
        'All monitored frequencies silent. The ionosphere rests.',
        'No active signals in the scan range. Propagation conditions may be unfavourable.',
      ];
      templates.push(quietTemplates[Math.floor(Math.random() * quietTemplates.length)]);
    }

    // Pick 1-2 templates
    const count = Math.min(templates.length, 2);
    const shuffled = templates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).join(' ');
  }

  private formatBW(hz: number): string {
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(1)}MHz`;
    if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)}kHz`;
    return `${hz}Hz`;
  }

  // Public API
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
    if (request.decoderOutput) text += ` Decoder output: ${request.decoderOutput}`;

    if (request.signalStrengthDbm) {
      const s = request.signalStrengthDbm;
      if (s > -30) text += ' Extremely strong signal — very nearby transmitter.';
      else if (s > -60) text += ' Strong signal — transmitter within a few kilometres.';
      else if (s > -90) text += ' Moderate signal strength.';
      else text += ' Weak signal — distant or obstructed transmitter.';
    }

    if (!band && request.signalStrengthDbm && request.signalStrengthDbm > -70) {
      isAnomaly = true;
      text += ' ⚠️ Unidentified signal with notable strength — worth investigating.';
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
    if (this.narrations.length > this.config.maxNarrations) this.narrations = this.narrations.slice(0, this.config.maxNarrations);
    this.emit('narration', narration);
    return narration;
  }

  async ask(question: string): Promise<{ answer: string; sources: string[] }> {
    const stateDesc = this.buildStateDescription();
    const sources: string[] = [];

    if (this.rfState.activeFrequencies.length) sources.push('active_frequencies');
    if (this.rfState.adsbAircraft.length) sources.push('adsb');
    if (this.rfState.aprsStations.length) sources.push('aprs');
    if (this.rfState.satellitePasses.length) sources.push('satellites');
    if (this.rfState.dxSpots.length) sources.push('dx_cluster');

    if (this.ollamaAvailable) {
      try {
        const prompt = `You are SignalForge's AI radio advisor. Answer concisely based on the current RF environment data.\n\nCurrent state:\n${stateDesc}\n\nQuestion: ${question}\n\nAnswer:`;
        const res = await fetch(this.ollamaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.ollamaModel, prompt, stream: false, options: { temperature: 0.5, num_predict: 200 } }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json() as { response: string };
          return { answer: data.response.trim(), sources };
        }
      } catch { /* fall through to template */ }
    }

    // Template fallback
    return { answer: `Based on current monitoring: ${stateDesc}`, sources };
  }

  getCurrentNarration(): string {
    return this.currentNarration;
  }

  private generateKnownBandNarration(req: NarrationRequest, band: { name: string; usage: string }, freqStr: string): string {
    const intros = [
      `You're tuned to ${freqStr}, within the ${band.name} allocation.`,
      `At ${freqStr}, you're in the ${band.name} band.`,
      `Frequency ${freqStr} falls within ${band.name}.`,
    ];
    return `${intros[Math.floor(Math.random() * intros.length)]} ${band.usage}.${req.mode ? ` Mode: ${req.mode}.` : ''}`;
  }

  private generateUnknownNarration(req: NarrationRequest, freqStr: string): string {
    return `You're tuned to ${freqStr}${req.mode ? ` in ${req.mode} mode` : ''}. This frequency doesn't match a well-known allocation — could be a utility station, unlicensed transmitter, or intermodulation product.`;
  }

  private formatFrequency(hz: number): string {
    if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
    if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
    return `${hz} Hz`;
  }

  getNarrations(limit = 50): Narration[] { return this.narrations.slice(0, limit); }
  getConfig(): NarratorConfig { return { ...this.config }; }
  updateConfig(partial: Partial<NarratorConfig>): NarratorConfig {
    Object.assign(this.config, partial);
    this.startAutoNarrate();
    return this.config;
  }
}
