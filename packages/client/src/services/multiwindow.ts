/**
 * Multi-Window Support via BroadcastChannel API
 * Allows multiple SignalForge windows to share state and data
 */

export interface SyncState {
  activeFrequency: number;
  activeView: string;
  decodedData: Record<string, any>;
  satellitePositions: any[];
  aircraft: any[];
  vessels: any[];
  timestamp: number;
}

export type WindowRole = 'primary' | 'secondary' | 'standalone';

interface ChannelMessage {
  type: 'state-sync' | 'heartbeat' | 'role-claim' | 'role-release' | 'view-change' | 'request-state';
  senderId: string;
  role: WindowRole;
  payload?: any;
}

type Listener = (state: Partial<SyncState>) => void;

export class SignalForgeChannel {
  private channel: BroadcastChannel;
  private _role: WindowRole;
  private _id: string;
  private _state: Partial<SyncState> = {};
  private listeners: Set<Listener> = new Set();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private primaryAlive = false;
  private primaryCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this._id = `sf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.channel = new BroadcastChannel('signalforge-sync');

    // Determine role from URL params
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role') as WindowRole | null;

    if (urlRole === 'secondary') {
      this._role = 'secondary';
    } else {
      // Try to claim primary
      this._role = 'primary';
      this.claimPrimary();
    }

    this.channel.onmessage = (e: MessageEvent<ChannelMessage>) => this.handleMessage(e.data);

    // Start heartbeat if primary
    if (this._role === 'primary') {
      this.startHeartbeat();
    }

    // Secondaries monitor primary health
    if (this._role === 'secondary') {
      this.startPrimaryMonitor();
      // Request current state
      this.send({ type: 'request-state', senderId: this._id, role: this._role });
    }

    window.addEventListener('beforeunload', () => {
      if (this._role === 'primary') {
        this.send({ type: 'role-release', senderId: this._id, role: this._role });
      }
      this.destroy();
    });
  }

  get role(): WindowRole { return this._role; }
  get id(): string { return this._id; }
  get state(): Partial<SyncState> { return this._state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcastState(partial: Partial<SyncState>) {
    this._state = { ...this._state, ...partial, timestamp: Date.now() };
    this.send({ type: 'state-sync', senderId: this._id, role: this._role, payload: this._state });
  }

  broadcastViewChange(view: string) {
    this.send({ type: 'view-change', senderId: this._id, role: this._role, payload: { view } });
  }

  private handleMessage(msg: ChannelMessage) {
    if (msg.senderId === this._id) return;

    switch (msg.type) {
      case 'state-sync':
        this._state = { ...this._state, ...msg.payload };
        this.listeners.forEach(fn => fn(this._state));
        break;

      case 'heartbeat':
        if (msg.role === 'primary') this.primaryAlive = true;
        break;

      case 'role-claim':
        // Another window claims primary
        if (this._role === 'primary' && msg.senderId !== this._id) {
          // Yield if they have a lower ID (deterministic)
          if (msg.senderId < this._id) {
            this._role = 'secondary';
            this.stopHeartbeat();
            this.startPrimaryMonitor();
          }
        }
        break;

      case 'role-release':
        if (msg.role === 'primary' && this._role === 'secondary') {
          // Primary left — promote to standalone
          this._role = 'standalone';
          this.stopPrimaryMonitor();
        }
        break;

      case 'request-state':
        if (this._role === 'primary') {
          this.send({ type: 'state-sync', senderId: this._id, role: this._role, payload: this._state });
        }
        break;

      case 'view-change':
        this.listeners.forEach(fn => fn({ activeView: msg.payload.view } as any));
        break;
    }
  }

  private claimPrimary() {
    this.send({ type: 'role-claim', senderId: this._id, role: 'primary' });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'heartbeat', senderId: this._id, role: this._role });
    }, 2000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }

  private startPrimaryMonitor() {
    this.primaryAlive = false;
    this.primaryCheckInterval = setInterval(() => {
      if (!this.primaryAlive) {
        // Primary seems dead — become standalone
        this._role = 'standalone';
        this.stopPrimaryMonitor();
      }
      this.primaryAlive = false;
    }, 6000);
  }

  private stopPrimaryMonitor() {
    if (this.primaryCheckInterval) clearInterval(this.primaryCheckInterval);
    this.primaryCheckInterval = null;
  }

  private send(msg: ChannelMessage) {
    try { this.channel.postMessage(msg); } catch {}
  }

  destroy() {
    this.stopHeartbeat();
    this.stopPrimaryMonitor();
    this.listeners.clear();
    try { this.channel.close(); } catch {}
  }
}

// Singleton
let instance: SignalForgeChannel | null = null;

export function getMultiWindowChannel(): SignalForgeChannel {
  if (!instance) instance = new SignalForgeChannel();
  return instance;
}

/**
 * Open a view in a new window
 */
export function popOutView(view: string): Window | null {
  const url = `${window.location.origin}?view=${view}&role=secondary`;
  const w = window.open(
    url,
    `signalforge-${view}`,
    'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no'
  );
  return w;
}
