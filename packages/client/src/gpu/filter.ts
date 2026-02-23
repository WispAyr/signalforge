import filterShaderCode from './filter.wgsl?raw';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export class GPUFilter {
  private device: GPUDevice;
  private pipeline!: GPUComputePipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private ready = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async init(): Promise<void> {
    const module = this.device.createShaderModule({ code: filterShaderCode });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module, entryPoint: 'fir_filter' },
    });
    this.ready = true;
  }

  /** Generate FIR filter taps using windowed sinc method */
  static generateTaps(numTaps: number, cutoff: number, type: FilterType, cutoff2?: number): Float32Array {
    const taps = new Float32Array(numTaps);
    const m = numTaps - 1;
    const fc = cutoff;

    for (let i = 0; i < numTaps; i++) {
      // Sinc function
      let h: number;
      if (i === m / 2) {
        h = 2 * fc;
      } else {
        h = Math.sin(2 * Math.PI * fc * (i - m / 2)) / (Math.PI * (i - m / 2));
      }
      // Hamming window
      const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / m);
      taps[i] = h * w;
    }

    if (type === 'highpass') {
      // Spectral inversion
      for (let i = 0; i < numTaps; i++) taps[i] = -taps[i];
      taps[Math.floor(m / 2)] += 1;
    } else if (type === 'bandpass' && cutoff2 !== undefined) {
      // BPF = HPF(fc1) * LPF(fc2) via subtraction
      const lp = GPUFilter.generateTaps(numTaps, cutoff2, 'lowpass');
      const hp = GPUFilter.generateTaps(numTaps, cutoff, 'highpass');
      for (let i = 0; i < numTaps; i++) taps[i] = lp[i] + hp[i];
      // Normalize
      taps[Math.floor(m / 2)] += 1;
    }

    // Normalize
    let sum = 0;
    for (let i = 0; i < numTaps; i++) sum += Math.abs(taps[i]);
    if (sum > 0) for (let i = 0; i < numTaps; i++) taps[i] /= sum;

    return taps;
  }

  async filter(input: Float32Array, taps: Float32Array): Promise<Float32Array> {
    if (!this.ready) throw new Error('GPUFilter not initialized');

    const len = input.length;
    const inputBuf = this.device.createBuffer({ size: len * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const tapsBuf = this.device.createBuffer({ size: taps.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const outputBuf = this.device.createBuffer({ size: len * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const paramBuf = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const readBuf = this.device.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    this.device.queue.writeBuffer(inputBuf, 0, input as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(tapsBuf, 0, taps as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(paramBuf, 0, new Uint32Array([len, taps.length, 0, 0]));

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputBuf } },
        { binding: 1, resource: { buffer: tapsBuf } },
        { binding: 2, resource: { buffer: outputBuf } },
        { binding: 3, resource: { buffer: paramBuf } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(len / 256));
    pass.end();
    encoder.copyBufferToBuffer(outputBuf, 0, readBuf, 0, len * 4);
    this.device.queue.submit([encoder.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    inputBuf.destroy(); tapsBuf.destroy(); outputBuf.destroy(); paramBuf.destroy(); readBuf.destroy();
    return result;
  }
}
