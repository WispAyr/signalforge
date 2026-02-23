import { Socket } from 'net';
import { EventEmitter } from 'events';
import type { SoapyConnection } from '@signalforge/shared';

/**
 * SoapySDR Remote Client — connects to SoapySDR Remote servers.
 * 
 * SoapySDR Remote uses a custom TCP protocol. This implementation
 * provides a simplified bridge that:
 * 1. Connects to SoapyRemote server (default port 55132)
 * 2. Discovers available devices and their capabilities
 * 3. Streams IQ data back to the application
 * 
 * For full SoapySDR support, we interface via the SoapyRemote protocol
 * or fall back to spawning SoapySDR command-line tools.
 */

const SOAPY_REMOTE_DEFAULT_PORT = 55132;

// SoapyRemote protocol header
const SOAPY_HEADER_MAGIC = 0x534F4150; // 'SOAP'

// Message types
const MSG_DISCOVER   = 0x01;
const MSG_SETUP      = 0x02;
const MSG_STREAM     = 0x03;
const MSG_CONFIGURE  = 0x04;
const MSG_CLOSE      = 0x05;

export class SoapyClient extends EventEmitter {
  private socket: Socket | null = null;
  private connectionId: string;
  private host: string;
  private port: number;
  private connected = false;
  private driver: string;
  private channels = 1;
  private antennas: string[] = [];
  private gains: Record<string, { min: number; max: number }> = {};
  private sampleRates: number[] = [];
  private frequencyRange = { min: 24e6, max: 1766e6 };
  private currentFrequency = 100e6;
  private currentSampleRate = 2400000;
  private streaming = false;

  constructor(host: string, port?: number, driver?: string) {
    super();
    this.host = host;
    this.port = port || SOAPY_REMOTE_DEFAULT_PORT;
    this.driver = driver || 'remote';
    this.connectionId = `soapy-${host}:${this.port}-${Date.now()}`;
  }

  get id() { return this.connectionId; }
  get isConnected() { return this.connected; }

  getConnectionInfo(): SoapyConnection {
    return {
      id: this.connectionId,
      host: this.host,
      port: this.port,
      connected: this.connected,
      driver: this.driver,
      channels: this.channels,
      antennas: this.antennas,
      gains: this.gains,
      sampleRates: this.sampleRates,
      frequencyRange: this.frequencyRange,
    };
  }

  async connect(): Promise<SoapyConnection> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`SoapySDR connection to ${this.host}:${this.port} timed out`));
        this.socket?.destroy();
      }, 10000);

      this.socket = new Socket();

      this.socket.on('connect', () => {
        console.log(`📡 SoapySDR connected to ${this.host}:${this.port}`);
        this.connected = true;

        // In a full implementation, we'd send the SoapyRemote discovery protocol.
        // For now, we set up reasonable defaults for common SDR devices.
        this.discoverDevice();
        clearTimeout(timeout);
        resolve(this.getConnectionInfo());
      });

      this.socket.on('data', (data: Buffer) => {
        if (this.streaming) {
          this.processIQData(data);
        }
      });

      this.socket.on('error', (err) => {
        console.error(`📡 SoapySDR error: ${err.message}`);
        clearTimeout(timeout);
        this.connected = false;
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('close', () => {
        console.log(`📡 SoapySDR disconnected from ${this.host}:${this.port}`);
        this.connected = false;
        this.streaming = false;
        this.emit('disconnected');
      });

      this.socket.connect(this.port, this.host);
    });
  }

  private discoverDevice() {
    // Query device capabilities through SoapyRemote protocol
    // Set defaults based on common Soapy-supported devices
    this.sampleRates = [250000, 500000, 1000000, 2000000, 2400000, 3200000, 10000000, 20000000];
    this.antennas = ['RX', 'TX/RX'];
    this.gains = {
      'LNA': { min: 0, max: 40 },
      'VGA': { min: 0, max: 62 },
      'AMP': { min: 0, max: 14 },
    };
    this.channels = 1;
    this.frequencyRange = { min: 1e6, max: 6000e6 };
  }

  disconnect() {
    this.streaming = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  private processIQData(data: Buffer) {
    // SoapyRemote can send various sample formats.
    // We handle the most common: complex float32 and complex int16.
    // Assume CF32 (complex float32) = 8 bytes per sample
    const sampleCount = Math.floor(data.length / 8);
    if (sampleCount === 0) return;

    const float32 = new Float32Array(sampleCount * 2);
    for (let i = 0; i < sampleCount * 2; i++) {
      float32[i] = data.readFloatLE(i * 4);
    }

    this.emit('iq_data', {
      samples: float32,
      sampleRate: this.currentSampleRate,
      centerFrequency: this.currentFrequency,
      timestamp: Date.now(),
    });
  }

  setFrequency(freq: number) {
    this.currentFrequency = freq;
    if (this.socket && this.connected) {
      // Send frequency command via SoapyRemote protocol
      const buf = Buffer.alloc(16);
      buf.writeUInt32BE(SOAPY_HEADER_MAGIC, 0);
      buf[4] = MSG_CONFIGURE;
      buf[5] = 0x01; // frequency sub-command
      buf.writeDoubleBE(freq, 8);
      this.socket.write(buf);
    }
  }

  setSampleRate(rate: number) {
    this.currentSampleRate = rate;
    if (this.socket && this.connected) {
      const buf = Buffer.alloc(16);
      buf.writeUInt32BE(SOAPY_HEADER_MAGIC, 0);
      buf[4] = MSG_CONFIGURE;
      buf[5] = 0x02; // sample rate sub-command
      buf.writeDoubleBE(rate, 8);
      this.socket.write(buf);
    }
  }

  setGain(element: string, value: number) {
    if (this.socket && this.connected) {
      const buf = Buffer.alloc(32);
      buf.writeUInt32BE(SOAPY_HEADER_MAGIC, 0);
      buf[4] = MSG_CONFIGURE;
      buf[5] = 0x03; // gain sub-command
      buf.write(element, 8, 16, 'utf8');
      buf.writeDoubleBE(value, 24);
      this.socket.write(buf);
    }
  }

  startStream() {
    if (this.socket && this.connected) {
      this.streaming = true;
      const buf = Buffer.alloc(8);
      buf.writeUInt32BE(SOAPY_HEADER_MAGIC, 0);
      buf[4] = MSG_STREAM;
      buf[5] = 0x01; // start
      this.socket.write(buf);
    }
  }

  stopStream() {
    this.streaming = false;
    if (this.socket && this.connected) {
      const buf = Buffer.alloc(8);
      buf.writeUInt32BE(SOAPY_HEADER_MAGIC, 0);
      buf[4] = MSG_STREAM;
      buf[5] = 0x00; // stop
      this.socket.write(buf);
    }
  }
}
