// ============================================================================
// SignalForge — Subprocess Decoder Manager
// Real subprocess integrations for rtl_433, multimon-ng, dump1090
// ============================================================================
import { EventEmitter } from 'events';
import { spawn, execSync, type ChildProcess } from 'child_process';
import * as net from 'net';

// ── Generic Subprocess Wrapper ──────────────────────────────────────────────

interface SubprocessConfig {
  name: string;
  command: string;
  args: string[];
  pipeFrom?: { command: string; args: string[] }; // optional stdin pipe
  parser: (line: string) => any | null;
  restartOnCrash: boolean;
  maxBackoffMs: number;
}

interface DecoderStatus {
  name: string;
  available: boolean;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  messagesDecoded: number;
  lastMessage: number | null;
  lastError: string | null;
  restartCount: number;
}

class SubprocessDecoder extends EventEmitter {
  private process: ChildProcess | null = null;
  private pipeProcess: ChildProcess | null = null;
  private running = false;
  private startedAt: number | null = null;
  private messagesDecoded = 0;
  private lastMessage: number | null = null;
  private lastError: string | null = null;
  private restartCount = 0;
  private backoffMs = 1000;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = '';

  constructor(private config: SubprocessConfig) {
    super();
  }

  get name() { return this.config.name; }

  isAvailable(): boolean {
    const bin = this.config.command;
    try {
      execSync(`which ${bin} 2>/dev/null`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  isRunning(): boolean { return this.running; }

  getStatus(): DecoderStatus {
    return {
      name: this.config.name,
      available: this.isAvailable(),
      running: this.running,
      pid: this.process?.pid ?? null,
      startedAt: this.startedAt,
      messagesDecoded: this.messagesDecoded,
      lastMessage: this.lastMessage,
      lastError: this.lastError,
      restartCount: this.restartCount,
    };
  }

  getRecentOutput(): any[] {
    // Managed externally by DecoderManager
    return [];
  }

  start(): boolean {
    if (this.running) return true;
    if (!this.isAvailable()) {
      this.lastError = `Binary '${this.config.command}' not found`;
      return false;
    }

    try {
      if (this.config.pipeFrom) {
        // Pipe mode: pipeFrom.command | config.command
        const src = spawn(this.config.pipeFrom.command, this.config.pipeFrom.args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.pipeProcess = src;

        this.process = spawn(this.config.command, this.config.args, {
          stdio: [src.stdout!, 'pipe', 'pipe'],
        });

        src.stderr?.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line) this.lastError = line;
        });

        src.on('error', (err) => {
          this.lastError = `Pipe source error: ${err.message}`;
        });
      } else {
        this.process = spawn(this.config.command, this.config.args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }

      this.running = true;
      this.startedAt = Date.now();
      this.backoffMs = 1000;

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = this.config.parser(trimmed);
            if (parsed) {
              this.messagesDecoded++;
              this.lastMessage = Date.now();
              this.emit('message', parsed);
            }
          } catch {
            // Skip unparseable lines
          }
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) this.lastError = line;
      });

      this.process.on('error', (err) => {
        this.lastError = err.message;
        this.running = false;
        this.emit('error', err);
      });

      this.process.on('exit', (code, signal) => {
        this.running = false;
        console.log(`📡 Decoder ${this.config.name} exited (code=${code}, signal=${signal})`);

        if (this.config.restartOnCrash && !signal) {
          this.scheduleRestart();
        }
      });

      console.log(`📡 Decoder ${this.config.name} started (PID ${this.process.pid})`);
      this.emit('started');
      return true;
    } catch (err: any) {
      this.lastError = err.message;
      this.running = false;
      return false;
    }
  }

  stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.pipeProcess) {
      try { this.pipeProcess.kill('SIGTERM'); } catch {}
      this.pipeProcess = null;
    }

    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch {}
      // Force kill after 3s
      const pid = this.process.pid;
      setTimeout(() => {
        try { if (pid) process.kill(pid, 'SIGKILL'); } catch {}
      }, 3000);
      this.process = null;
    }

    this.running = false;
    this.emit('stopped');
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    this.restartCount++;
    console.log(`📡 Decoder ${this.config.name} scheduling restart in ${this.backoffMs}ms (attempt ${this.restartCount})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.config.maxBackoffMs);
  }
}

// ── Decoder Manager ─────────────────────────────────────────────────────────

export class DecoderManager extends EventEmitter {
  private decoders = new Map<string, SubprocessDecoder>();
  private outputBuffers = new Map<string, Array<{ timestamp: number; data: any }>>();
  private readonly MAX_OUTPUT = 200;

  // SBS client for dump1090
  private sbsClient: net.Socket | null = null;
  private sbsConnected = false;

  constructor() {
    super();
    this.registerBuiltinDecoders();
  }

  private registerBuiltinDecoders(): void {
    // rtl_433 — ISM band IoT decoder
    this.registerDecoder({
      name: 'rtl_433',
      command: 'rtl_433',
      args: ['-F', 'json', '-M', 'utc', '-M', 'protocol'],
      parser: (line: string) => {
        try {
          const data = JSON.parse(line);
          return { type: 'ism_device', ...data };
        } catch {
          return null;
        }
      },
      restartOnCrash: true,
      maxBackoffMs: 30000,
    });

    // multimon-ng — pager decoder (piped from rtl_fm)
    this.registerDecoder({
      name: 'multimon-ng',
      command: 'multimon-ng',
      args: ['-a', 'POCSAG512', '-a', 'POCSAG1200', '-a', 'POCSAG2400', '-a', 'FLEX', '-t', 'raw', '-'],
      pipeFrom: {
        command: 'rtl_fm',
        args: ['-f', '153350000', '-s', '22050', '-g', '40', '-p', '0'],
      },
      parser: (line: string) => {
        // POCSAG512: Address: 1234567  Function: 0  Alpha:   Some message here
        // FLEX|...
        const pocsagMatch = line.match(/^(POCSAG\d+):\s+Address:\s+(\d+)\s+Function:\s+(\d+)\s+(Alpha|Numeric):\s*(.*)/i);
        if (pocsagMatch) {
          return {
            type: 'pager',
            protocol: pocsagMatch[1],
            address: parseInt(pocsagMatch[2]),
            capcode: parseInt(pocsagMatch[2]),
            function: parseInt(pocsagMatch[3]),
            encoding: pocsagMatch[4],
            content: pocsagMatch[5].trim(),
            timestamp: Date.now(),
          };
        }

        const flexMatch = line.match(/^FLEX[:|]\s*(.*)/i);
        if (flexMatch) {
          return {
            type: 'pager',
            protocol: 'FLEX',
            content: flexMatch[1].trim(),
            timestamp: Date.now(),
          };
        }
        return null;
      },
      restartOnCrash: true,
      maxBackoffMs: 30000,
    });

    // dump1090 — ADS-B decoder
    this.registerDecoder({
      name: 'dump1090',
      command: 'dump1090',
      args: ['--net', '--quiet'],
      parser: (_line: string) => {
        // dump1090 output to stdout is minimal in --quiet mode
        // Real data comes via SBS port 30003 (handled separately)
        return null;
      },
      restartOnCrash: true,
      maxBackoffMs: 30000,
    });
  }

  private registerDecoder(config: SubprocessConfig): void {
    const decoder = new SubprocessDecoder(config);
    this.decoders.set(config.name, decoder);
    this.outputBuffers.set(config.name, []);

    decoder.on('message', (data: any) => {
      const buf = this.outputBuffers.get(config.name)!;
      buf.push({ timestamp: Date.now(), data });
      if (buf.length > this.MAX_OUTPUT) buf.shift();
      this.emit('decoder_message', { decoder: config.name, data });
    });

    decoder.on('started', () => {
      this.emit('decoder_started', config.name);
      // If dump1090 started, connect to SBS port
      if (config.name === 'dump1090') {
        setTimeout(() => this.connectSBS(), 2000);
      }
    });

    decoder.on('stopped', () => {
      this.emit('decoder_stopped', config.name);
      if (config.name === 'dump1090') {
        this.disconnectSBS();
      }
    });

    decoder.on('error', (err: Error) => {
      this.emit('decoder_error', { decoder: config.name, error: err.message });
    });
  }

  // SBS connection for dump1090 (port 30003)
  private connectSBS(): void {
    if (this.sbsClient) return;

    this.sbsClient = new net.Socket();
    let buffer = '';

    this.sbsClient.connect(30003, '127.0.0.1', () => {
      this.sbsConnected = true;
      console.log('📡 dump1090 SBS connected on port 30003');
    });

    this.sbsClient.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = this.parseSBS(trimmed);
        if (parsed) {
          const buf = this.outputBuffers.get('dump1090')!;
          buf.push({ timestamp: Date.now(), data: parsed });
          if (buf.length > this.MAX_OUTPUT) buf.shift();
          this.emit('decoder_message', { decoder: 'dump1090', data: parsed });
        }
      }
    });

    this.sbsClient.on('error', () => { this.sbsConnected = false; });
    this.sbsClient.on('close', () => {
      this.sbsConnected = false;
      this.sbsClient = null;
    });
  }

  private disconnectSBS(): void {
    if (this.sbsClient) {
      this.sbsClient.destroy();
      this.sbsClient = null;
      this.sbsConnected = false;
    }
  }

  private parseSBS(line: string): any | null {
    const parts = line.split(',');
    if (parts[0] !== 'MSG') return null;
    const icao = parts[4]?.trim();
    if (!icao) return null;

    return {
      type: 'adsb',
      icao,
      messageType: parts[1],
      callsign: parts[10]?.trim() || undefined,
      altitude: parts[11]?.trim() ? parseInt(parts[11]) : undefined,
      speed: parts[12]?.trim() ? parseFloat(parts[12]) : undefined,
      heading: parts[13]?.trim() ? parseFloat(parts[13]) : undefined,
      latitude: parts[14]?.trim() ? parseFloat(parts[14]) : undefined,
      longitude: parts[15]?.trim() ? parseFloat(parts[15]) : undefined,
      verticalRate: parts[16]?.trim() ? parseInt(parts[16]) : undefined,
      squawk: parts[17]?.trim() || undefined,
      timestamp: Date.now(),
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getDecoders(): Array<DecoderStatus & { available: boolean }> {
    return Array.from(this.decoders.entries()).map(([, d]) => ({
      ...d.getStatus(),
      available: d.isAvailable(),
    }));
  }

  getDecoder(name: string): DecoderStatus | null {
    const d = this.decoders.get(name);
    return d ? d.getStatus() : null;
  }

  startDecoder(name: string): boolean {
    const d = this.decoders.get(name);
    if (!d) return false;
    return d.start();
  }

  stopDecoder(name: string): boolean {
    const d = this.decoders.get(name);
    if (!d) return false;
    d.stop();
    return true;
  }

  getOutput(name: string, limit = 50): Array<{ timestamp: number; data: any }> {
    const buf = this.outputBuffers.get(name);
    if (!buf) return [];
    return buf.slice(-limit);
  }

  // Stop all subprocesses — call on server shutdown
  stopAll(): void {
    for (const [, decoder] of this.decoders) {
      decoder.stop();
    }
    this.disconnectSBS();
  }
}
