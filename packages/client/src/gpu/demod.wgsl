// FM Demodulator compute shader — atan2-based phase difference discriminator

struct DemodParams {
  num_samples: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

@group(0) @binding(0) var<storage, read> i_data: array<f32>;
@group(0) @binding(1) var<storage, read> q_data: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@group(0) @binding(3) var<uniform> params: DemodParams;

@compute @workgroup_size(256)
fn fm_demod(@builtin(global_invocation_id) gid: vec3u) {
  let n = gid.x;
  if (n >= params.num_samples) { return; }

  if (n == 0u) {
    output[0] = 0.0;
    return;
  }

  // Conjugate multiply: s[n] * conj(s[n-1])
  let re = i_data[n] * i_data[n - 1u] + q_data[n] * q_data[n - 1u];
  let im = q_data[n] * i_data[n - 1u] - i_data[n] * q_data[n - 1u];

  output[n] = atan2(im, re);
}
