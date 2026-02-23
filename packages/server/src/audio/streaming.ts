import { EventEmitter } from 'events';
import type { AudioStream, AudioStreamConfig, AudioChatRoom, AudioChatParticipant } from '@signalforge/shared';

export class AudioStreamingService extends EventEmitter {
  private streams = new Map<string, AudioStream>();
  private chatRooms = new Map<string, AudioChatRoom>();
  private config: AudioStreamConfig = {
    enabled: false,
    format: 'opus',
    sampleRate: 48000,
    bitrate: 64000,
    maxListeners: 50,
    icecastEnabled: false,
  };

  createStream(opts: { name: string; frequency: number; mode: string; createdBy: string }): AudioStream {
    const stream: AudioStream = {
      id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: opts.name,
      frequency: opts.frequency,
      mode: opts.mode,
      active: true,
      listeners: 0,
      format: this.config.format,
      sampleRate: this.config.sampleRate,
      bitrate: this.config.bitrate,
      startedAt: Date.now(),
      createdBy: opts.createdBy,
    };
    this.streams.set(stream.id, stream);
    this.emit('stream_created', stream);
    return stream;
  }

  stopStream(id: string): boolean {
    const stream = this.streams.get(id);
    if (!stream) return false;
    stream.active = false;
    this.emit('stream_stopped', stream);
    return true;
  }

  getStreams(): AudioStream[] {
    return [...this.streams.values()];
  }

  getActiveStreams(): AudioStream[] {
    return [...this.streams.values()].filter(s => s.active);
  }

  joinStream(streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream || !stream.active) return false;
    if (stream.listeners >= this.config.maxListeners) return false;
    stream.listeners++;
    this.emit('listener_joined', { streamId, listeners: stream.listeners });
    return true;
  }

  leaveStream(streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    stream.listeners = Math.max(0, stream.listeners - 1);
    this.emit('listener_left', { streamId, listeners: stream.listeners });
    return true;
  }

  getConfig(): AudioStreamConfig { return this.config; }

  updateConfig(updates: Partial<AudioStreamConfig>): AudioStreamConfig {
    Object.assign(this.config, updates);
    return this.config;
  }

  // Audio chat rooms
  createChatRoom(name: string, maxParticipants = 10): AudioChatRoom {
    const room: AudioChatRoom = {
      id: `acr-${Date.now()}`,
      name,
      participants: [],
      createdAt: Date.now(),
      maxParticipants,
    };
    this.chatRooms.set(room.id, room);
    this.emit('room_created', room);
    return room;
  }

  joinChatRoom(roomId: string, userId: string, nickname: string): boolean {
    const room = this.chatRooms.get(roomId);
    if (!room || room.participants.length >= room.maxParticipants) return false;
    room.participants.push({ userId, nickname, muted: false, speaking: false, joinedAt: Date.now() });
    this.emit('room_updated', room);
    return true;
  }

  leaveChatRoom(roomId: string, userId: string): boolean {
    const room = this.chatRooms.get(roomId);
    if (!room) return false;
    room.participants = room.participants.filter(p => p.userId !== userId);
    if (room.participants.length === 0) this.chatRooms.delete(roomId);
    else this.emit('room_updated', room);
    return true;
  }

  getChatRooms(): AudioChatRoom[] {
    return [...this.chatRooms.values()];
  }
}
