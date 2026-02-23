import { EventEmitter } from 'events';
import WebSocket from 'ws';
import http from 'http';

export interface WebSDRReceiver {
  id: string;
  name: string;
  location: string;
  url: string;
  type: 'kiwisdr' | 'websdr';
  bands: string;
  frequencyRange: { min: number; max: number };
  status: 'online' | 'offline' | 'unknown';
}

export interface WebSDRStatus {
  connected: boolean;
  receiver: WebSDRReceiver | null;
  frequency: number;
  mode: string;
  lowCut: number;
  highCut: number;
  streaming: boolean;
}

const CURATED_RECEIVERS: WebSDRReceiver[] = [
  {
    id: 'twente', name: 'University of Twente', location: 'Netherlands',
    url: 'websdr.ewi.utwente.nl:8901', type: 'websdr',
    bands: '0-29 MHz', frequencyRange: { min: 0, max: 29000 }, status: 'unknown',
  },
  {
    id: 'suws', name: 'Wide-band WebSDR', location: 'UK',
    url: 'websdr.suws.org.uk', type: 'websdr',
    bands: 'HF', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'hackgreen', name: 'Hack Green', location: 'UK',
    url: 'hackgreen.kiwisdr.com:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'barcelona', name: 'KiwiSDR Barcelona', location: 'Spain',
    url: 'ea3ij.duckdns.org:8073', type: 'kiwisdr',
    bands: 'HF', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'utah', name: 'Northern Utah WebSDR', location: 'USA',
    url: 'sdrutah.org', type: 'websdr',
    bands: 'HF/VHF', frequencyRange: { min: 0, max: 150000 }, status: 'unknown',
  },
  {
    id: 'kfs', name: 'KFS Half Moon Bay', location: 'USA (CA)',
    url: 'kfs.wsprdaemon.org:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'gronau', name: 'KiwiSDR Gronau', location: 'Germany',
    url: 'dl1hrc.dyndns.org:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'sweden', name: 'KiwiSDR Sweden', location: 'Sweden',
    url: 'sm5ovk.se:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'japan', name: 'KiwiSDR Tokyo', location: 'Japan',
    url: 'kiwisdr.robinett.us:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'newzealand', name: 'KiwiSDR New Zealand', location: 'New Zealand',
    url: 'kiwisdr.ece.uvic.ca:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'eibi', name: 'EiBi KiwiSDR', location: 'Germany',
    url: 'kiwi-eibi.ddns.net:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
  {
    id: 'australia', name: 'KiwiSDR Australia', location: 'Australia',
    url: 'sdr.vk4ya.com:8073', type: 'kiwisdr',
    bands: '0-30 MHz', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
  },
];

export class WebSDRService extends EventEmitter {
  private kiwiWs: WebSocket | null = null;
  private httpReq: http.ClientRequest | null = null;
  private currentReceiver: WebSDRReceiver | null = null;
  private frequency = 7074;
  private mode = 'am';
  private lowCut = -5000;
  private highCut = 5000;
  private connected = false;
  private streaming = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  listReceivers(): WebSDRReceiver[] {
    return CURATED_RECEIVERS;
  }

  getStatus(): WebSDRStatus {
    return {
      connected: this.connected,
      receiver: this.currentReceiver,
      frequency: this.frequency,
      mode: this.mode,
      lowCut: this.lowCut,
      highCut: this.highCut,
      streaming: this.streaming,
    };
  }

  async connect(receiverUrl: string, frequency: number, mode: string): Promise<boolean> {
    // Find receiver from curated list or create ad-hoc
    const receiver = CURATED_RECEIVERS.find(r => r.url === receiverUrl || r.id === receiverUrl);
    if (!receiver) {
      // Allow ad-hoc connection
      this.currentReceiver = {
        id: 'custom', name: 'Custom Receiver', location: 'Unknown',
        url: receiverUrl, type: receiverUrl.includes('8073') ? 'kiwisdr' : 'websdr',
        bands: 'Unknown', frequencyRange: { min: 0, max: 30000 }, status: 'unknown',
      };
    } else {
      this.currentReceiver = { ...receiver };
    }

    this.frequency = frequency;
    this.mode = mode;

    // Disconnect existing
    this.disconnectInternal();

    try {
      if (this.currentReceiver.type === 'kiwisdr') {
        return await this.connectKiwiSDR();
      } else {
        return this.connectWebSDR();
      }
    } catch (err) {
      console.error('[WebSDR] Connection failed:', err);
      this.connected = false;
      this.emit('error', { message: (err as Error).message });
      return false;
    }
  }

  private async connectKiwiSDR(): Promise<boolean> {
    const receiver = this.currentReceiver!;
    const host = receiver.url.includes('://') ? receiver.url : `http://${receiver.url}`;
    const wsUrl = `ws://${receiver.url}/kiwi/${Date.now()}/SND`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 15000);

      try {
        this.kiwiWs = new WebSocket(wsUrl, {
          headers: { 'Origin': host },
          handshakeTimeout: 10000,
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }

      this.kiwiWs.on('open', () => {
        clearTimeout(timeout);
        console.log(`[WebSDR] KiwiSDR connected: ${receiver.name}`);
        
        // Auth
        this.kiwiWs!.send('SET auth t=kiwi p=');
        // Audio config
        this.kiwiWs!.send('SET AR OK in=12000 out=44100');
        // Tune
        this.kiwiWs!.send(`SET mod=${this.mode} low_cut=${this.lowCut} high_cut=${this.highCut} freq=${this.frequency}`);
        // Keep alive
        this.kiwiWs!.send('SET keepalive');

        this.connected = true;
        this.streaming = true;
        this.currentReceiver!.status = 'online';
        this.emit('connected', { receiver: this.currentReceiver });
        resolve(true);
      });

      this.kiwiWs.on('message', (data: Buffer | string) => {
        if (Buffer.isBuffer(data) && data.length > 0) {
          // KiwiSDR binary frames: first 3 bytes are header tag
          const tag = data.subarray(0, 3).toString('ascii');
          if (tag === 'SND') {
            // Audio data: skip header (various sizes, typically ~7 bytes)
            // Flags at byte 3, sequence at 4-5, RSSI at 6-7, then PCM audio
            const audioData = data.subarray(7);
            if (audioData.length > 0) {
              this.emit('audio', audioData);
            }
          } else if (tag === 'MSG') {
            // Text message from server
            const msg = data.subarray(4).toString('utf8');
            if (msg.includes('too_busy')) {
              console.log('[WebSDR] Receiver is too busy');
              this.emit('error', { message: 'Receiver is too busy, try another' });
            }
          }
        } else if (typeof data === 'string') {
          // Sometimes text messages
          if (data.includes('too_busy')) {
            this.emit('error', { message: 'Receiver is too busy' });
          }
        }
      });

      this.kiwiWs.on('close', () => {
        console.log('[WebSDR] KiwiSDR disconnected');
        this.connected = false;
        this.streaming = false;
        this.emit('disconnected');
      });

      this.kiwiWs.on('error', (err) => {
        console.error('[WebSDR] KiwiSDR error:', err.message);
        clearTimeout(timeout);
        if (!this.connected) {
          reject(err);
        } else {
          this.emit('error', { message: err.message });
        }
      });
    });
  }

  private connectWebSDR(): boolean {
    const receiver = this.currentReceiver!;
    const freqKhz = this.frequency;
    const url = `http://${receiver.url}/~~stream?freq=${freqKhz}&band=0&lo=${this.lowCut / 1000}&hi=${this.highCut / 1000}&mode=${this.mode}`;

    console.log(`[WebSDR] Connecting to WebSDR stream: ${url}`);

    this.httpReq = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        console.error(`[WebSDR] HTTP ${res.statusCode}`);
        this.emit('error', { message: `HTTP ${res.statusCode}` });
        res.resume();
        return;
      }

      this.connected = true;
      this.streaming = true;
      this.currentReceiver!.status = 'online';
      this.emit('connected', { receiver: this.currentReceiver });

      res.on('data', (chunk: Buffer) => {
        this.emit('audio', chunk);
      });

      res.on('end', () => {
        console.log('[WebSDR] Stream ended');
        this.connected = false;
        this.streaming = false;
        this.emit('disconnected');
      });
    });

    this.httpReq.on('error', (err) => {
      console.error('[WebSDR] HTTP error:', err.message);
      this.connected = false;
      this.emit('error', { message: err.message });
    });

    this.httpReq.setTimeout(15000, () => {
      this.httpReq?.destroy();
      this.emit('error', { message: 'Connection timeout' });
    });

    return true;
  }

  tune(frequency: number, mode: string, lowCut?: number, highCut?: number): boolean {
    this.frequency = frequency;
    this.mode = mode;
    if (lowCut !== undefined) this.lowCut = lowCut;
    if (highCut !== undefined) this.highCut = highCut;

    // Set appropriate bandwidth defaults based on mode
    if (lowCut === undefined || highCut === undefined) {
      switch (mode) {
        case 'am': this.lowCut = -5000; this.highCut = 5000; break;
        case 'usb': this.lowCut = 0; this.highCut = 3000; break;
        case 'lsb': this.lowCut = -3000; this.highCut = 0; break;
        case 'cw': this.lowCut = -250; this.highCut = 250; break;
        case 'fm': this.lowCut = -8000; this.highCut = 8000; break;
      }
    }

    if (this.kiwiWs && this.kiwiWs.readyState === WebSocket.OPEN) {
      this.kiwiWs.send(`SET mod=${this.mode} low_cut=${this.lowCut} high_cut=${this.highCut} freq=${this.frequency}`);
      this.emit('tuned', { frequency: this.frequency, mode: this.mode });
      return true;
    }

    // For WebSDR, need to reconnect with new params
    if (this.httpReq && this.currentReceiver?.type === 'websdr') {
      this.disconnectInternal();
      this.connectWebSDR();
      this.emit('tuned', { frequency: this.frequency, mode: this.mode });
      return true;
    }

    return false;
  }

  disconnect(): void {
    this.disconnectInternal();
    this.currentReceiver = null;
    this.connected = false;
    this.streaming = false;
    this.emit('disconnected');
  }

  private disconnectInternal(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.kiwiWs) {
      try { this.kiwiWs.close(); } catch {}
      this.kiwiWs = null;
    }
    if (this.httpReq) {
      try { this.httpReq.destroy(); } catch {}
      this.httpReq = null;
    }
    this.connected = false;
    this.streaming = false;
  }
}
