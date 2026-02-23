// ============================================================================
// SignalForge Multi-User Session Manager
// ============================================================================
import { EventEmitter } from 'events';
import type { UserSession, ChatMessage, SharedObservation } from '@signalforge/shared';

const USER_COLORS = ['#00e5ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b', '#20c997', '#748ffc', '#f06595', '#22b8cf'];

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, UserSession>();
  private chatHistory: ChatMessage[] = [];
  private observations: SharedObservation[] = [];
  private maxChat = 200;
  private maxObs = 500;

  createSession(nickname: string): UserSession {
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const token = `sf-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const color = USER_COLORS[this.sessions.size % USER_COLORS.length];
    const session: UserSession = { id, nickname, token, color, connectedAt: Date.now(), lastSeen: Date.now() };
    this.sessions.set(id, session);
    this.addSystemMessage(`${nickname} joined the session`);
    this.emit('user_joined', session);
    return session;
  }

  getSession(token: string): UserSession | undefined {
    for (const s of this.sessions.values()) {
      if (s.token === token) return s;
    }
    return undefined;
  }

  getSessionById(id: string): UserSession | undefined {
    return this.sessions.get(id);
  }

  updateTuning(userId: string, tuning: UserSession['tuning']) {
    const s = this.sessions.get(userId);
    if (s) {
      s.tuning = tuning;
      s.lastSeen = Date.now();
      this.emit('tuning_changed', s);
    }
  }

  updateView(userId: string, view: string) {
    const s = this.sessions.get(userId);
    if (s) {
      s.activeView = view;
      s.lastSeen = Date.now();
    }
  }

  heartbeat(userId: string) {
    const s = this.sessions.get(userId);
    if (s) s.lastSeen = Date.now();
  }

  removeSession(userId: string) {
    const s = this.sessions.get(userId);
    if (s) {
      this.sessions.delete(userId);
      this.addSystemMessage(`${s.nickname} left the session`);
      this.emit('user_left', s);
    }
  }

  getUsers(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  getOnlineUsers(): UserSession[] {
    const cutoff = Date.now() - 60000;
    return this.getUsers().filter(u => u.lastSeen > cutoff);
  }

  // Chat
  addChatMessage(userId: string, text: string): ChatMessage | null {
    const s = this.sessions.get(userId);
    if (!s) return null;
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      userId, nickname: s.nickname, color: s.color,
      text, timestamp: Date.now(), type: 'message',
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > this.maxChat) this.chatHistory.shift();
    this.emit('chat', msg);
    return msg;
  }

  private addSystemMessage(text: string) {
    const msg: ChatMessage = {
      id: `sys-${Date.now()}`, userId: 'system', nickname: 'System', color: '#6a6a8a',
      text, timestamp: Date.now(), type: 'system',
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > this.maxChat) this.chatHistory.shift();
    this.emit('chat', msg);
  }

  getChatHistory(limit = 50): ChatMessage[] {
    return this.chatHistory.slice(-limit);
  }

  // Shared observations
  addObservation(userId: string, obs: Omit<SharedObservation, 'id' | 'userId' | 'nickname' | 'color' | 'timestamp'>): SharedObservation | null {
    const s = this.sessions.get(userId);
    if (!s) return null;
    const entry: SharedObservation = {
      ...obs, id: `obs-${Date.now()}`, userId, nickname: s.nickname, color: s.color, timestamp: Date.now(),
    };
    this.observations.push(entry);
    if (this.observations.length > this.maxObs) this.observations.shift();
    this.emit('observation', entry);
    return entry;
  }

  getObservations(limit = 100): SharedObservation[] {
    return this.observations.slice(-limit);
  }

  // Cleanup stale sessions
  cleanup() {
    const cutoff = Date.now() - 300000; // 5 min
    for (const [id, s] of this.sessions) {
      if (s.lastSeen < cutoff) {
        this.removeSession(id);
      }
    }
  }
}
