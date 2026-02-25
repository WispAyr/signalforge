// ============================================================================
// SignalForge — AI Signal Narrator Service
// Multi-provider LLM (Ollama → Anthropic → Template), narration styles,
// rich context from live decoders, WebSocket broadcast
// ============================================================================
import { EventEmitter } from 'events';
import type { Narration, NarrationRequest, NarratorConfig } from '@signalforge/shared';

type NarrationStyle = 'technical' | 'casual' | 'dramatic';

interface RFState {
  activeFrequencies: Array<{ freq: number; mode: string; strength: number }>;
  decodedSignals: Array<{ type: string; data: Record<string, unknown> }>;
  satellitePasses: Array<{ name: string; maxElevation: number; aosTime: number; losTime: number }>;
  aprsStations: Array<{ callsign: string; lat: number; lon: number; speed: number; course: number; comment: string }>;
  adsbAircraft: Array<{ callsign: string; altitude: number; heading: number; speed: number; lat?: number; lon?: number; squawk?: string; verticalRate?: number }>;
  aisVessels: Array<{ name: string; mmsi: string; type: string; sog: number; cog: number; destination?: string; navStatus?: string }>;
  dxSpots: Array<{ dxCall: string; frequency: number; spotter: string; comment: string }>;
  classifiedSignals: Array<{ freq: number; classification: string; confidence: number; bandwidth: number }>;
  decoderStatus: Array<{ name: string; running: boolean; messagesDecoded: number; lastMessage: number | null }>;
  pagerMessages: Array<{ protocol: string; content: string; capcode?: number; timestamp: number }>;
  ismDevices: Array<{ model: string; type: string; lastReading: Record<string, unknown> | null }>;
  sdrStatus: { connected: boolean; frequency?: number; sampleRate?: number; gain?: number } | null;
}

// Style-specific system prompts
const STYLE_PROMPTS: Record<NarrationStyle, string> = {
  technical: `You are a technical RF monitoring system narrator. Report facts precisely: frequencies in MHz, altitudes in FL, speeds in knots, signal strengths in dBm. Use standard radio terminology. Be concise and data-driven. No embellishment. 2-3 sentences max.`,
  casual: `You are SignalForge's AI narrator — friendly, knowledgeable about radio. Highlight interesting things: unusual aircraft (military, emergencies), large ships, new signals. Be conversational but informative. 2-3 sentences max.`,
  dramatic: `You are a veteran radio operator narrating live operations. Speak with gravitas and urgency. Paint a picture of the electromagnetic battlefield. Reference the time of day, weather of the airwaves. Be vivid but brief. 2-3 sentences max.`,
};

export class NarratorService extends EventEmitter {
  private narrations: Narration[] = [];
  private currentNarration: string = 'SignalForge initialising — scanning the electromagnetic spectrum...';
  private config: NarratorConfig = {
    enabled: true,
    autoNarrate: true,
    autoNarrateIntervalMs: 30000,
    anomalyThreshold: 0.7,
    maxNarrations: 200,
  };
  private style: NarrationStyle = 'casual';
  private autoNarrateTimer: ReturnType<typeof setInterval> | null = null;
  private rfState: RFState = {
    activeFrequencies: [],
    decodedSignals: [],
    satellitePasses: [],
    aprsStations: [],
    adsbAircraft: [],
    aisVessels: [],
    dxSpots: [],
    classifiedSignals: [],
    decoderStatus: [],
    pagerMessages: [],
    ismDevices: [],
    sdrStatus: null,
  };

  // LLM providers
  private ollamaAvailable: boolean | null = null;
  private anthropicAvailable: boolean | null = null;
  private readonly ollamaUrl = 'http://localhost:11434/api/generate';
  private readonly ollamaModel = 'llama3.1:8b';
  private readonly anthropicUrl = 'https://api.anthropic.com/v1/messages';
  private activeProvider: 'ollama' | 'anthropic' | 'template' = 'template';

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
    this.checkProviders();
  }

  // ── Provider Detection ────────────────────────────────────────────────────

  private async checkProviders(): Promise<void> {
    // Check Ollama
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json() as { models: Array<{ name: string }> };
        // Check if our model is available, or pull it
        const hasModel = data.models?.some((m: any) => m.name?.includes('llama3'));
        this.ollamaAvailable = res.ok; // Available even without model — can use whatever's there
        if (hasModel) {
          this.activeProvider = 'ollama';
          console.log('🤖 Narrator: Ollama available (preferred provider)');
        } else if (data.models?.length > 0) {
          // Use first available model
          (this as any)._ollamaModel = data.models[0].name;
          this.activeProvider = 'ollama';
          console.log(`🤖 Narrator: Ollama available, using model: ${data.models[0].name}`);
        } else {
          this.ollamaAvailable = false;
        }
      }
    } catch {
      this.ollamaAvailable = false;
    }

    // Check Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey.length > 10) {
      this.anthropicAvailable = true;
      if (!this.ollamaAvailable) {
        this.activeProvider = 'anthropic';
        console.log('🤖 Narrator: Anthropic API available (fallback provider)');
      }
    } else {
      this.anthropicAvailable = false;
    }

    if (!this.ollamaAvailable && !this.anthropicAvailable) {
      this.activeProvider = 'template';
      console.log('🤖 Narrator: No LLM available, using template fallback');
    }
  }

  // ── State Management ──────────────────────────────────────────────────────

  updateRFState(partial: Partial<RFState>): void {
    Object.assign(this.rfState, partial);
  }

  setStyle(style: NarrationStyle): void {
    this.style = style;
  }

  getStyle(): NarrationStyle {
    return this.style;
  }

  getActiveProvider(): string {
    return this.activeProvider;
  }

  // ── Auto-Narration ────────────────────────────────────────────────────────

  private startAutoNarrate(): void {
    if (this.autoNarrateTimer) clearInterval(this.autoNarrateTimer);
    this.autoNarrateTimer = setInterval(() => {
      if (!this.config.enabled || !this.config.autoNarrate) return;
      this.generateContextualNarration();
    }, this.config.autoNarrateIntervalMs);
  }

  private async generateContextualNarration(): Promise<void> {
    let text: string;

    try {
      if (this.activeProvider === 'ollama') {
        text = await this.generateWithOllama();
      } else if (this.activeProvider === 'anthropic') {
        text = await this.generateWithAnthropic();
      } else {
        text = this.generateFromTemplates();
      }
    } catch (err) {
      // Fallback chain
      try {
        if (this.activeProvider === 'ollama' && this.anthropicAvailable) {
          text = await this.generateWithAnthropic();
        } else {
          text = this.generateFromTemplates();
        }
      } catch {
        text = this.generateFromTemplates();
      }
    }

    this.currentNarration = text;
    const narration: Narration = {
      id: `nar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      frequencyHz: this.rfState.activeFrequencies[0]?.freq || 0,
      text,
      timestamp: Date.now(),
      confidence: this.activeProvider !== 'template' ? 0.9 : 0.75,
      tags: ['auto', this.style, this.activeProvider],
      isAnomaly: false,
    };
    this.narrations.unshift(narration);
    if (this.narrations.length > this.config.maxNarrations) {
      this.narrations = this.narrations.slice(0, this.config.maxNarrations);
    }
    this.emit('narration', narration);
  }

  // ── Ollama LLM ────────────────────────────────────────────────────────────

  private async generateWithOllama(): Promise<string> {
    const context = this.buildRichContext();
    const systemPrompt = STYLE_PROMPTS[this.style];
    const prompt = `${systemPrompt}\n\nCurrent RF environment and signal intelligence:\n\n${context}\n\nProvide your narration now.`;

    const model = (this as any)._ollamaModel || this.ollamaModel;
    const res = await fetch(this.ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: this.style === 'dramatic' ? 0.8 : 0.6, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json() as { response: string };
    return data.response.trim();
  }

  // ── Anthropic API ─────────────────────────────────────────────────────────

  private async generateWithAnthropic(): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

    const context = this.buildRichContext();
    const systemPrompt = STYLE_PROMPTS[this.style];

    const res = await fetch(this.anthropicUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Current RF environment and signal intelligence:\n\n${context}\n\nProvide your narration now.`,
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
    const data = await res.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text?.trim() || this.generateFromTemplates();
  }

  // ── Rich Context Builder ──────────────────────────────────────────────────

  private buildRichContext(): string {
    const parts: string[] = [];
    const {
      activeFrequencies, adsbAircraft, aisVessels, satellitePasses,
      aprsStations, dxSpots, classifiedSignals, decoderStatus,
      pagerMessages, ismDevices, sdrStatus,
    } = this.rfState;

    // Time of day context
    const hour = new Date().getHours();
    const timeContext = hour < 6 ? 'Late night — minimal traffic expected'
      : hour < 9 ? 'Early morning — aviation traffic increasing, commuter flights'
      : hour < 12 ? 'Morning — peak aviation and maritime traffic'
      : hour < 14 ? 'Midday — steady activity across bands'
      : hour < 18 ? 'Afternoon — continued traffic, propagation may shift'
      : hour < 21 ? 'Evening — traffic declining, HF propagation improving'
      : 'Night — quiet bands, long-distance HF propagation possible';
    parts.push(`Time: ${new Date().toLocaleTimeString('en-GB', { hour12: false })} — ${timeContext}`);

    // SDR status
    if (sdrStatus?.connected) {
      parts.push(`SDR: Connected, tuned to ${((sdrStatus.frequency || 0) / 1e6).toFixed(3)} MHz, ${((sdrStatus.sampleRate || 0) / 1e6).toFixed(1)} Msps`);
    }

    // Active frequencies
    if (activeFrequencies.length > 0) {
      parts.push(`Active frequencies: ${activeFrequencies.slice(0, 5).map(f =>
        `${(f.freq / 1e6).toFixed(3)} MHz (${f.mode}, ${f.strength} dBm)`
      ).join(', ')}`);
    }

    // ADS-B Aircraft
    if (adsbAircraft.length > 0) {
      const interesting = adsbAircraft.filter(a => {
        const cs = (a.callsign || '').toUpperCase();
        return cs.startsWith('RRR') || cs.startsWith('RESCUE') || cs.startsWith('RAF') ||
          cs.startsWith('RFR') || cs.startsWith('GAF') || cs.startsWith('NAF') ||
          a.squawk === '7700' || a.squawk === '7600' || a.squawk === '7500' ||
          (a.altitude && a.altitude > 45000);
      });

      parts.push(`Aircraft: ${adsbAircraft.length} tracked.${
        interesting.length > 0
          ? ` ⚠️ Notable: ${interesting.map(a => `${a.callsign || a.squawk} FL${Math.round((a.altitude || 0) / 100)}${a.squawk === '7700' ? ' EMERGENCY' : a.squawk === '7600' ? ' RADIO FAIL' : a.squawk === '7500' ? ' HIJACK' : ''}`).join('; ')}`
          : ` Sample: ${adsbAircraft.slice(0, 3).map(a => `${a.callsign || 'Unknown'} FL${Math.round((a.altitude || 0) / 100)} ${a.speed || 0}kts hdg ${a.heading || 0}°`).join('; ')}`
      }`);
    }

    // AIS Vessels
    if (aisVessels.length > 0) {
      const large = aisVessels.filter(v => v.type?.includes('Tanker') || v.type?.includes('Cargo') || (v.sog && v.sog > 15));
      parts.push(`Vessels: ${aisVessels.length} tracked.${
        large.length > 0
          ? ` Large/fast: ${large.slice(0, 3).map(v => `${v.name || v.mmsi} (${v.type || '?'}) ${v.sog?.toFixed(1) || 0}kts → ${v.destination || '?'}`).join('; ')}`
          : ` Sample: ${aisVessels.slice(0, 3).map(v => `${v.name || v.mmsi} ${v.sog?.toFixed(1) || 0}kts`).join('; ')}`
      }`);
    }

    // APRS Stations
    if (aprsStations.length > 0) {
      const moving = aprsStations.filter(s => s.speed > 5);
      const wx = aprsStations.filter(s => s.comment?.toLowerCase().includes('wx') || s.comment?.toLowerCase().includes('weather'));
      parts.push(`APRS: ${aprsStations.length} stations.${
        moving.length > 0 ? ` ${moving.length} mobile.` : ''
      }${wx.length > 0 ? ` ${wx.length} weather stations.` : ''
      } Recent: ${aprsStations.slice(0, 2).map(s => `${s.callsign}${s.speed > 0 ? ` @ ${s.speed}km/h` : ' stationary'}`).join(', ')}`);
    }

    // Satellite passes
    const upcoming = (satellitePasses || []).filter(s => s.aosTime > Date.now()).sort((a, b) => a.aosTime - b.aosTime);
    if (upcoming.length > 0) {
      const next = upcoming[0];
      const mins = Math.round((next.aosTime - Date.now()) / 60000);
      if (mins <= 60) {
        parts.push(`Next satellite: ${next.name} in ${mins}min, max el ${next.maxElevation}°`);
      }
    }

    // DX Cluster
    if (dxSpots.length > 0) {
      parts.push(`DX: ${dxSpots.slice(0, 2).map(d => `${d.dxCall} on ${(d.frequency / 1e3).toFixed(1)}kHz`).join('; ')}`);
    }

    // Classified signals
    if (classifiedSignals.length > 0) {
      parts.push(`Classified: ${classifiedSignals.map(s => `${s.classification} at ${(s.freq / 1e6).toFixed(3)} MHz (${Math.round(s.confidence * 100)}%)`).join(', ')}`);
    }

    // Active decoders
    if (decoderStatus.length > 0) {
      const running = decoderStatus.filter(d => d.running);
      if (running.length > 0) {
        parts.push(`Active decoders: ${running.map(d => `${d.name} (${d.messagesDecoded} msgs)`).join(', ')}`);
      }
    }

    // Recent pager messages
    if (pagerMessages.length > 0) {
      const recent = pagerMessages.slice(0, 2);
      parts.push(`Recent pager: ${recent.map(p => `${p.protocol}${p.capcode ? ` [${p.capcode}]` : ''}: "${p.content.slice(0, 50)}${p.content.length > 50 ? '...' : ''}"`).join('; ')}`);
    }

    // ISM devices
    if (ismDevices.length > 0) {
      parts.push(`ISM devices: ${ismDevices.length} — ${ismDevices.slice(0, 3).map(d => `${d.model} (${d.type})`).join(', ')}`);
    }

    return parts.join('\n') || 'No active RF sources detected. The band is quiet.';
  }

  // ── Legacy compact state description (for ask API) ────────────────────────

  private buildStateDescription(): string {
    return this.buildRichContext();
  }

  // ── Template Narration ────────────────────────────────────────────────────

  private generateFromTemplates(): string {
    const templates: string[] = [];
    const {
      activeFrequencies, adsbAircraft, aisVessels, satellitePasses,
      aprsStations, dxSpots, classifiedSignals, pagerMessages, ismDevices,
    } = this.rfState;
    const now = Date.now();

    // Style-aware template generation
    const s = this.style;

    // Aircraft
    if (adsbAircraft.length > 0) {
      const count = adsbAircraft.length;
      const sample = adsbAircraft[Math.floor(Math.random() * adsbAircraft.length)];
      const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      const dir = dirs[Math.round((sample.heading || 0) / 45) % 8];

      if (s === 'technical') {
        templates.push(`1090MHz ADS-B: ${count} aircraft. ${sample.callsign || 'N/A'} FL${Math.round((sample.altitude || 0) / 100)} HDG${sample.heading || 0}° ${sample.speed || 0}kts.`);
      } else if (s === 'dramatic') {
        templates.push(`The skies are alive — ${count} aircraft tracked on 1090. ${sample.callsign || 'An unidentified contact'} cuts through at flight level ${Math.round((sample.altitude || 0) / 100)}, bearing ${dir}.`);
      } else {
        templates.push(`Tracking ${count} aircraft on 1090MHz. ${sample.callsign || 'Unknown'} heading ${dir} at FL${Math.round((sample.altitude || 0) / 100)}, ${sample.speed || 0} knots.`);
      }
    }

    // Vessels
    if (aisVessels.length > 0) {
      const v = aisVessels[Math.floor(Math.random() * aisVessels.length)];
      if (s === 'dramatic') {
        templates.push(`${aisVessels.length} vessels on the water. ${v.name || 'A ghost ship'} makes ${v.sog?.toFixed(1) || 0} knots${v.destination ? `, bound for ${v.destination}` : ''}.`);
      } else {
        templates.push(`AIS: ${aisVessels.length} vessels tracked. ${v.name || v.mmsi} (${v.type || 'unknown'}) at ${v.sog?.toFixed(1) || 0}kts${v.destination ? ` → ${v.destination}` : ''}.`);
      }
    }

    // Satellites
    const upcoming = (satellitePasses || []).filter(sp => sp.aosTime > now).sort((a, b) => a.aosTime - b.aosTime);
    if (upcoming.length > 0) {
      const next = upcoming[0];
      const mins = Math.round((next.aosTime - now) / 60000);
      if (mins <= 30) {
        if (s === 'dramatic') {
          templates.push(`${next.name} approaches from beyond the horizon — ${mins} minutes to acquisition. Maximum elevation ${next.maxElevation}°.`);
        } else {
          templates.push(`Satellite ${next.name} in ${mins}min, max el ${next.maxElevation}°. ${next.maxElevation > 45 ? 'Good pass.' : 'Low pass.'}`);
        }
      }
    }

    // APRS
    if (aprsStations.length > 0) {
      const station = aprsStations[Math.floor(Math.random() * aprsStations.length)];
      templates.push(`APRS: ${station.callsign} — ${station.speed > 0 ? `moving at ${station.speed}km/h` : 'stationary'}. ${station.comment || ''}`);
    }

    // DX
    if (dxSpots.length > 0) {
      const spot = dxSpots[Math.floor(Math.random() * dxSpots.length)];
      templates.push(`DX Cluster: ${spot.dxCall} on ${(spot.frequency / 1e3).toFixed(1)}kHz spotted by ${spot.spotter}.`);
    }

    // Pager
    if (pagerMessages.length > 0) {
      const msg = pagerMessages[0];
      if (s === 'dramatic') {
        templates.push(`A pager crackles to life — ${msg.protocol} message decoded. The old networks still hum with purpose.`);
      } else {
        templates.push(`${msg.protocol} pager message decoded${msg.capcode ? ` [capcode ${msg.capcode}]` : ''}.`);
      }
    }

    // ISM
    if (ismDevices.length > 0) {
      templates.push(`${ismDevices.length} ISM device${ismDevices.length > 1 ? 's' : ''} active on 433/868MHz.`);
    }

    // Active frequencies
    if (activeFrequencies.length > 0 && templates.length < 2) {
      const f = activeFrequencies[0];
      const band = this.knownBands.find(b => f.freq >= b.startHz && f.freq <= b.endHz);
      if (band) {
        templates.push(`Monitoring ${(f.freq / 1e6).toFixed(3)}MHz — ${band.name}. Signal: ${f.strength > -60 ? 'strong' : f.strength > -90 ? 'moderate' : 'weak'} at ${f.strength}dBm.`);
      }
    }

    // Classified signals
    if (classifiedSignals.length > 0 && templates.length < 2) {
      const sig = classifiedSignals[Math.floor(Math.random() * classifiedSignals.length)];
      templates.push(`Signal classifier: ${sig.classification.toUpperCase()} at ${(sig.freq / 1e6).toFixed(3)}MHz, ${Math.round(sig.confidence * 100)}% confidence.`);
    }

    // Quiet fallback
    if (templates.length === 0) {
      if (s === 'dramatic') {
        const dramatic = [
          'Silence across the spectrum. The ether holds its breath.',
          'The bands lie dormant — a rare moment of electromagnetic peace.',
          'Nothing stirs on the airwaves. Even the noise floor seems to whisper.',
        ];
        templates.push(dramatic[Math.floor(Math.random() * dramatic.length)]);
      } else if (s === 'technical') {
        templates.push('No significant RF activity detected. Noise floor nominal.');
      } else {
        const quiet = [
          'The band is quiet. No significant RF activity detected.',
          'Spectrum is calm — standing by for activity.',
          'All monitored frequencies silent. Scanning continues.',
        ];
        templates.push(quiet[Math.floor(Math.random() * quiet.length)]);
      }
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

  // ── Public API ────────────────────────────────────────────────────────────

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
      const ss = request.signalStrengthDbm;
      if (ss > -30) text += ' Extremely strong signal — very nearby transmitter.';
      else if (ss > -60) text += ' Strong signal — transmitter within a few kilometres.';
      else if (ss > -90) text += ' Moderate signal strength.';
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
    if (this.narrations.length > this.config.maxNarrations) {
      this.narrations = this.narrations.slice(0, this.config.maxNarrations);
    }
    this.emit('narration', narration);
    return narration;
  }

  async ask(question: string): Promise<{ answer: string; sources: string[] }> {
    const stateDesc = this.buildStateDescription();
    const sources: string[] = [];

    if (this.rfState.activeFrequencies.length) sources.push('active_frequencies');
    if (this.rfState.adsbAircraft.length) sources.push('adsb');
    if (this.rfState.aisVessels.length) sources.push('ais');
    if (this.rfState.aprsStations.length) sources.push('aprs');
    if (this.rfState.satellitePasses.length) sources.push('satellites');
    if (this.rfState.dxSpots.length) sources.push('dx_cluster');
    if (this.rfState.pagerMessages.length) sources.push('pager');
    if (this.rfState.ismDevices.length) sources.push('ism_devices');

    // Try LLM providers
    const prompt = `You are SignalForge's AI radio advisor. Answer concisely based on the current RF environment data.\n\nCurrent state:\n${stateDesc}\n\nQuestion: ${question}\n\nAnswer:`;

    if (this.activeProvider === 'ollama' || (this.ollamaAvailable && this.activeProvider !== 'template')) {
      try {
        const model = (this as any)._ollamaModel || this.ollamaModel;
        const res = await fetch(this.ollamaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.5, num_predict: 200 } }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json() as { response: string };
          return { answer: data.response.trim(), sources };
        }
      } catch { /* fall through */ }
    }

    if (this.anthropicAvailable) {
      try {
        const apiKey = process.env.ANTHROPIC_API_KEY!;
        const res = await fetch(this.anthropicUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 200,
            system: 'You are SignalForge\'s AI radio advisor. Answer concisely.',
            messages: [{ role: 'user', content: `Current state:\n${stateDesc}\n\nQuestion: ${question}` }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json() as { content: Array<{ text: string }> };
          return { answer: data.content[0]?.text?.trim() || stateDesc, sources };
        }
      } catch { /* fall through */ }
    }

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
  updateConfig(partial: Partial<NarratorConfig & { style?: NarrationStyle }>): NarratorConfig {
    if (partial.style) {
      this.style = partial.style;
      delete partial.style;
    }
    Object.assign(this.config, partial);
    this.startAutoNarrate();
    return this.config;
  }
}
