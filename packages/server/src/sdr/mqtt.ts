import { EventEmitter } from 'events';
import { Socket } from 'net';
import type { MqttConfig, MqttTopicConfig, MqttMessage } from '@signalforge/shared';

/**
 * MQTT Client — lightweight MQTT 3.1.1 implementation.
 * 
 * Supports:
 * - Connect to any MQTT broker
 * - Publish decoded data (aircraft, vessels, APRS, signals)
 * - Subscribe to external data feeds
 * - QoS 0 (at most once) — sufficient for telemetry data
 * 
 * No external dependencies — implements MQTT protocol directly.
 */

// MQTT packet types
const CONNECT     = 0x10;
const CONNACK     = 0x20;
const PUBLISH     = 0x30;
const SUBSCRIBE   = 0x80;
const SUBACK      = 0x90;
const PINGREQ     = 0xC0;
const PINGRESP    = 0xD0;
const DISCONNECT  = 0xE0;

export class MqttClient extends EventEmitter {
  private socket: Socket | null = null;
  private config: MqttConfig;
  private connected = false;
  private messageLog: MqttMessage[] = [];
  private maxLog = 200;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private receiveBuffer = Buffer.alloc(0);
  private packetId = 1;

  constructor() {
    super();
    this.config = {
      broker: 'localhost',
      port: 1883,
      clientId: `signalforge-${Date.now().toString(36)}`,
      topics: [],
      connected: false,
    };
  }

  getConfig(): MqttConfig {
    return { ...this.config, connected: this.connected };
  }

  getMessages(limit = 50): MqttMessage[] {
    return this.messageLog.slice(0, limit);
  }

  async connect(broker: string, port = 1883, username?: string, password?: string): Promise<MqttConfig> {
    return new Promise((resolve, reject) => {
      this.config.broker = broker;
      this.config.port = port;
      this.config.username = username;
      this.config.password = password;

      const timeout = setTimeout(() => {
        reject(new Error('MQTT connection timed out'));
        this.socket?.destroy();
      }, 10000);

      this.socket = new Socket();

      this.socket.on('connect', () => {
        // Send CONNECT packet
        this.sendConnect();
      });

      this.socket.on('data', (data: Buffer) => {
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
        this.processBuffer();

        if (!this.connected) {
          // Check for CONNACK
          if (data[0] === CONNACK && data.length >= 4 && data[3] === 0) {
            this.connected = true;
            this.config.connected = true;
            clearTimeout(timeout);

            // Subscribe to configured topics
            for (const topic of this.config.topics) {
              if (topic.direction === 'subscribe') {
                this.subscribe(topic.topic, topic.qos);
              }
            }

            // Start keepalive
            this.pingInterval = setInterval(() => this.sendPing(), 30000);

            console.log(`📡 MQTT connected to ${broker}:${port}`);
            resolve(this.getConfig());
          }
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        this.connected = false;
        this.config.connected = false;
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.config.connected = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.emit('disconnected');
      });

      this.socket.connect(port, broker);
    });
  }

  disconnect() {
    if (this.socket && this.connected) {
      const buf = Buffer.from([DISCONNECT, 0]);
      this.socket.write(buf);
    }
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
    this.config.connected = false;
  }

  private sendConnect() {
    const clientId = this.config.clientId || 'signalforge';
    const parts: Buffer[] = [];

    // Variable header
    const protocol = Buffer.from([0, 4, ...Buffer.from('MQTT'), 4]); // MQTT 3.1.1
    let connectFlags = 0x02; // Clean session

    if (this.config.username) connectFlags |= 0x80;
    if (this.config.password) connectFlags |= 0x40;

    parts.push(protocol);
    parts.push(Buffer.from([connectFlags]));
    parts.push(Buffer.from([0, 60])); // Keepalive 60s

    // Payload: client ID
    const clientIdBuf = Buffer.from(clientId, 'utf8');
    parts.push(Buffer.from([clientIdBuf.length >> 8, clientIdBuf.length & 0xff]));
    parts.push(clientIdBuf);

    if (this.config.username) {
      const userBuf = Buffer.from(this.config.username, 'utf8');
      parts.push(Buffer.from([userBuf.length >> 8, userBuf.length & 0xff]));
      parts.push(userBuf);
    }
    if (this.config.password) {
      const passBuf = Buffer.from(this.config.password, 'utf8');
      parts.push(Buffer.from([passBuf.length >> 8, passBuf.length & 0xff]));
      parts.push(passBuf);
    }

    const payload = Buffer.concat(parts);
    const header = this.encodeHeader(CONNECT, payload.length);
    this.socket?.write(Buffer.concat([header, payload]));
  }

  subscribe(topic: string, qos: 0 | 1 | 2 = 0) {
    if (!this.socket || !this.connected) return;

    const topicBuf = Buffer.from(topic, 'utf8');
    const packetId = this.packetId++;
    const payload = Buffer.concat([
      Buffer.from([packetId >> 8, packetId & 0xff]),
      Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xff]),
      topicBuf,
      Buffer.from([qos]),
    ]);

    const header = this.encodeHeader(SUBSCRIBE | 0x02, payload.length);
    this.socket.write(Buffer.concat([header, payload]));

    // Add to config if not already there
    if (!this.config.topics.find(t => t.topic === topic && t.direction === 'subscribe')) {
      this.config.topics.push({ topic, direction: 'subscribe', format: 'json', qos });
    }
  }

  publish(topic: string, payload: string | Buffer, qos: 0 | 1 | 2 = 0) {
    if (!this.socket || !this.connected) return;

    const topicBuf = Buffer.from(topic, 'utf8');
    const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;

    const parts: Uint8Array[] = [
      Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xff]),
      topicBuf,
    ];

    if (qos > 0) {
      const packetId = this.packetId++;
      parts.push(Buffer.from([packetId >> 8, packetId & 0xff]));
    }

    parts.push(payloadBuf);
    const body = Buffer.concat(parts);
    const header = this.encodeHeader(PUBLISH | (qos << 1), body.length);
    this.socket.write(Buffer.concat([header, body]));

    this.logMessage(topic, typeof payload === 'string' ? payload : payload.toString(), 'out');
  }

  addTopicConfig(config: MqttTopicConfig) {
    this.config.topics.push(config);
    if (this.connected && config.direction === 'subscribe') {
      this.subscribe(config.topic, config.qos);
    }
  }

  removeTopicConfig(topic: string) {
    this.config.topics = this.config.topics.filter(t => t.topic !== topic);
  }

  private processBuffer() {
    while (this.receiveBuffer.length >= 2) {
      const type = this.receiveBuffer[0] & 0xf0;
      let remainLength = 0;
      let multiplier = 1;
      let pos = 1;

      // Decode remaining length
      do {
        if (pos >= this.receiveBuffer.length) return; // Need more data
        remainLength += (this.receiveBuffer[pos] & 0x7f) * multiplier;
        multiplier *= 128;
      } while (this.receiveBuffer[pos++] & 0x80);

      const totalLen = pos + remainLength;
      if (this.receiveBuffer.length < totalLen) return; // Need more data

      const packet = this.receiveBuffer.subarray(0, totalLen);
      this.receiveBuffer = this.receiveBuffer.subarray(totalLen);

      this.handlePacket(type, packet.subarray(pos, totalLen));
    }
  }

  private handlePacket(type: number, payload: Buffer) {
    switch (type) {
      case PUBLISH: {
        // Parse PUBLISH packet
        if (payload.length < 2) return;
        const topicLen = (payload[0] << 8) | payload[1];
        if (payload.length < 2 + topicLen) return;
        const topic = payload.subarray(2, 2 + topicLen).toString('utf8');
        const data = payload.subarray(2 + topicLen).toString('utf8');
        this.logMessage(topic, data, 'in');
        this.emit('message', { topic, payload: data, timestamp: Date.now(), direction: 'in' as const });
        break;
      }
      case PINGRESP:
        // Keepalive response — all good
        break;
    }
  }

  private sendPing() {
    if (this.socket && this.connected) {
      this.socket.write(Buffer.from([PINGREQ, 0]));
    }
  }

  private encodeHeader(type: number, length: number): Buffer {
    const parts = [type];
    let remaining = length;
    do {
      let byte = remaining & 0x7f;
      remaining >>= 7;
      if (remaining > 0) byte |= 0x80;
      parts.push(byte);
    } while (remaining > 0);
    return Buffer.from(parts);
  }

  private logMessage(topic: string, payload: string, direction: 'in' | 'out') {
    const msg: MqttMessage = { topic, payload, timestamp: Date.now(), direction };
    this.messageLog.unshift(msg);
    if (this.messageLog.length > this.maxLog) this.messageLog.pop();
  }
}
