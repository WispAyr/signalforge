import { getGpuDspEngine } from "../gpu/engine";
import { getIQProcessor } from "../sdr/IQProcessor";

// ============================================================================
// Types
// ============================================================================

interface FlowNodeDef {
  id: string;
  type: string;
  params?: Record<string, unknown>;
}

interface FlowConnectionDef {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

type ProcessorFn = (input: Float32Array | null, params: Record<string, unknown>, ctx: NodeContext) => Promise<Float32Array | null> | Float32Array | null;

interface NodeContext {
  nodeId: string;
  canvasRef?: HTMLCanvasElement | null;
  audioCtx?: AudioContext | null;
  gainNode?: GainNode | null;
  cleanup: (() => void)[];
  state: Record<string, unknown>;
}

// ============================================================================
// Node Processors
// ============================================================================

const processors: Record<string, ProcessorFn> = {
  // Sources
  sdr_source: async (_input, _params, ctx) => {
    // IQProcessor handles the WS connection; this node just passes through
    // The flow runner wires IQProcessor output to this node externally
    return ctx.state.lastIQ as Float32Array | null ?? null;
  },

  websdr_source: async (_input, params, _ctx) => {
    // Trigger WebSDR connect via API
    if (!_ctx.state.connected) {
      const url = params.url as string || "hackgreen";
      const freq = params.frequency as number || 7074;
      const mode = params.mode as string || "usb";
      try {
        await fetch("/api/websdr/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, frequency: freq, mode }),
        });
        _ctx.state.connected = true;
      } catch {}
    }
    return _ctx.state.lastAudio as Float32Array | null ?? null;
  },

  noise_gen: (_input, params, ctx) => {
    const size = (params.samples as number) || 4096;
    const amp = (params.amplitude as number) || 0.1;
    const out = new Float32Array(size * 2);
    for (let i = 0; i < size * 2; i++) out[i] = (Math.random() - 0.5) * amp;
    return out;
  },

  tone_gen: (_input, params, ctx) => {
    const size = (params.samples as number) || 4096;
    const freq = (params.freq as number) || 1000;
    const rate = (params.rate as number) || 2400000;
    const out = new Float32Array(size * 2);
    for (let i = 0; i < size; i++) {
      const t = ((ctx.state.seq as number) || 0) * size + i;
      out[i * 2] = Math.cos(2 * Math.PI * freq * t / rate);
      out[i * 2 + 1] = Math.sin(2 * Math.PI * freq * t / rate);
    }
    ctx.state.seq = ((ctx.state.seq as number) || 0) + 1;
    return out;
  },

  // Processing
  fft: async (input, params, _ctx) => {
    if (!input) return null;
    const engine = await getGpuDspEngine();
    const size = (params.size as number) || 2048;
    return engine.fft(input, size);
  },

  lowpass: async (input, params, _ctx) => {
    if (!input) return null;
    const engine = await getGpuDspEngine();
    const cutoff = (params.cutoff as number) || 0.25;
    const taps = designLowpass(cutoff, 31);
    return engine.filter(input, taps);
  },

  highpass: async (input, params, _ctx) => {
    if (!input) return null;
    const engine = await getGpuDspEngine();
    const cutoff = (params.cutoff as number) || 0.25;
    const taps = designHighpass(cutoff, 31);
    return engine.filter(input, taps);
  },

  bandpass: async (input, params, _ctx) => {
    if (!input) return null;
    const engine = await getGpuDspEngine();
    const low = (params.low as number) || 0.1;
    const high = (params.high as number) || 0.4;
    const taps = designBandpass(low, high, 31);
    return engine.filter(input, taps);
  },

  fm_demod: async (input, _params, _ctx) => {
    if (!input || input.length < 4) return null;
    const engine = await getGpuDspEngine();
    const iData = new Float32Array(input.length / 2);
    const qData = new Float32Array(input.length / 2);
    for (let i = 0; i < iData.length; i++) {
      iData[i] = input[i * 2];
      qData[i] = input[i * 2 + 1];
    }
    return engine.fmDemod(iData, qData);
  },

  am_demod: (input, _params, _ctx) => {
    if (!input || input.length < 4) return null;
    const out = new Float32Array(input.length / 2);
    for (let i = 0; i < out.length; i++) {
      const I = input[i * 2];
      const Q = input[i * 2 + 1];
      out[i] = Math.sqrt(I * I + Q * Q);
    }
    return out;
  },

  gain: (input, params, _ctx) => {
    if (!input) return null;
    const g = (params.gain as number) || 1.0;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * g;
    return out;
  },

  resample: (input, params, _ctx) => {
    if (!input) return null;
    const factor = (params.factor as number) || 2;
    const out = new Float32Array(Math.floor(input.length / factor));
    for (let i = 0; i < out.length; i++) out[i] = input[i * factor];
    return out;
  },


  // Multiplexer / channelizer nodes
  downconverter: async (input, params, ctx) => {
    if (!input) return null;
    // Digital downconversion: shift frequency, low-pass filter, decimate
    const centerFreq = (params.centerFreq as number) || 0;
    const bandwidth = (params.bandwidth as number) || 12500;
    const parentRate = (params.rate as number) || 2048000;
    const outputRate = (params.outputRate as number) || 48000;
    const offset = centerFreq - ((ctx.state.parentCenterFreq as number) || centerFreq);
    const decimFactor = Math.max(1, Math.floor(parentRate / outputRate));
    const numSamples = input.length / 2;
    const outLen = Math.ceil(numSamples / decimFactor);
    const out = new Float32Array(outLen * 2);
    let phase = (ctx.state.phase as number) || 0;
    const phaseInc = (-2 * Math.PI * offset) / parentRate;
    let oi = 0;
    for (let n = 0; n < numSamples; n++) {
      if (n % decimFactor === 0 && oi < outLen) {
        const cos = Math.cos(phase);
        const sin = Math.sin(phase);
        const i = input[n * 2], q = input[n * 2 + 1];
        out[oi * 2] = i * cos - q * sin;
        out[oi * 2 + 1] = i * sin + q * cos;
        oi++;
      }
      phase += phaseInc;
      if (phase > Math.PI) phase -= 2 * Math.PI;
      else if (phase < -Math.PI) phase += 2 * Math.PI;
    }
    ctx.state.phase = phase;
    return out.subarray(0, oi * 2);
  },

  pocsag_decoder: (input, _params, ctx) => {
    // Client-side: just a visual placeholder. Actual decoding happens server-side via multimon-ng.
    // This node indicates the pipeline endpoint; messages appear in the Pager panel.
    if (!ctx.state.noted) {
      console.log("[FlowRunner] POCSAG decoder node — server-side decoding via multimon-ng");
      ctx.state.noted = true;
    }
    return null;
  },

  // Output nodes
  spectrum: (input, _params, ctx) => {
    if (!input || !ctx.canvasRef) return null;
    const canvas = ctx.canvasRef;
    const c = canvas.getContext("2d");
    if (!c) return null;
    const w = canvas.width, h = canvas.height;
    c.fillStyle = "#0a0a1a";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#00e5ff";
    c.lineWidth = 1;
    c.beginPath();
    const len = input.length;
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * len);
      const v = input[i];
      const db = isFinite(v) ? v : -100;
      const y = h - ((db + 100) / 80) * h;
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
    return null;
  },

  waterfall: (input, _params, ctx) => {
    if (!input || !ctx.canvasRef) return null;
    const canvas = ctx.canvasRef;
    const c = canvas.getContext("2d");
    if (!c) return null;
    const w = canvas.width, h = canvas.height;
    // Shift down
    const img = c.getImageData(0, 0, w, h - 1);
    c.putImageData(img, 0, 1);
    // Draw new line
    const len = input.length;
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * len);
      const v = input[i];
      const db = isFinite(v) ? v : -100;
      const norm = Math.max(0, Math.min(1, (db + 100) / 60));
      const r = norm > 0.66 ? 255 : norm > 0.33 ? Math.round((norm - 0.33) * 3 * 255) : 0;
      const g = norm > 0.66 ? 255 : norm > 0.33 ? 255 : Math.round(norm * 3 * 255);
      const b = norm > 0.33 ? Math.round((1 - (norm - 0.33) * 1.5) * 255) : 255;
      c.fillStyle = `rgb(${r},${g},${b})`;
      c.fillRect(x, 0, 1, 1);
    }
    return null;
  },

  audio_out: (input, _params, ctx) => {
    if (!input || !ctx.audioCtx) return null;
    const actx = ctx.audioCtx;
    if (actx.state === "closed") return null;
    const buffer = actx.createBuffer(1, input.length, actx.sampleRate);
    buffer.copyToChannel(input, 0);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    if (ctx.gainNode) src.connect(ctx.gainNode);
    else src.connect(actx.destination);
    src.start();
    return null;
  },

  recorder: (input, _params, ctx) => {
    if (!input) return null;
    if (!ctx.state.recorded) ctx.state.recorded = [];
    (ctx.state.recorded as Float32Array[]).push(new Float32Array(input));
    return null;
  },
};

// ============================================================================
// Filter Design Helpers
// ============================================================================

function designLowpass(cutoff: number, numTaps: number): Float32Array {
  const taps = new Float32Array(numTaps);
  const M = numTaps - 1;
  for (let i = 0; i <= M; i++) {
    const n = i - M / 2;
    taps[i] = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    taps[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / M); // Hamming
  }
  return taps;
}

function designHighpass(cutoff: number, numTaps: number): Float32Array {
  const lp = designLowpass(cutoff, numTaps);
  const hp = new Float32Array(numTaps);
  const M = numTaps - 1;
  for (let i = 0; i < numTaps; i++) {
    hp[i] = (i === M / 2 ? 1 : 0) - lp[i];
  }
  return hp;
}

function designBandpass(low: number, high: number, numTaps: number): Float32Array {
  const lp1 = designLowpass(high, numTaps);
  const lp2 = designLowpass(low, numTaps);
  const bp = new Float32Array(numTaps);
  for (let i = 0; i < numTaps; i++) bp[i] = lp1[i] - lp2[i];
  return bp;
}

// ============================================================================
// Flow Runner
// ============================================================================

export class FlowRunner {
  private nodes: Map<string, FlowNodeDef> = new Map();
  private connections: FlowConnectionDef[] = [];
  private contexts: Map<string, NodeContext> = new Map();
  private running = false;
  private animFrame = 0;
  private iqUnsub: (() => void) | null = null;
  private canvasRegistry: Map<string, HTMLCanvasElement> = new Map();
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  get isRunning() { return this.running; }

  registerCanvas(nodeId: string, canvas: HTMLCanvasElement) {
    this.canvasRegistry.set(nodeId, canvas);
  }

  setAudioContext(ctx: AudioContext, gain?: GainNode) {
    this.audioCtx = ctx;
    this.gainNode = gain || null;
  }

  load(nodes: FlowNodeDef[], connections: FlowConnectionDef[]) {
    this.nodes.clear();
    this.connections = connections;
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      this.contexts.set(n.id, {
        nodeId: n.id,
        canvasRef: this.canvasRegistry.get(n.id) || null,
        audioCtx: this.audioCtx,
        gainNode: this.gainNode,
        cleanup: [],
        state: {},
      });
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;

    // Find source nodes (no inputs connected)
    const sourceNodeIds = new Set<string>();
    const hasInput = new Set<string>();
    for (const c of this.connections) hasInput.add(c.to);
    for (const [id] of this.nodes) {
      if (!hasInput.has(id)) sourceNodeIds.add(id);
    }

    // Wire IQ processor for sdr_source nodes
    const sdrSources = [...this.nodes.values()].filter(n => n.type === "sdr_source");
    if (sdrSources.length > 0) {
      const iqProc = getIQProcessor();
      this.iqUnsub = iqProc.onRawIQ((iq) => {
        for (const s of sdrSources) {
          const ctx = this.contexts.get(s.id);
          if (ctx) ctx.state.lastIQ = iq;
        }
      });
      if (!iqProc.isRunning) await iqProc.start();
    }

    // Run the graph in a loop
    const tick = async () => {
      if (!this.running) return;

      // Topological execution
      const order = this.topoSort();
      const outputs: Map<string, Float32Array | null> = new Map();

      for (const nodeId of order) {
        const node = this.nodes.get(nodeId);
        if (!node) continue;

        const proc = processors[node.type];
        if (!proc) { outputs.set(nodeId, null); continue; }

        // Gather input from connected nodes
        const inConns = this.connections.filter(c => c.to === nodeId);
        let input: Float32Array | null = null;
        if (inConns.length > 0) {
          input = outputs.get(inConns[0].from) ?? null;
        }

        const ctx = this.contexts.get(nodeId)!;
        ctx.canvasRef = this.canvasRegistry.get(nodeId) || null;
        const result = await proc(input, node.params || {}, ctx);
        outputs.set(nodeId, result);
      }

      if (this.running) {
        this.animFrame = requestAnimationFrame(() => { tick(); });
      }
    };

    tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animFrame);
    if (this.iqUnsub) { this.iqUnsub(); this.iqUnsub = null; }

    // Cleanup
    for (const [, ctx] of this.contexts) {
      for (const fn of ctx.cleanup) fn();
    }
    this.contexts.clear();
  }

  private topoSort(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const adj = new Map<string, string[]>();

    for (const [id] of this.nodes) adj.set(id, []);
    for (const c of this.connections) {
      adj.get(c.from)?.push(c.to);
    }

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      // Visit dependencies first (nodes that feed into this one)
      for (const c of this.connections) {
        if (c.to === id && !visited.has(c.from)) visit(c.from);
      }
      order.push(id);
    };

    for (const [id] of this.nodes) visit(id);
    return order;
  }
}

// Singleton
let _runner: FlowRunner | null = null;
export function getFlowRunner(): FlowRunner {
  if (!_runner) _runner = new FlowRunner();
  return _runner;
}
