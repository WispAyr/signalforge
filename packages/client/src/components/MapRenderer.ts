// MapRenderer.ts — WebGL2 rendering engine for SignalForge MapView
// Pure WebGL2, no dependencies

// ── Shader sources ──

const TILE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform mat3 u_proj;
uniform vec4 u_tile; // x, y, w, h in screen coords
out vec2 v_uv;
void main() {
  vec2 p = u_tile.xy + a_pos * u_tile.zw;
  vec3 cp = u_proj * vec3(p, 1.0);
  gl_Position = vec4(cp.xy, 0.0, 1.0);
  v_uv = a_uv;
}`;

const TILE_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv) * u_alpha;
}`;

const MARKER_VS = `#version 300 es
in vec2 a_quad;
in vec2 a_pos;      // instance: screen x,y
in float a_size;    // instance: radius
in vec4 a_color;    // instance: rgba
in float a_shape;   // instance: 0=circle, 1=triangle, 2=diamond
in float a_rotation;// instance: radians
uniform mat3 u_proj;
out vec2 v_uv;
out vec4 v_color;
flat out float v_shape;
void main() {
  float r = a_rotation;
  mat2 rot = mat2(cos(r), sin(r), -sin(r), cos(r));
  vec2 offset = rot * (a_quad * a_size);
  vec2 p = a_pos + offset;
  vec3 cp = u_proj * vec3(p, 1.0);
  gl_Position = vec4(cp.xy, 0.0, 1.0);
  v_uv = a_quad;
  v_color = a_color;
  v_shape = a_shape;
}`;

const MARKER_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
flat in float v_shape;
out vec4 fragColor;
void main() {
  float d;
  if (v_shape < 0.5) {
    // Circle SDF
    d = length(v_uv);
  } else if (v_shape < 1.5) {
    // Triangle SDF (pointing up in local space)
    vec2 p = v_uv;
    p.y += 0.2;
    float k = sqrt(3.0);
    p.x = abs(p.x) - 0.5;
    p.y = p.y + 0.5/k;
    if (p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y)/2.0;
    p.x -= clamp(p.x, -1.0, 0.0);
    d = -length(p)*sign(p.y);
    d = d < 0.0 ? 0.0 : 1.2;
  } else {
    // Diamond SDF
    vec2 p = abs(v_uv);
    d = (p.x + p.y) / 1.0;
  }
  float alpha = 1.0 - smoothstep(0.5, 0.7, d);
  // Glow
  float glow = exp(-3.0 * d);
  vec3 col = v_color.rgb;
  fragColor = vec4(col, v_color.a * alpha + glow * 0.3 * v_color.a);
  if (fragColor.a < 0.01) discard;
}`;

const LINE_VS = `#version 300 es
in vec2 a_pos;
in float a_alpha;
uniform mat3 u_proj;
out float v_alpha;
void main() {
  vec3 cp = u_proj * vec3(a_pos, 1.0);
  gl_Position = vec4(cp.xy, 0.0, 1.0);
  v_alpha = a_alpha;
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in float v_alpha;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_color.rgb, u_color.a * v_alpha);
}`;

const TEXT_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform mat3 u_proj;
out vec2 v_uv;
void main() {
  vec3 cp = u_proj * vec3(a_pos, 1.0);
  gl_Position = vec4(cp.xy, 0.0, 1.0);
  v_uv = a_uv;
}`;

const TEXT_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv);
  if (fragColor.a < 0.01) discard;
}`;

// ── Types ──

export interface MarkerData {
  x: number; y: number;
  size: number;
  r: number; g: number; b: number; a: number;
  shape: number; // 0=circle, 1=triangle, 2=diamond
  rotation: number;
}

export interface LineData {
  points: { x: number; y: number; alpha: number }[];
}

export interface TextEntry {
  text: string; x: number; y: number;
  color: string; fontSize: number;
}

// ── Tile management ──

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];

interface TileTexture {
  tex: WebGLTexture;
  ready: boolean;
}

// ── Helpers ──

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(s));
  }
  return s;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, createShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, createShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(p));
  }
  return p;
}

// Web Mercator helpers
export function lonToMercX(lon: number): number {
  return (lon + 180) / 360;
}

export function latToMercY(lat: number): number {
  const latRad = lat * Math.PI / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return 0.5 - mercN / (2 * Math.PI);
}

export function mercYToLat(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

// ── Main Renderer Class ──

export class MapRenderer {
  private gl: WebGL2RenderingContext;
  private width = 0;
  private height = 0;

  // Programs
  private tileProg: WebGLProgram;
  private markerProg: WebGLProgram;
  private lineProg: WebGLProgram;
  private textProg: WebGLProgram;

  // Tile quad
  private quadVAO: WebGLVertexArrayObject;
  private tileTextures = new Map<string, TileTexture>();
  private tilePending = new Set<string>();

  // Marker instanced
  private markerVAO: WebGLVertexArrayObject;
  private markerInstanceBuf: WebGLBuffer;
  private maxMarkers = 4096;

  // Lines
  private lineVAO: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private maxLineVerts = 65536;

  // Text atlas
  private textCanvas: HTMLCanvasElement;
  private textCtx: CanvasRenderingContext2D;
  private textTex: WebGLTexture;
  private textVAO: WebGLVertexArrayObject;
  private textBuf: WebGLBuffer;
  private maxTextVerts = 32768;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    // Create programs
    this.tileProg = createProgram(gl, TILE_VS, TILE_FS);
    this.markerProg = createProgram(gl, MARKER_VS, MARKER_FS);
    this.lineProg = createProgram(gl, LINE_VS, LINE_FS);
    this.textProg = createProgram(gl, TEXT_VS, TEXT_FS);

    // ── Tile quad VAO ──
    this.quadVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVAO);
    const quadData = new Float32Array([
      0,0, 0,0,  1,0, 1,0,  0,1, 0,1,  1,1, 1,1,
    ]);
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);
    const taPosLoc = gl.getAttribLocation(this.tileProg, 'a_pos');
    const taUvLoc = gl.getAttribLocation(this.tileProg, 'a_uv');
    gl.enableVertexAttribArray(taPosLoc);
    gl.vertexAttribPointer(taPosLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(taUvLoc);
    gl.vertexAttribPointer(taUvLoc, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    // ── Marker instanced VAO ──
    this.markerVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.markerVAO);
    // Unit quad for each marker (static)
    const markerQuad = new Float32Array([
      -1,-1, 1,-1, -1,1, 1,1,
    ]);
    const mqBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, mqBuf);
    gl.bufferData(gl.ARRAY_BUFFER, markerQuad, gl.STATIC_DRAW);
    const mqLoc = gl.getAttribLocation(this.markerProg, 'a_quad');
    gl.enableVertexAttribArray(mqLoc);
    gl.vertexAttribPointer(mqLoc, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer: x,y, size, r,g,b,a, shape, rotation = 9 floats
    this.markerInstanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.maxMarkers * 9 * 4, gl.DYNAMIC_DRAW);
    const stride = 9 * 4;
    const posLoc = gl.getAttribLocation(this.markerProg, 'a_pos');
    const sizeLoc = gl.getAttribLocation(this.markerProg, 'a_size');
    const colLoc = gl.getAttribLocation(this.markerProg, 'a_color');
    const shapeLoc = gl.getAttribLocation(this.markerProg, 'a_shape');
    const rotLoc = gl.getAttribLocation(this.markerProg, 'a_rotation');

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(posLoc, 1);

    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(sizeLoc, 1);

    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(colLoc, 1);

    gl.enableVertexAttribArray(shapeLoc);
    gl.vertexAttribPointer(shapeLoc, 1, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(shapeLoc, 1);

    gl.enableVertexAttribArray(rotLoc);
    gl.vertexAttribPointer(rotLoc, 1, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(rotLoc, 1);

    gl.bindVertexArray(null);

    // ── Line VAO ──
    this.lineVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVAO);
    this.lineBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.maxLineVerts * 3 * 4, gl.DYNAMIC_DRAW);
    const lPosLoc = gl.getAttribLocation(this.lineProg, 'a_pos');
    const lAlphaLoc = gl.getAttribLocation(this.lineProg, 'a_alpha');
    gl.enableVertexAttribArray(lPosLoc);
    gl.vertexAttribPointer(lPosLoc, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(lAlphaLoc);
    gl.vertexAttribPointer(lAlphaLoc, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);

    // ── Text atlas ──
    this.textCanvas = document.createElement('canvas');
    this.textCanvas.width = 2048;
    this.textCanvas.height = 2048;
    this.textCtx = this.textCanvas.getContext('2d')!;
    this.textTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Text VAO: pos(2) + uv(2) per vertex, 6 verts per label
    this.textVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.textVAO);
    this.textBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.maxTextVerts * 4 * 4, gl.DYNAMIC_DRAW);
    const tPosLoc = gl.getAttribLocation(this.textProg, 'a_pos');
    const tUvLoc = gl.getAttribLocation(this.textProg, 'a_uv');
    gl.enableVertexAttribArray(tPosLoc);
    gl.vertexAttribPointer(tPosLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(tUvLoc);
    gl.vertexAttribPointer(tUvLoc, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  private projMatrix(): Float32Array {
    // Orthographic: maps screen coords (0..w, 0..h) to clip space (-1..1)
    const w = this.width, h = this.height;
    return new Float32Array([
      2/w, 0, 0,
      0, -2/h, 0,
      -1, 1, 1,
    ]);
  }

  // ── Tile rendering ──

  private getTileTexture(z: number, x: number, y: number): TileTexture | null {
    const key = `${z}/${x}/${y}`;
    const cached = this.tileTextures.get(key);
    if (cached) return cached.ready ? cached : null;
    if (this.tilePending.has(key)) return null;
    this.tilePending.add(key);

    const s = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
    const url = TILE_URL.replace('{s}', s).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tileTextures.set(key, { tex, ready: true });
      this.tilePending.delete(key);
    };
    img.onerror = () => { this.tilePending.delete(key); };
    img.src = url;
    return null;
  }

  renderTiles(panX: number, panY: number, zoom: number) {
    const gl = this.gl;
    const w = this.width, h = this.height;
    const proj = this.projMatrix();

    // Tile zoom level from our zoom factor
    const dpr = window.devicePixelRatio || 1;
    const tileZoom = Math.max(0, Math.min(18, Math.floor(Math.log2(zoom * dpr * 2))));
    const numTiles = Math.pow(2, tileZoom);

    gl.useProgram(this.tileProg);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.tileProg, 'u_proj'), false, proj);
    gl.uniform1f(gl.getUniformLocation(this.tileProg, 'u_alpha'), 0.85);
    gl.uniform1i(gl.getUniformLocation(this.tileProg, 'u_tex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.quadVAO);

    for (let tx = 0; tx < numTiles; tx++) {
      for (let ty = 0; ty < numTiles; ty++) {
        // Tile position in Mercator [0..1]
        const mx0 = tx / numTiles;
        const mx1 = (tx + 1) / numTiles;
        const my0 = ty / numTiles;
        const my1 = (ty + 1) / numTiles;

        // Screen coords
        const sx0 = mx0 * w * zoom + panX;
        const sy0 = my0 * w * zoom + panY;
        const sx1 = mx1 * w * zoom + panX;
        const sy1 = my1 * w * zoom + panY;

        // Frustum cull
        if (sx1 < 0 || sx0 > w || sy1 < 0 || sy0 > h) continue;

        const tile = this.getTileTexture(tileZoom, tx, ty);
        if (!tile) continue;

        gl.bindTexture(gl.TEXTURE_2D, tile.tex);
        gl.uniform4f(gl.getUniformLocation(this.tileProg, 'u_tile'), sx0, sy0, sx1 - sx0, sy1 - sy0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    gl.bindVertexArray(null);
  }

  // ── Marker rendering (instanced) ──

  renderMarkers(markers: MarkerData[]) {
    if (markers.length === 0) return;
    const gl = this.gl;
    const count = Math.min(markers.length, this.maxMarkers);

    // Build instance data
    const data = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const m = markers[i];
      const o = i * 9;
      data[o] = m.x; data[o+1] = m.y;
      data[o+2] = m.size;
      data[o+3] = m.r; data[o+4] = m.g; data[o+5] = m.b; data[o+6] = m.a;
      data[o+7] = m.shape;
      data[o+8] = m.rotation;
    }

    gl.useProgram(this.markerProg);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.markerProg, 'u_proj'), false, this.projMatrix());

    gl.bindVertexArray(this.markerVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerInstanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  // ── Line/trail rendering ──

  renderLines(lines: LineData[], color: [number, number, number, number]) {
    if (lines.length === 0) return;
    const gl = this.gl;

    gl.useProgram(this.lineProg);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.lineProg, 'u_proj'), false, this.projMatrix());
    gl.uniform4f(gl.getUniformLocation(this.lineProg, 'u_color'), color[0], color[1], color[2], color[3]);

    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);

    for (const line of lines) {
      if (line.points.length < 2) continue;
      const n = Math.min(line.points.length, this.maxLineVerts);
      const data = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        data[i*3] = line.points[i].x;
        data[i*3+1] = line.points[i].y;
        data[i*3+2] = line.points[i].alpha;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.drawArrays(gl.LINE_STRIP, 0, n);
    }
    gl.bindVertexArray(null);
  }

  // ── Text rendering via atlas ──

  renderTexts(texts: TextEntry[]) {
    if (texts.length === 0) return;
    const gl = this.gl;
    const tc = this.textCtx;
    const cw = this.textCanvas.width;
    const ch = this.textCanvas.height;

    tc.clearRect(0, 0, cw, ch);

    // Layout text entries into atlas and build quads
    const verts: number[] = [];
    let cursorX = 0, cursorY = 0;
    let rowHeight = 0;

    for (const t of texts) {
      tc.font = `${t.fontSize}px "JetBrains Mono", monospace`;
      const metrics = tc.measureText(t.text);
      const tw = Math.ceil(metrics.width) + 2;
      const th = t.fontSize + 4;

      if (cursorX + tw > cw) {
        cursorX = 0;
        cursorY += rowHeight + 2;
        rowHeight = 0;
      }
      if (cursorY + th > ch) break; // atlas full

      tc.font = `${t.fontSize}px "JetBrains Mono", monospace`;
      tc.fillStyle = t.color;
      tc.fillText(t.text, cursorX + 1, cursorY + t.fontSize);

      // UV coords in atlas
      const u0 = cursorX / cw, v0 = cursorY / ch;
      const u1 = (cursorX + tw) / cw, v1 = (cursorY + th) / ch;
      // Screen position
      const sx = t.x, sy = t.y - t.fontSize + 2;
      const ex = t.x + tw, ey = t.y + 4;

      // Two triangles
      verts.push(sx,sy, u0,v0,  ex,sy, u1,v0,  sx,ey, u0,v1);
      verts.push(ex,sy, u1,v0,  ex,ey, u1,v1,  sx,ey, u0,v1);

      cursorX += tw + 2;
      rowHeight = Math.max(rowHeight, th);
    }

    if (verts.length === 0) return;

    // Upload atlas
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas);

    // Upload quads
    gl.useProgram(this.textProg);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.textProg, 'u_proj'), false, this.projMatrix());
    gl.uniform1i(gl.getUniformLocation(this.textProg, 'u_tex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);

    gl.bindVertexArray(this.textVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textBuf);
    const vertData = new Float32Array(verts);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertData);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
    gl.bindVertexArray(null);
  }

  // ── Render circles (range rings, footprints) ──
  renderCircle(cx: number, cy: number, radius: number, color: [number, number, number, number], lineWidth: number = 1, dashed: boolean = false) {
    const segments = 64;
    const points: { x: number; y: number; alpha: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      if (dashed && i % 4 >= 2) {
        if (points.length > 1) {
          // Draw what we have, then reset
          this.renderLineStrip(points, color);
        }
        points.length = 0;
        continue;
      }
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        alpha: 1.0,
      });
    }
    if (points.length > 1) {
      this.renderLineStrip(points, color);
    }
  }

  private renderLineStrip(points: { x: number; y: number; alpha: number }[], color: [number, number, number, number]) {
    const gl = this.gl;
    gl.useProgram(this.lineProg);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.lineProg, 'u_proj'), false, this.projMatrix());
    gl.uniform4f(gl.getUniformLocation(this.lineProg, 'u_color'), color[0], color[1], color[2], color[3]);
    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    const data = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      data[i*3] = points[i].x;
      data[i*3+1] = points[i].y;
      data[i*3+2] = points[i].alpha;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.drawArrays(gl.LINE_STRIP, 0, points.length);
    gl.bindVertexArray(null);
  }

  // ── Full-screen quad for background ──
  renderBackground() {
    const gl = this.gl;
    gl.clearColor(0.024, 0.024, 0.063, 1.0); // #060610
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // ── Grid lines ──
  renderGrid(panX: number, panY: number, zoom: number) {
    const w = this.width, h = this.height;

    // Grid every 15 degrees
    const gridLines: { x: number; y: number; alpha: number }[][] = [];

    for (let lon = -180; lon <= 180; lon += 15) {
      const mx = lonToMercX(lon);
      const sx = mx * w * zoom + panX;
      if (sx < -10 || sx > w + 10) continue;
      gridLines.push([
        { x: sx, y: 0, alpha: 1 },
        { x: sx, y: h, alpha: 1 },
      ]);
    }

    for (let lat = -80; lat <= 80; lat += 15) {
      const my = latToMercY(lat);
      const sy = my * w * zoom + panY;
      if (sy < -10 || sy > h + 10) continue;
      gridLines.push([
        { x: 0, y: sy, alpha: 1 },
        { x: w, y: sy, alpha: 1 },
      ]);
    }

    this.renderLines(
      gridLines.map(pts => ({ points: pts })),
      [0, 0.898, 1.0, 0.04]
    );

    // Equator & prime meridian (brighter)
    const eqY = latToMercY(0) * w * zoom + panY;
    const pmX = lonToMercX(0) * w * zoom + panX;
    this.renderLines([
      { points: [{ x: 0, y: eqY, alpha: 1 }, { x: w, y: eqY, alpha: 1 }] },
      { points: [{ x: pmX, y: 0, alpha: 1 }, { x: pmX, y: h, alpha: 1 }] },
    ], [0, 0.898, 1.0, 0.12]);
  }

  beginFrame() {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  enableAdditiveBlend() {
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
  }

  enableNormalBlend() {
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteProgram(this.tileProg);
    gl.deleteProgram(this.markerProg);
    gl.deleteProgram(this.lineProg);
    gl.deleteProgram(this.textProg);
    this.tileTextures.forEach(t => gl.deleteTexture(t.tex));
    gl.deleteTexture(this.textTex);
  }
}
