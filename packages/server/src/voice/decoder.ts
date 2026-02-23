import { EventEmitter } from 'events';
import type { VoiceProtocol, DigitalVoiceFrame, VoiceDecoderState, TalkgroupInfo } from '@signalforge/shared';

export class DigitalVoiceDecoder extends EventEmitter {
  private decoders = new Map<VoiceProtocol, VoiceDecoderState>();
  private frames: DigitalVoiceFrame[] = [];
  private talkgroups = new Map<number, TalkgroupInfo>();
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    // Initialize decoder states
    const protocols: VoiceProtocol[] = ['DMR', 'DSTAR', 'C4FM'];
    for (const p of protocols) {
      this.decoders.set(p, {
        protocol: p,
        enabled: false,
        frequency: p === 'DMR' ? 438.8e6 : p === 'DSTAR' ? 145.67e6 : 144.64e6,
        framesDecoded: 0,
        activeCallsigns: [],
        activeTalkgroups: [],
      });
    }

    // Demo talkgroups
    const demoTGs: TalkgroupInfo[] = [
      { id: 91, name: 'Worldwide', description: 'DMR Worldwide', network: 'BrandMeister', active: true, lastHeard: Date.now() },
      { id: 235, name: 'UK National', description: 'UK Wide Chat', network: 'BrandMeister', active: true, lastHeard: Date.now() },
      { id: 2350, name: 'UK Regional', description: 'Regional repeaters', network: 'BrandMeister', active: false, lastHeard: Date.now() - 3600000 },
      { id: 9, name: 'Local', description: 'Local talk', network: 'BrandMeister', active: true, lastHeard: Date.now() },
      { id: 310, name: 'TAC 310', description: 'Tactical channel', network: 'BrandMeister', active: false, lastHeard: Date.now() - 7200000 },
    ];
    for (const tg of demoTGs) this.talkgroups.set(tg.id, tg);
  }

  enableDecoder(protocol: VoiceProtocol, frequency?: number): VoiceDecoderState | null {
    const state = this.decoders.get(protocol);
    if (!state) return null;
    state.enabled = true;
    if (frequency) state.frequency = frequency;
    this.emit('decoder_enabled', state);
    return state;
  }

  disableDecoder(protocol: VoiceProtocol): VoiceDecoderState | null {
    const state = this.decoders.get(protocol);
    if (!state) return null;
    state.enabled = false;
    state.activeCallsigns = [];
    this.emit('decoder_disabled', state);
    return state;
  }

  getDecoderStates(): VoiceDecoderState[] {
    return [...this.decoders.values()];
  }

  getFrames(protocol?: VoiceProtocol, limit = 100): DigitalVoiceFrame[] {
    let f = this.frames;
    if (protocol) f = f.filter(fr => fr.protocol === protocol);
    return f.slice(0, limit);
  }

  getTalkgroups(): TalkgroupInfo[] {
    return [...this.talkgroups.values()];
  }

  startDemo() {
    if (this.demoInterval) return;
    const callsigns = ['G4ABC', 'M0XYZ', 'G7DEF', '2E0GHI', 'M6JKL', 'GW0MNO', 'GM3PQR'];
    const tgIds = [91, 235, 2350, 9, 310];

    this.demoInterval = setInterval(() => {
      for (const [protocol, state] of this.decoders) {
        if (!state.enabled) continue;
        if (Math.random() > 0.3) continue; // 30% chance per tick

        const frame: DigitalVoiceFrame = {
          id: `vf-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          protocol,
          timestamp: Date.now(),
          frequency: state.frequency,
          signalStrength: -60 - Math.random() * 40,
          ber: Math.random() * 0.05,
          duration: 1 + Math.random() * 10,
        };

        if (protocol === 'DMR') {
          const tgId = tgIds[Math.floor(Math.random() * tgIds.length)];
          frame.timeslot = Math.random() > 0.5 ? 1 : 2;
          frame.colorCode = 1;
          frame.talkgroupId = tgId;
          frame.talkgroupName = this.talkgroups.get(tgId)?.name || `TG${tgId}`;
          frame.radioId = 2340000 + Math.floor(Math.random() * 9999);
          frame.sourceCallsign = callsigns[Math.floor(Math.random() * callsigns.length)];
        } else if (protocol === 'DSTAR') {
          frame.myCallsign = callsigns[Math.floor(Math.random() * callsigns.length)];
          frame.yourCallsign = 'CQCQCQ  ';
          frame.rpt1Callsign = 'GB7XX  B';
          frame.rpt2Callsign = 'GB7XX  G';
          frame.message = 'via SignalForge';
        } else if (protocol === 'C4FM') {
          frame.sourceCallsign = callsigns[Math.floor(Math.random() * callsigns.length)];
          frame.destCallsign = 'ALL';
          frame.dataType = Math.random() > 0.7 ? 'voice+data' : 'voice';
          frame.dgId = Math.floor(Math.random() * 100);
        }

        this.frames.unshift(frame);
        if (this.frames.length > 5000) this.frames.length = 5000;
        state.framesDecoded++;
        state.lastFrame = frame;

        // Update active callsigns
        const cs = frame.sourceCallsign || frame.myCallsign;
        if (cs && !state.activeCallsigns.includes(cs)) {
          state.activeCallsigns.push(cs);
          if (state.activeCallsigns.length > 20) state.activeCallsigns.shift();
        }

        this.emit('voice_frame', frame);
      }
    }, 3000);
  }

  stopDemo() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
  }
}
