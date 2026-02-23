// FIR Filter compute shader — convolution-based

struct FilterParams {
  input_len: u32,
  num_taps: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<storage, read> input_data: array<f32>;
@group(0) @binding(1) var<storage, read> taps: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_data: array<f32>;
@group(0) @binding(3) var<uniform> params: FilterParams;

@compute @workgroup_size(256)
fn fir_filter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.input_len) { return; }

  var sum: f32 = 0.0;
  for (var j: u32 = 0u; j < params.num_taps; j = j + 1u) {
    if (i >= j) {
      sum = sum + input_data[i - j] * taps[j];
    }
  }
  output_data[i] = sum;
}
