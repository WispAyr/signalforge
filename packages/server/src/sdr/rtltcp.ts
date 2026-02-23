import { Socket } from 'net';
import { EventEmitter } from 'events';
import type { RtlTcpConnection, SDRConfig } from '@signalforge/shared';

/**
 * RTL-TCP Client — connects to rtl_tcp server instances for IQ streaming.
 * 
 * Protocol:
 * - TCP connection to host:port
 * - First 12 bytes from server: magic (4) + tuner type (4) + gain count (4)
 * - After handshake: raw unsigned 8-bit IQ samples stream
 * - Commands: 5-byte packets (1 byte command + 4 byte big-endian value)
 */

// rtl_tcp command bytes
const CMD_SET_FREQUENCY     = 0x01;
const CMD_SET_SAMPLE_RATE   = 0x02;
const CMD_SET_GAIN_MODE     = 0x03;  // 0=auto, 1=manual
const CMD_SET_GAIN          = 0x04;
const CMD_SET_FREQ_CORR     = 0x05;
const CMD_SET_IF_GAIN       = 0x06;
const CMD_SET_AGC_MODE      = 0x08;
const CMD_SET_DIRECT_SAMPLING = 0x09;
const CMD_SET_OFFSET_TUNING = 0x0a;
const CMD_SET_BIAS_TEE      = 0x0e;

const TUNER_TYPES: Record<number, string> = {
  1: 'E4000',
  2: 'FC0012',
  3: 'FC0013',
  4: 'FC2580',
  5: 'R820T',
  6: 'R828D',
};

export class RtlTcpClient extends EventEmitter {
  private socket: Socket | null = null;
  private connectionId: string;
  private host: string;
  private port: number;
  private connected = false;
  private handshakeComplete = false;
  private tunerType = 'Unknown';
  private gainCount = 0;
  private config: SDRConfig;
  private receiveBuffer = Buffer.alloc(0);

  constructor(host: string, port: number) {
    super();
    this.on("error", () => {}); // Prevent unhandled error crash
    this.host = host;
    this.port = port;
    this.connectionId = `rtltcp-${host}:${port}-${Date.now()}`;
    this.config = {
      deviceId: this.connectionId,
      centerFrequency: 100e6,
      sampleRate: 2400000,
      gain: 40,
      agc: false,
    };
  }

  get id() { return this.connectionId; }
  get isConnected() { return this.connected; }

  getConnectionInfo(): RtlTcpConnection {
    return {
      id: this.connectionId,
      host: this.host,
      port: this.port,
      connected: this.connected,
      deviceInfo: this.handshakeComplete ? {
        tunerType: this.tunerType,
        gainCount: this.gainCount,
      } : undefined,
      config: { ...this.config },
    };
  }

  async connect(): Promise<RtlTcpConnection> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection to ${this.host}:${this.port} timed out`));
        this.socket?.destroy();
      }, 10000);

      this.socket = new Socket();

      this.socket.on('connect', () => {
        console.log(`📡 RTL-TCP connected to ${this.host}:${this.port}`);
        this.connected = true;
      });

      this.socket.on('data', (data: Buffer) => {
        if (!this.handshakeComplete) {
          // First 12 bytes = handshake
          this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
          if (this.receiveBuffer.length >= 12) {
            const magic = this.receiveBuffer.toString('ascii', 0, 4);
            if (magic === 'RTL0') {
              const tunerTypeId = this.receiveBuffer.readUInt32BE(4);
              this.gainCount = this.receiveBuffer.readUInt32BE(8);
              this.tunerType = TUNER_TYPES[tunerTypeId] || `Unknown(${tunerTypeId})`;
              console.log(`📡 RTL-TCP handshake: tuner=${this.tunerType}, gains=${this.gainCount}`);
            }
            this.handshakeComplete = true;
            clearTimeout(timeout);

            // Apply initial config
            this.setFrequency(this.config.centerFrequency);
            this.setSampleRate(this.config.sampleRate);
            this.setGain(this.config.gain);
            if (this.config.agc) this.setAGC(true);

            resolve(this.getConnectionInfo());

            // Process remaining data as IQ
            const remaining = this.receiveBuffer.subarray(12);
            if (remaining.length > 0) {
              this.processIQData(remaining);
            }
            this.receiveBuffer = Buffer.alloc(0);
          }
        } else {
          this.processIQData(data);
        }
      });

      this.socket.on('error', (err) => {
        console.error(`📡 RTL-TCP error: ${err.message}`);
        clearTimeout(timeout);
        this.connected = false;
        console.error("RTL-TCP error:", err.message);
        reject(err);
      });

      this.socket.on('close', () => {
        console.log(`📡 RTL-TCP disconnected from ${this.host}:${this.port}`);
        this.connected = false;
        this.handshakeComplete = false;
        this.emit('disconnected');
      });

      this.socket.connect(this.port, this.host);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.handshakeComplete = false;
  }

  private processIQData(data: Buffer) {
    // Convert unsigned 8-bit IQ to float32 interleaved
    // rtl_tcp sends uint8 samples: 0-255 -> -1.0 to +1.0
    const sampleCount = Math.floor(data.length / 2);
    const float32 = new Float32Array(sampleCount * 2);
    for (let i = 0; i < sampleCount * 2; i++) {
      float32[i] = (data[i] - 127.5) / 127.5;
    }

    this.emit('iq_data', {
      samples: float32,
      sampleRate: this.config.sampleRate,
      centerFrequency: this.config.centerFrequency,
      timestamp: Date.now(),
    });
  }

  private sendCommand(cmd: number, value: number) {
    if (!this.socket || !this.connected) return;
    const buf = Buffer.alloc(5);
    buf[0] = cmd;
    buf.writeUInt32BE(value >>> 0, 1);
    this.socket.write(buf);
  }

  setFrequency(freq: number) {
    this.config.centerFrequency = freq;
    this.sendCommand(CMD_SET_FREQUENCY, freq);
  }

  setSampleRate(rate: number) {
    this.config.sampleRate = rate;
    this.sendCommand(CMD_SET_SAMPLE_RATE, rate);
  }

  setGain(gain: number) {
    this.config.gain = gain;
    // Switch to manual gain mode first
    this.sendCommand(CMD_SET_GAIN_MODE, 1);
    // Gain in tenths of dB
    this.sendCommand(CMD_SET_GAIN, Math.round(gain * 10));
  }

  setAGC(enabled: boolean) {
    this.config.agc = enabled;
    this.sendCommand(CMD_SET_AGC_MODE, enabled ? 1 : 0);
    if (enabled) {
      this.sendCommand(CMD_SET_GAIN_MODE, 0);
    }
  }

  setFrequencyCorrection(ppm: number) {
    this.config.ppm = ppm;
    this.sendCommand(CMD_SET_FREQ_CORR, ppm);
  }

  setBiasTee(enabled: boolean) {
    this.sendCommand(CMD_SET_BIAS_TEE, enabled ? 1 : 0);
  }
}
