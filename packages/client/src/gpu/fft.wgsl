// Radix-2 Cooley-Tukey FFT compute shader
// Each dispatch handles one butterfly stage of the FFT

struct Params {
  n: u32,           // FFT size
  stage: u32,       // current butterfly stage (0-based)
  direction: f32,   // 1.0 for forward, -1.0 for inverse
  _pad: u32,
}

@group(0) @binding(0) var<storage, read_write> real: array<f32>;
@group(0) @binding(1) var<storage, read_write> imag: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

const PI: f32 = 3.14159265358979323846;

@compute @workgroup_size(256)
fn bit_reverse(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.n) { return; }

  let bits = u32(log2(f32(params.n)));
  var rev: u32 = 0u;
  var val: u32 = i;
  for (var b: u32 = 0u; b < bits; b = b + 1u) {
    rev = (rev << 1u) | (val & 1u);
    val = val >> 1u;
  }

  if (i < rev) {
    let tr = real[i]; let ti = imag[i];
    real[i] = real[rev]; imag[i] = imag[rev];
    real[rev] = tr; imag[rev] = ti;
  }
}

@compute @workgroup_size(256)
fn butterfly(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let half_len = 1u << params.stage;
  let full_len = half_len << 1u;
  let num_blocks = params.n / full_len;
  let total_butterflies = params.n >> 1u;

  if (i >= total_butterflies) { return; }

  let block = i / half_len;
  let j = i % half_len;
  let top = block * full_len + j;
  let bot = top + half_len;

  let angle = params.direction * -2.0 * PI * f32(j) / f32(full_len);
  let wR = cos(angle);
  let wI = sin(angle);

  let tR = real[bot] * wR - imag[bot] * wI;
  let tI = real[bot] * wI + imag[bot] * wR;

  let uR = real[top];
  let uI = imag[top];

  real[top] = uR + tR;
  imag[top] = uI + tI;
  real[bot] = uR - tR;
  imag[bot] = uI - tI;
}

// Compute magnitude spectrum in dB from complex FFT output
@compute @workgroup_size(256)
fn magnitude(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.n) { return; }

  let r = real[i];
  let im = imag[i];
  let mag = sqrt(r * r + im * im) / f32(params.n);
  let db = 20.0 * log(max(mag, 1e-10)) / log(10.0);
  real[i] = db;
}
