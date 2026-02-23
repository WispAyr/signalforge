// Digital Voice Decoding Types

export type VoiceProtocol = 'DMR' | 'DSTAR' | 'C4FM';

export interface DigitalVoiceFrame {
  id: string;
  protocol: VoiceProtocol;
  timestamp: number;
  frequency: number;
  // DMR specific
  timeslot?: number;
  colorCode?: number;
  talkgroupId?: number;
  talkgroupName?: string;
  radioId?: number;
  // D-STAR specific
  myCallsign?: string;
  yourCallsign?: string;
  rpt1Callsign?: string;
  rpt2Callsign?: string;
  message?: string;
  // C4FM / System Fusion specific
  sourceCallsign?: string;
  destCallsign?: string;
  dataType?: 'voice' | 'data' | 'voice+data';
  dgId?: number;
  // Common
  signalStrength: number;
  ber?: number; // bit error rate
  duration?: number;
}

export interface TalkgroupInfo {
  id: number;
  name: string;
  description: string;
  network: string;
  active: boolean;
  lastHeard: number;
}

export interface VoiceDecoderState {
  protocol: VoiceProtocol;
  enabled: boolean;
  frequency: number;
  framesDecoded: number;
  activeCallsigns: string[];
  activeTalkgroups: TalkgroupInfo[];
  lastFrame?: DigitalVoiceFrame;
}
