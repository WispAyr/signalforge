import React, { useRef, useEffect, useState, useCallback } from 'react';
import { COLORMAPS } from '@signalforge/shared';
import type { ColormapName } from '@signalforge/shared';
import { PopOutButton } from './ui/PopOutButton';

// ── FFT helpers ──
function blackmanHarris(N: number): Float32Array {
  const w = new Float32Array(N);
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  for (let i = 0; i < N; i++) {
    const x = (2 * Math.PI * i) / (N - 1);
    w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return w;
}

function fftInPlace(re: Float32Array, im: Float32Array) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

let _fftRe: Float32Array | null = null;
let _fftIm: Float32Array | null = null;
let _fftOut: Float32Array | null = null;

function iqToPowerDb(iq: Float32Array, fftSize: number, window: Float32Array): Float32Array {
  if (!_fftRe || _fftRe.length !== fftSize) {
    _fftRe = new Float32Array(fftSize);
    _fftIm = new Float32Array(fftSize);
    _fftOut = new Float32Array(fftSize);
  }
  const re = _fftRe, im = _fftIm!, out = _fftOut!;
  const offset = iq.length > fftSize * 2 ? iq.length - fftSize * 2 : 0;
  for (let i = 0; i < fftSize; i++) {
    re[i] = iq[offset + i * 2] * window[i];
    im[i] = iq[offset + i * 2 + 1] * window[i];
  }
  fftInPlace(re, im);
  const half = fftSize >> 1;
  for (let i = 0; i < fftSize; i++) {
    const j = (i + half) % fftSize;
    const pwr = re[j] * re[j] + im[j] * im[j];
    out[i] = 10 * Math.log10(pwr + 1e-20);
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function buildLutTexData(cmap: ColormapName): Uint8Array {
  const colors = COLORMAPS[cmap].colors;
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const idx = t * (colors.length - 1);
    const lo = Math.floor(idx);
    const frac = idx - lo;
    const c1 = hexToRgb(colors[Math.min(lo, colors.length - 1)]);
    const c2 = hexToRgb(colors[Math.min(lo + 1, colors.length - 1)]);
    data[i * 4]     = Math.round(c1[0] + (c2[0] - c1[0]) * frac);
    data[i * 4 + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * frac);
    data[i * 4 + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * frac);
    data[i * 4 + 3] = 255;
  }
  return data;
}

const formatFreq = (hz: number): string => {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
};

// ══════════════════════════════════════════════════════════════════════
// Ring buffer — zero-allocation data ingestion
// ══════════════════════════════════════════════════════════════════════
class FFTRingBuffer {
  data: Float32Array;
  capacity: number;
  fftSize: number;
  writePos = 0;
  readPos = 0;
  latest: Float32Array;

  staging: Float32Array;   // pre-allocated upload buffer (avoids per-frame alloc)

  constructor(capacity: number, fftSize: number) {
    this.capacity = capacity;
    this.fftSize = fftSize;
    this.data = new Float32Array(capacity * fftSize);
    this.latest = new Float32Array(fftSize);
    this.staging = new Float32Array(capacity * fftSize); // max possible batch
  }

  push(fft: Float32Array) {
    const row = this.writePos % this.capacity;
    const offset = row * this.fftSize;
    this.data.set(fft.length === this.fftSize ? fft : fft.subarray(0, this.fftSize), offset);
    this.latest.set(this.data.subarray(offset, offset + this.fftSize));
    this.writePos++;
  }

  // Zero-alloc push from ArrayBuffer at byte offset — avoids creating Float32Array view per frame
  pushFromBuffer(buf: ArrayBuffer, byteOffset: number, floatCount: number) {
    const row = this.writePos % this.capacity;
    const destOffset = row * this.fftSize;
    // Create one typed view directly into the ring buffer to copy
    const src = new Float32Array(buf, byteOffset, floatCount);
    this.data.set(floatCount === this.fftSize ? src : src.subarray(0, this.fftSize), destOffset);
    this.latest.set(this.data.subarray(destOffset, destOffset + this.fftSize));
    this.writePos++;
  }

  available(): number { return this.writePos - this.readPos; }

  getRow(index: number): Float32Array {
    const row = index % this.capacity;
    const offset = row * this.fftSize;
    return this.data.subarray(offset, offset + this.fftSize);
  }

  consume(count: number) { this.readPos += count; }

  resize(newFftSize: number) {
    if (newFftSize === this.fftSize) return;
    this.fftSize = newFftSize;
    this.data = new Float32Array(this.capacity * newFftSize);
    this.latest = new Float32Array(newFftSize);
    this.staging = new Float32Array(this.capacity * newFftSize);
    this.writePos = 0;
    this.readPos = 0;
  }

  // CyberEther-style: assemble contiguous block for batch GPU upload
  // Returns {buffer, count} — buffer is a view into staging, count = rows assembled
  assembleBlock(maxRows: number): { buffer: Float32Array; count: number; startRow: number } {
    const count = Math.min(this.available(), maxRows);
    if (count === 0) return { buffer: this.staging.subarray(0, 0), count: 0, startRow: 0 };
    const startRow = this.readPos % this.capacity;
    // Check if contiguous in ring
    const endRow = (this.readPos + count - 1) % this.capacity;
    if (endRow >= startRow) {
      // Contiguous — return direct view, zero copy
      const offset = startRow * this.fftSize;
      this.readPos += count;
      return { buffer: this.data.subarray(offset, offset + count * this.fftSize), count, startRow };
    } else {
      // Wraps around — copy into staging buffer
      const firstPart = this.capacity - startRow;
      const secondPart = count - firstPart;
      this.staging.set(this.data.subarray(startRow * this.fftSize, this.capacity * this.fftSize), 0);
      this.staging.set(this.data.subarray(0, secondPart * this.fftSize), firstPart * this.fftSize);
      this.readPos += count;
      return { buffer: this.staging.subarray(0, count * this.fftSize), count, startRow };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// WebGL2 Shaders — CyberEther-inspired, single context
// ══════════════════════════════════════════════════════════════════════

const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const WF_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_data;
uniform sampler2D u_lut;
uniform int u_width;
uniform int u_height;
uniform float u_index;
uniform float u_minDb;
uniform float u_maxDb;
uniform bool u_interpolate;

float sampleData(float x, float y) {
  float ny = fract(y / float(u_height));
  return texture(u_data, vec2(x / float(u_width), ny)).r;
}

void main() {
  float x = v_uv.x * float(u_width);
  float y = u_index * float(u_height) - (1.0 - v_uv.y) * float(u_height);
  float mag;
  if (u_interpolate) {
    mag  = sampleData(x, y - 4.0) * 0.0162162162;
    mag += sampleData(x, y - 3.0) * 0.0540540541;
    mag += sampleData(x, y - 2.0) * 0.1216216216;
    mag += sampleData(x, y - 1.0) * 0.1945945946;
    mag += sampleData(x, y)       * 0.2270270270;
    mag += sampleData(x, y + 1.0) * 0.1945945946;
    mag += sampleData(x, y + 2.0) * 0.1216216216;
    mag += sampleData(x, y + 3.0) * 0.0540540541;
    mag += sampleData(x, y + 4.0) * 0.0162162162;
  } else {
    mag = sampleData(x, y);
  }
  float norm = clamp((mag - u_minDb) / (u_maxDb - u_minDb), 0.0, 1.0);
  fragColor = texture(u_lut, vec2(norm, 0.5));
}`;

// Spectrum line: simple 1-vertex-per-bin, drawn as LINE_STRIP
// Smooth 3-tap average in shader for anti-aliased look
const SPEC_VERT = `#version 300 es
precision highp float;
uniform sampler2D u_fftData;
uniform int u_fftSize;
uniform float u_minDb;
uniform float u_maxDb;
in float a_bin;
out float v_normDb;

void main() {
  int bin = int(a_bin);
  // 3-tap smoothing: average with neighbors for anti-aliased trace
  float db0 = texelFetch(u_fftData, ivec2(clamp(bin - 1, 0, u_fftSize - 1), 0), 0).r;
  float db1 = texelFetch(u_fftData, ivec2(clamp(bin,     0, u_fftSize - 1), 0), 0).r;
  float db2 = texelFetch(u_fftData, ivec2(clamp(bin + 1, 0, u_fftSize - 1), 0), 0).r;
  float db = db0 * 0.25 + db1 * 0.5 + db2 * 0.25;
  float norm = clamp((db - u_minDb) / (u_maxDb - u_minDb), 0.0, 1.0);
  float x = (float(bin) / float(u_fftSize - 1)) * 2.0 - 1.0;
  float y = norm * 2.0 - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  v_normDb = norm;
}`;

const SPEC_FRAG = `#version 300 es
precision highp float;
in float v_normDb;
out vec4 fragColor;
uniform sampler2D u_lut;
uniform float u_alpha;
void main() {
  vec3 color = texture(u_lut, vec2(v_normDb, 0.5)).rgb;
  fragColor = vec4(color, u_alpha);
}`;

const FILL_VERT = `#version 300 es
precision highp float;
uniform sampler2D u_fftData;
uniform int u_fftSize;
uniform float u_minDb;
uniform float u_maxDb;
in vec2 a_vertData;
out float v_normDb;
out float v_yPos;
void main() {
  int bin = int(a_vertData.x);
  float db = texelFetch(u_fftData, ivec2(clamp(bin, 0, u_fftSize - 1), 0), 0).r;
  float norm = clamp((db - u_minDb) / (u_maxDb - u_minDb), 0.0, 1.0);
  float x = (float(bin) / float(u_fftSize - 1)) * 2.0 - 1.0;
  float y = a_vertData.y > 0.5 ? (norm * 2.0 - 1.0) : -1.0;
  v_normDb = norm;
  v_yPos = (y + 1.0) * 0.5;
  gl_Position = vec4(x, y, 0.0, 1.0);
}`;

const FILL_FRAG = `#version 300 es
precision highp float;
in float v_normDb;
in float v_yPos;
uniform sampler2D u_lut;
out vec4 fragColor;
void main() {
  vec3 color = texture(u_lut, vec2(v_normDb, 0.5)).rgb;
  float alpha = v_yPos * 0.12;
  fragColor = vec4(color, alpha);
}`;

const GRID_VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const GRID_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// Cache uniform locations for a program
function getUniforms<T extends Record<string, string>>(gl: WebGL2RenderingContext, prog: WebGLProgram, names: T): Record<keyof T, WebGLUniformLocation | null> {
  const result: any = {};
  for (const key in names) {
    result[key] = gl.getUniformLocation(prog, names[key]);
  }
  return result;
}

const BUF_HEIGHT = 1024;
const RING_CAPACITY = 256;
const SPECTRUM_RATIO = 0.3; // top 30% for spectrum

export const WaterfallView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const [fftSize, setFftSize] = useState(2048);
  const [colormap, setColormap] = useState<ColormapName>('cyberether');
  const [minDb, setMinDb] = useState(-70);
  const [maxDb, setMaxDb] = useState(-20);
  const [centerFreq, setCenterFreq] = useState(100e6);
  const [bandwidth, setBandwidth] = useState(2.4e6);
  const [showSettings, setShowSettings] = useState(false);
  const [sdrConnected, setSdrConnected] = useState(false);
  const [sdrFreqInput, setSdrFreqInput] = useState('100.0');
  const [sdrGain, setSdrGain] = useState(40);
  const [receivers, setReceivers] = useState<Array<{id: string; centerFreq: number; bandwidth: number; label: string; active: boolean}>>([]);
  const [interpolate, setInterpolate] = useState(true);

  const sdrConnectedRef = useRef(false);
  const ringRef = useRef<FFTRingBuffer>(new FFTRingBuffer(RING_CAPACITY, 2048));
  const windowRef = useRef<Float32Array>(blackmanHarris(2048));
  const minDbRef = useRef(minDb);
  const maxDbRef = useRef(maxDb);
  const fftSizeRef = useRef(fftSize);
  const centerFreqRef = useRef(centerFreq);
  const bandwidthRef = useRef(bandwidth);
  const colormapRef = useRef(colormap);
  const interpolateRef = useRef(interpolate);
  const peakHoldRef = useRef<Float32Array | null>(null);
  // Canvas dimensions tracked by ResizeObserver — no getBoundingClientRect per frame
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => { minDbRef.current = minDb; }, [minDb]);
  useEffect(() => { maxDbRef.current = maxDb; }, [maxDb]);
  useEffect(() => {
    fftSizeRef.current = fftSize;
    windowRef.current = blackmanHarris(fftSize);
    ringRef.current.resize(fftSize);
    peakHoldRef.current = null;
    _fftRe = null; _fftIm = null; _fftOut = null;
  }, [fftSize]);
  useEffect(() => { centerFreqRef.current = centerFreq; }, [centerFreq]);
  useEffect(() => { bandwidthRef.current = bandwidth; }, [bandwidth]);
  useEffect(() => { colormapRef.current = colormap; }, [colormap]);
  useEffect(() => { interpolateRef.current = interpolate; }, [interpolate]);

  // ── WebSockets: CyberEther split-channel architecture ──
  // Signal channel: /ws/signal — binary-only, zero JSON, pure FFT data
  // Control channel: /ws — JSON metadata (fft_meta, freq updates)
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;

    // ── Signal channel: binary FFT data only ──
    const signalWs = new WebSocket(`${proto}://${host}/ws/signal`);
    signalWs.binaryType = 'arraybuffer';
    signalWs.onclose = () => { sdrConnectedRef.current = false; setSdrConnected(false); };
    signalWs.onerror = () => { sdrConnectedRef.current = false; setSdrConnected(false); };
    signalWs.onmessage = (e) => {
      // Binary only — no type checking needed, no JSON parsing ever
      const fs = fftSizeRef.current;
      const ring = ringRef.current;
      const buf = e.data as ArrayBuffer;
      const bytesPerFrame = fs * 4;

      if (buf.byteLength > bytesPerFrame && (buf.byteLength - 4) % bytesPerFrame === 0) {
        // Batched: [uint32 count][frame1][frame2]...
        const dv = new DataView(buf);
        const count = dv.getUint32(0, true);
        for (let i = 0; i < count; i++) {
          ring.pushFromBuffer(buf, 4 + i * bytesPerFrame, fs);
        }
      } else {
        // Single frame
        const floats = new Float32Array(buf);
        if (floats.length === fs) {
          ring.push(floats);
        } else if (floats.length >= fs * 2) {
          ring.push(iqToPowerDb(floats, fs, windowRef.current));
        }
      }
      if (!sdrConnectedRef.current) { sdrConnectedRef.current = true; setSdrConnected(true); }
    };

    // ── Control channel: JSON metadata only ──
    const ctrlWs = new WebSocket(`${proto}://${host}/ws`);
    ctrlWs.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      if (!e.data.includes('fft_meta')) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'fft_meta') {
          if (msg.sampleRate && msg.sampleRate !== bandwidthRef.current) setBandwidth(msg.sampleRate);
          if (msg.centerFrequency && msg.centerFrequency !== centerFreqRef.current) {
            setCenterFreq(msg.centerFrequency);
            setSdrFreqInput((msg.centerFrequency / 1e6).toFixed(3));
          }
        }
      } catch {}
    };

    // Fetch receiver list periodically
    const fetchReceivers = () => {
      fetch('/api/sdr/multiplexer/status').then(r => r.json()).then(d => {
        if (d.receivers) setReceivers(d.receivers);
      }).catch(() => {});
    };
    fetchReceivers();
    const rxInterval = setInterval(fetchReceivers, 5000);

    return () => { signalWs.close(); ctrlWs.close(); clearInterval(rxInterval); };
  }, []);

  // ══════════════════════════════════════════════════════
  // SINGLE WebGL2 context — waterfall + spectrum + grid
  // ══════════════════════════════════════════════════════
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) { console.error('No WebGL2'); return; }
    gl.getExtension('EXT_color_buffer_float');

    // ═══════════════════════════════════════
    // WATERFALL PROGRAM + uniforms (cached)
    // ═══════════════════════════════════════
    const wfProg = linkProgram(gl, QUAD_VERT, WF_FRAG)!;
    const wfU = getUniforms(gl, wfProg, {
      data: 'u_data', lut: 'u_lut', width: 'u_width', height: 'u_height',
      index: 'u_index', minDb: 'u_minDb', maxDb: 'u_maxDb', interp: 'u_interpolate'
    });

    const quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(quadVao);
    const quadVbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const wfAPos = gl.getAttribLocation(wfProg, 'a_pos');
    gl.enableVertexAttribArray(wfAPos);
    gl.vertexAttribPointer(wfAPos, 2, gl.FLOAT, false, 0, 0);

    // Data texture: R32F circular buffer
    const dataTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dataTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    let curFftSize = fftSizeRef.current;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, curFftSize, BUF_HEIGHT, 0, gl.RED, gl.FLOAT, null);

    // LUT texture (shared by all programs)
    const lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let curCmap = colormapRef.current;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildLutTexData(curCmap));

    // Static uniforms
    gl.useProgram(wfProg);
    gl.uniform1i(wfU.data, 0);
    gl.uniform1i(wfU.lut, 1);
    gl.uniform1i(wfU.width, curFftSize);
    gl.uniform1i(wfU.height, BUF_HEIGHT);

    let writeRow = 0;

    // ═══════════════════════════════════════
    // SPECTRUM FFT texture (1D R32F)
    // ═══════════════════════════════════════
    const specFftTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, specFftTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, curFftSize, 1, 0, gl.RED, gl.FLOAT, null);

    // Peak hold texture
    const peakFftTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, peakFftTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, curFftSize, 1, 0, gl.RED, gl.FLOAT, null);

    // ═══════════════════════════════════════
    // SPECTRUM LINE PROGRAM + uniforms (cached)
    // ═══════════════════════════════════════
    const specProg = linkProgram(gl, SPEC_VERT, SPEC_FRAG)!;
    const specU = getUniforms(gl, specProg, {
      fftData: 'u_fftData', fftSize: 'u_fftSize', minDb: 'u_minDb', maxDb: 'u_maxDb',
      lut: 'u_lut', alpha: 'u_alpha'
    });

    let specVertCount = curFftSize;
    const buildSpecVerts = (fs: number) => {
      specVertCount = fs;
      const d = new Float32Array(fs);
      for (let i = 0; i < fs; i++) d[i] = i;
      return d;
    };

    const specVao = gl.createVertexArray()!;
    gl.bindVertexArray(specVao);
    const specVbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, specVbuf);
    gl.bufferData(gl.ARRAY_BUFFER, buildSpecVerts(curFftSize), gl.STATIC_DRAW);
    const specABin = gl.getAttribLocation(specProg, 'a_bin');
    gl.enableVertexAttribArray(specABin);
    gl.vertexAttribPointer(specABin, 1, gl.FLOAT, false, 0, 0);

    // ═══════════════════════════════════════
    // FILL PROGRAM + uniforms (cached)
    // ═══════════════════════════════════════
    const fillProg = linkProgram(gl, FILL_VERT, FILL_FRAG)!;
    const fillU = getUniforms(gl, fillProg, {
      fftData: 'u_fftData', fftSize: 'u_fftSize', minDb: 'u_minDb', maxDb: 'u_maxDb', lut: 'u_lut'
    });

    let fillVertCount = curFftSize * 2;
    const buildFillVerts = (fs: number) => {
      fillVertCount = fs * 2;
      const d = new Float32Array(fillVertCount * 2);
      for (let i = 0; i < fs; i++) {
        d[i * 4] = i; d[i * 4 + 1] = 0;
        d[i * 4 + 2] = i; d[i * 4 + 3] = 1;
      }
      return d;
    };

    const fillVao = gl.createVertexArray()!;
    gl.bindVertexArray(fillVao);
    const fillVbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fillVbuf);
    gl.bufferData(gl.ARRAY_BUFFER, buildFillVerts(curFftSize), gl.STATIC_DRAW);
    const fillAVert = gl.getAttribLocation(fillProg, 'a_vertData');
    gl.enableVertexAttribArray(fillAVert);
    gl.vertexAttribPointer(fillAVert, 2, gl.FLOAT, false, 0, 0);

    // ═══════════════════════════════════════
    // GRID PROGRAM + uniforms (cached)
    // ═══════════════════════════════════════
    const gridProg = linkProgram(gl, GRID_VERT, GRID_FRAG)!;
    const gridU = getUniforms(gl, gridProg, { color: 'u_color' });

    const gridVao = gl.createVertexArray()!;
    gl.bindVertexArray(gridVao);
    const gridVbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, gridVbuf);
    gl.bufferData(gl.ARRAY_BUFFER, 400 * 4, gl.DYNAMIC_DRAW);
    const gridAPos = gl.getAttribLocation(gridProg, 'a_pos');
    gl.enableVertexAttribArray(gridAPos);
    gl.vertexAttribPointer(gridAPos, 2, gl.FLOAT, false, 0, 0);

    const gridData = new Float32Array(200);

    // ═══════════════════════════════════════
    // ResizeObserver — no per-frame layout queries
    // ═══════════════════════════════════════
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(entry.contentRect.width * dpr);
        const h = Math.floor(entry.contentRect.height * dpr);
        if (w !== canvasSizeRef.current.w || h !== canvasSizeRef.current.h) {
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = `${entry.contentRect.width}px`;
          canvas.style.height = `${entry.contentRect.height}px`;
          canvasSizeRef.current = { w, h };
        }
      }
    });
    ro.observe(container);

    let running = true;

    const render = () => {
      if (!running) return;
      animRef.current = requestAnimationFrame(render);

      const ring = ringRef.current;
      const { w: cw, h: ch } = canvasSizeRef.current;
      if (cw === 0 || ch === 0) return;

      const fs = fftSizeRef.current;
      const mn = minDbRef.current;
      const mx = maxDbRef.current;

      // Clear entire canvas to black first
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Spectrum region: top 30%, waterfall: bottom 70%
      const specH = Math.floor(ch * SPECTRUM_RATIO);
      const wfH = ch - specH;

      // ── Rebuild textures/buffers if fftSize changed ──
      if (fs !== curFftSize) {
        curFftSize = fs;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dataTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, curFftSize, BUF_HEIGHT, 0, gl.RED, gl.FLOAT, null);
        gl.useProgram(wfProg);
        gl.uniform1i(wfU.width, curFftSize);
        writeRow = 0;

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, specFftTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, curFftSize, 1, 0, gl.RED, gl.FLOAT, null);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, peakFftTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, curFftSize, 1, 0, gl.RED, gl.FLOAT, null);

        gl.bindVertexArray(specVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, specVbuf);
        gl.bufferData(gl.ARRAY_BUFFER, buildSpecVerts(curFftSize), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, fillVbuf);
        gl.bufferData(gl.ARRAY_BUFFER, buildFillVerts(curFftSize), gl.STATIC_DRAW);
      }

      // ── Update colormap ──
      if (colormapRef.current !== curCmap) {
        curCmap = colormapRef.current;
        const lutData = buildLutTexData(curCmap);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
      }

      // ── Upload FFT rows — constant-rate drain for smooth scrolling ──
      // CyberEther principle: display advances at fixed rate, data buffers absorb jitter
      // Drain 1-2 rows per frame for perfectly uniform scroll speed
      const avail = ring.available();
      if (avail > 0) {
        // Drain 1 row normally, 2 if buffer building up (>16 = ~0.5s backlog)
        const rowsToDrain = avail > 16 ? 2 : 1;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dataTex);
        for (let r = 0; r < rowsToDrain && ring.available() > 0; r++) {
          const rowData = ring.getRow(ring.readPos);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, writeRow % BUF_HEIGHT, curFftSize, 1, gl.RED, gl.FLOAT, rowData);
          ring.consume(1);
          writeRow++;
        }
      }

      // ════════════════════════════════════
      // PASS 1: WATERFALL (bottom 70%)
      // ════════════════════════════════════
      gl.viewport(0, 0, cw, wfH);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);

      gl.useProgram(wfProg);
      gl.uniform1f(wfU.index, (writeRow % BUF_HEIGHT) / BUF_HEIGHT);
      gl.uniform1f(wfU.minDb, mn);
      gl.uniform1f(wfU.maxDb, mx);
      gl.uniform1i(wfU.interp, interpolateRef.current ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dataTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ════════════════════════════════════
      // PASS 2: SPECTRUM (top 30%)
      // ════════════════════════════════════
      gl.viewport(0, wfH, cw, specH);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, wfH, cw, specH);
      gl.clearColor(0.024, 0.024, 0.063, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // Upload current FFT data
      const latestFft = ring.latest;
      if (latestFft) {
        if (!peakHoldRef.current || peakHoldRef.current.length !== curFftSize) {
          peakHoldRef.current = new Float32Array(latestFft);
          // Auto-range on first data: find actual noise floor and peak
          let fftMin = 0, fftMax = -200;
          for (let i = 0; i < curFftSize; i++) {
            if (latestFft[i] > fftMax) fftMax = latestFft[i];
            if (latestFft[i] < fftMin && latestFft[i] > -200) fftMin = latestFft[i];
          }
          // Set range with 10dB padding
          const autoMin = Math.floor((fftMin - 10) / 5) * 5;
          const autoMax = Math.ceil((fftMax + 10) / 5) * 5;
          if (autoMin > -140 && autoMax < 0 && autoMax - autoMin > 10) {
            setMinDb(autoMin);
            setMaxDb(autoMax);
          }
        } else {
          const pk = peakHoldRef.current;
          for (let i = 0; i < curFftSize; i++) pk[i] = Math.max(latestFft[i], pk[i] * 0.995);
        }
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, specFftTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, curFftSize, 1, gl.RED, gl.FLOAT, latestFft);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, peakFftTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, curFftSize, 1, gl.RED, gl.FLOAT, peakHoldRef.current);
      }

      // ── Grid lines ──
      let gridVertCount = 0;
      for (let db = Math.ceil(mn / 10) * 10; db <= mx; db += 10) {
        const y = ((db - mn) / (mx - mn)) * 2.0 - 1.0;
        if (gridVertCount < 196) {
          gridData[gridVertCount++] = -1; gridData[gridVertCount++] = y;
          gridData[gridVertCount++] = 1;  gridData[gridVertCount++] = y;
        }
      }
      const centerLineIdx = gridVertCount;
      if (gridVertCount < 196) {
        gridData[gridVertCount++] = 0; gridData[gridVertCount++] = -1;
        gridData[gridVertCount++] = 0; gridData[gridVertCount++] = 1;
      }

      if (gridVertCount > 0) {
        gl.useProgram(gridProg);
        gl.uniform4f(gridU.color, 0.0, 0.9, 1.0, 0.06);
        gl.bindVertexArray(gridVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gridVbuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, gridData.subarray(0, gridVertCount));
        gl.drawArrays(gl.LINES, 0, centerLineIdx / 2);
        // Center marker in amber
        gl.uniform4f(gridU.color, 1.0, 0.67, 0.0, 0.6);
        gl.drawArrays(gl.LINES, centerLineIdx / 2, 2);
      }

      // ── Fill under curve ──
      gl.useProgram(fillProg);
      gl.uniform1i(fillU.fftData, 2);
      gl.uniform1i(fillU.fftSize, curFftSize);
      gl.uniform1f(fillU.minDb, mn);
      gl.uniform1f(fillU.maxDb, mx);
      gl.uniform1i(fillU.lut, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, specFftTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.bindVertexArray(fillVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, fillVertCount);

      // ── Peak hold line ──
      if (peakHoldRef.current) {
        gl.useProgram(specProg);
        gl.uniform1i(specU.fftData, 3);
        gl.uniform1i(specU.fftSize, curFftSize);
        gl.uniform1f(specU.minDb, mn);
        gl.uniform1f(specU.maxDb, mx);
        gl.uniform1i(specU.lut, 1);
        gl.uniform1f(specU.alpha, 0.25);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, peakFftTex);
        gl.bindVertexArray(specVao);
        gl.lineWidth(1.0);
        gl.drawArrays(gl.LINE_STRIP, 0, specVertCount);
      }

      // ── Live spectrum line ──
      gl.useProgram(specProg);
      gl.uniform1i(specU.fftData, 2);
      gl.uniform1i(specU.fftSize, curFftSize);
      gl.uniform1f(specU.minDb, mn);
      gl.uniform1f(specU.maxDb, mx);
      gl.uniform1i(specU.lut, 1);
      gl.uniform1f(specU.alpha, 1.0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, specFftTex);
      gl.bindVertexArray(specVao);
      gl.lineWidth(1.0);
      gl.drawArrays(gl.LINE_STRIP, 0, specVertCount);

      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []);

  const connectSdr = async () => { try { await fetch('/api/sdr/multiplexer/reconnect', { method: 'POST' }); } catch {} };
  const tuneFrequency = async (mhz: number) => { try { await fetch('/api/sdr/frequency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frequency: mhz * 1e6 }) }); } catch {} };
  const setGainApi = async (gain: number) => { try { await fetch('/api/sdr/gain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gain }) }); } catch {} };

  const handleWaterfallClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setCenterFreq(prev => prev + (x - 0.5) * bandwidthRef.current);
  }, []);

  const freqLabels: string[] = [];
  for (let i = 0; i <= 4; i++) {
    freqLabels.push(formatFreq(centerFreq - bandwidth / 2 + (bandwidth * i) / 4));
  }

  return (
    <div className="h-full w-full flex flex-col bg-forge-bg relative">
      <div className="h-6 flex items-center justify-between px-4 text-[9px] font-mono text-forge-cyan-dim border-b border-forge-border">
        <PopOutButton view="waterfall" className="absolute right-2 top-1 z-10" />
        <span className="flex items-center gap-1">
          <span className={`inline-block w-2 h-2 rounded-full ${sdrConnected ? 'bg-green-500 shadow-[0_0_4px_#22c55e]' : 'bg-gray-600'}`} />
          <span className={sdrConnected ? 'text-green-400' : 'text-forge-text-dim'}>{sdrConnected ? 'SDR' : 'DEMO'}</span>
        </span>
        {freqLabels.map((label, i) => <span key={i} className={i === 2 ? 'text-forge-amber' : ''}>{label}</span>)}
      </div>

      {/* Single canvas, single WebGL2 context — spectrum top 30%, waterfall bottom 70% */}
      <div ref={containerRef} className="flex-1 relative">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-crosshair" style={{ background: "#000" }} onClick={handleWaterfallClick} />
        {/* Thin divider line at 30% mark */}
        <div className="absolute left-0 right-0 border-t border-forge-border/50 pointer-events-none" style={{ top: '30%' }} />
        {/* Virtual receiver channel overlays */}
        {bandwidth > 0 && receivers.map((rx) => {
          const freqStart = centerFreq - bandwidth / 2;
          const leftPct = ((rx.centerFreq - rx.bandwidth / 2) - freqStart) / bandwidth * 100;
          const widthPct = rx.bandwidth / bandwidth * 100;
          if (leftPct < -10 || leftPct > 110) return null;
          return (
            <div key={rx.id} className="absolute pointer-events-none" style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.3)}%`, top: 0, bottom: 0 }}>
              {/* Channel band highlight */}
              <div className="absolute inset-0" style={{ background: 'rgba(255, 170, 0, 0.08)', borderLeft: '1px solid rgba(255, 170, 0, 0.4)', borderRight: '1px solid rgba(255, 170, 0, 0.4)' }} />
              {/* Frequency label — staggered to avoid overlap */}
              <div className="absolute text-[7px] font-mono whitespace-nowrap" style={{ top: '31%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255, 170, 0, 0.9)', textShadow: '0 0 6px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,1)', letterSpacing: '0.5px' }}>
                {(rx.centerFreq / 1e6).toFixed(3)}
              </div>
              {/* Center marker tick */}
              <div className="absolute" style={{ left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255, 170, 0, 0.25)' }} />
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-3 right-3 flex gap-2 text-[10px] font-mono z-10">
        <button onClick={() => setShowSettings(!showSettings)}
          className="bg-forge-bg/90 border border-forge-border px-3 py-1.5 rounded text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all"
        >⚙ Settings</button>
        <span className="bg-forge-bg/90 border border-forge-border px-2 py-1 rounded text-forge-text-dim">
          FFT: {fftSize} · {COLORMAPS[colormap].name} · {minDb} to {maxDb} dB
        </span>
      </div>

      {showSettings && (
        <div className="absolute bottom-12 right-3 w-72 panel-border rounded-lg p-4 z-20 space-y-3 max-h-[80vh] overflow-y-auto">
          <h3 className="text-xs font-mono tracking-wider text-forge-cyan">WATERFALL SETTINGS</h3>
          <div className="border border-forge-border/50 rounded p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-forge-text-dim flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sdrConnected ? 'bg-green-500' : 'bg-gray-600'}`} />
                SDR {sdrConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
              <button onClick={connectSdr} className="text-[9px] font-mono px-2 py-0.5 rounded border border-forge-cyan/30 text-forge-cyan hover:bg-forge-cyan/10 transition-all">Connect SDR</button>
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim">Frequency (MHz)</label>
              <div className="flex gap-1 mt-1">
                <input type="text" value={sdrFreqInput} onChange={(e) => setSdrFreqInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const v = parseFloat(sdrFreqInput); if (!isNaN(v)) tuneFrequency(v); } }}
                  className="flex-1 bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text" />
                <button onClick={() => { const v = parseFloat(sdrFreqInput); if (!isNaN(v)) tuneFrequency(v); }}
                  className="text-[9px] font-mono px-2 py-0.5 rounded border border-forge-border text-forge-text-dim hover:text-forge-cyan hover:border-forge-cyan/30 transition-all">Tune</button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono text-forge-text-dim">Gain: {sdrGain}</label>
              <input type="range" min="0" max="50" value={sdrGain}
                onChange={(e) => { const g = parseInt(e.target.value); setSdrGain(g); setGainApi(g); }}
                className="w-full h-1 mt-1" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">FFT Size</label>
            <select value={fftSize} onChange={(e) => setFftSize(parseInt(e.target.value))}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text mt-1"
            >{[512, 1024, 2048, 4096, 8192].map(s => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">Color Map</label>
            <div className="flex gap-1 mt-1">
              {(Object.keys(COLORMAPS) as ColormapName[]).map(cm => (
                <button key={cm} onClick={() => setColormap(cm)}
                  className={`flex-1 py-1 rounded text-[9px] font-mono border transition-all ${colormap === cm ? 'border-forge-cyan text-forge-cyan' : 'border-forge-border text-forge-text-dim'}`}
                >{COLORMAPS[cm].name.slice(0, 6)}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">dB Range: {minDb} to {maxDb}</label>
            <div className="flex gap-2 mt-1">
              <input type="range" min="-140" max="-60" value={minDb} onChange={e => setMinDb(parseInt(e.target.value))} className="flex-1 h-1" />
              <input type="range" min="-80" max="0" value={maxDb} onChange={e => setMaxDb(parseInt(e.target.value))} className="flex-1 h-1" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-mono text-forge-text-dim">Interpolation (9-tap Gaussian)</label>
            <button onClick={() => setInterpolate(!interpolate)}
              className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-all ${interpolate ? 'border-forge-cyan text-forge-cyan' : 'border-forge-border text-forge-text-dim'}`}
            >{interpolate ? 'ON' : 'OFF'}</button>
          </div>
          <div>
            <label className="text-[10px] font-mono text-forge-text-dim">Bandwidth</label>
            <select value={bandwidth} onChange={(e) => setBandwidth(parseFloat(e.target.value))}
              className="w-full bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text mt-1"
            >{[250e3, 500e3, 1e6, 2e6, 2.4e6, 5e6, 10e6].map(bw => <option key={bw} value={bw}>{formatFreq(bw)}</option>)}</select>
          </div>
        </div>
      )}
    </div>
  );
};
