import { Socket } from 'net';
import { EventEmitter } from 'events';
import type { RotatorState, RotatorCommand } from '@signalforge/shared';

/**
 * Hamlib rotctld Client — controls antenna rotators via the rotctld protocol.
 * 
 * Protocol: Simple text-based TCP
 * - Send: "p\n" (get position) → Response: "Azimuth: 180.0\nElevation: 45.0\n"
 * - Send: "P 180.0 45.0\n" (set position)
 * - Send: "S\n" (stop)
 * - Send: "_\n" (get info)
 * - Send: "q\n" (quit)
 */

const DEFAULT_ROTCTLD_PORT = 4533;

export class RotatorClient extends EventEmitter {
  private socket: Socket | null = null;
  private host: string;
  private port: number;
  private connected = false;
  private azimuth = 0;
  private elevation = 0;
  private targetAz?: number;
  private targetEl?: number;
  private moving = false;
  private model = 'Unknown';
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private responseBuffer = '';
  private pendingCallback: ((data: string) => void) | null = null;

  constructor(host: string, port?: number) {
    super();
    this.host = host;
    this.port = port || DEFAULT_ROTCTLD_PORT;
  }

  get isConnected() { return this.connected; }

  getState(): RotatorState {
    return {
      connected: this.connected,
      host: this.host,
      port: this.port,
      azimuth: this.azimuth,
      elevation: this.elevation,
      targetAzimuth: this.targetAz,
      targetElevation: this.targetEl,
      moving: this.moving,
      model: this.model,
    };
  }

  async connect(): Promise<RotatorState> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Rotator connection to ${this.host}:${this.port} timed out`));
        this.socket?.destroy();
      }, 10000);

      this.socket = new Socket();

      this.socket.on('connect', async () => {
        console.log(`🎯 Rotator connected to ${this.host}:${this.port}`);
        this.connected = true;
        clearTimeout(timeout);

        // Get initial position
        try {
          await this.pollPosition();
        } catch { /* ok */ }

        // Start polling position every 1s
        this.pollInterval = setInterval(() => this.pollPosition().catch(() => {}), 1000);

        resolve(this.getState());
      });

      this.socket.on('data', (data: Buffer) => {
        this.responseBuffer += data.toString();
        // Check if we have a complete response (ends with RPRT or newline after data)
        if (this.pendingCallback && (this.responseBuffer.includes('\n'))) {
          const response = this.responseBuffer.trim();
          this.responseBuffer = '';
          this.pendingCallback(response);
          this.pendingCallback = null;
        }
      });

      this.socket.on('error', (err) => {
        console.error(`🎯 Rotator error: ${err.message}`);
        clearTimeout(timeout);
        this.connected = false;
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('close', () => {
        console.log(`🎯 Rotator disconnected`);
        this.connected = false;
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.emit('disconnected');
      });

      this.socket.connect(this.port, this.host);
    });
  }

  disconnect() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.socket) {
      this.sendCommand('q');
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  private sendCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingCallback = resolve;
      this.responseBuffer = '';
      this.socket.write(cmd + '\n');
      // Timeout for response
      setTimeout(() => {
        if (this.pendingCallback === resolve) {
          this.pendingCallback = null;
          resolve(''); // timeout, return empty
        }
      }, 2000);
    });
  }

  private async pollPosition() {
    const response = await this.sendCommand('p');
    // Parse "Azimuth: 180.0\nElevation: 45.0" or just "180.0\n45.0"
    const lines = response.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const az = parseFloat(lines[0].replace(/^Azimuth:\s*/i, ''));
      const el = parseFloat(lines[1].replace(/^Elevation:\s*/i, ''));
      if (!isNaN(az)) this.azimuth = az;
      if (!isNaN(el)) this.elevation = el;

      // Check if we've reached target
      if (this.moving && this.targetAz !== undefined && this.targetEl !== undefined) {
        if (Math.abs(this.azimuth - this.targetAz) < 1 && Math.abs(this.elevation - this.targetEl) < 1) {
          this.moving = false;
        }
      }

      this.emit('position', this.getState());
    }
  }

  async setPosition(azimuth: number, elevation: number) {
    this.targetAz = azimuth;
    this.targetEl = elevation;
    this.moving = true;
    await this.sendCommand(`P ${azimuth.toFixed(1)} ${elevation.toFixed(1)}`);
    this.emit('position', this.getState());
  }

  async stop() {
    this.moving = false;
    await this.sendCommand('S');
    this.emit('position', this.getState());
  }

  async park() {
    await this.setPosition(0, 0);
  }

  async handleCommand(cmd: RotatorCommand) {
    switch (cmd.type) {
      case 'set_position':
        if (cmd.azimuth !== undefined && cmd.elevation !== undefined) {
          await this.setPosition(cmd.azimuth, cmd.elevation);
        }
        break;
      case 'stop':
        await this.stop();
        break;
      case 'park':
        await this.park();
        break;
    }
  }
}
