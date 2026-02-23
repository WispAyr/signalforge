// Audio Streaming Types

export interface AudioStream {
  id: string;
  name: string;
  frequency: number;
  mode: string;
  active: boolean;
  listeners: number;
  format: 'opus' | 'mp3' | 'pcm';
  sampleRate: number;
  bitrate: number;
  startedAt: number;
  createdBy: string;
}

export interface AudioStreamConfig {
  enabled: boolean;
  format: 'opus' | 'mp3' | 'pcm';
  sampleRate: number;
  bitrate: number;
  maxListeners: number;
  icecastEnabled: boolean;
  icecastHost?: string;
  icecastPort?: number;
  icecastMount?: string;
  icecastPassword?: string;
}

export interface AudioChatParticipant {
  userId: string;
  nickname: string;
  muted: boolean;
  speaking: boolean;
  joinedAt: number;
}

export interface AudioChatRoom {
  id: string;
  name: string;
  participants: AudioChatParticipant[];
  createdAt: number;
  maxParticipants: number;
}
