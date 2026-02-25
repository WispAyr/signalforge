import fftShaderCode from './fft.wgsl?raw';

/**
 * GPU-accelerated FFT using WebGPU compute shaders.
 * 
 * Features:
 * - Radix-2 Cooley-Tukey FFT
 * - Buffer pooling to avoid per-frame allocation
 * - Supports 1024, 2048, 4096, 8192 point FFT
 * - Returns magnitude spectrum in dB (first N bins, not just N/2 — caller decides)
 */
export class GPUFft {
  private device: GPUDevice;
  private bitReversePipeline!: GPUComputePipeline;
  private butterflyPipeline!: GPUComputePipeline;
  private magnitudePipeline!: GPUComputePipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private ready = false;

  // Buffer pool keyed by FFT size — avoids per-frame GPU buffer creation
  private bufferPool = new Map<number, {
    realBuf: GPUBuffer;
    imagBuf: GPUBuffer;
    paramBuf: GPUBuffer;
    readBuf: GPUBuffer;
    bindGroup: GPUBindGroup;
    paramView: DataView;
  }>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async init(): Promise<void> {
    const module = this.device.createShaderModule({ code: fftShaderCode });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });

    this.bitReversePipeline = this.device.createComputePipeline({
      layout, compute: { module, entryPoint: 'bit_reverse' },
    });
    this.butterflyPipeline = this.device.createComputePipeline({
      layout, compute: { module, entryPoint: 'butterfly' },
    });
    this.magnitudePipeline = this.device.createComputePipeline({
      layout, compute: { module, entryPoint: 'magnitude' },
    });
    this.ready = true;
  }

  /** Get or create pooled buffers for a given FFT size */
  private getBuffers(size: number) {
    let pool = this.bufferPool.get(size);
    if (pool) return pool;

    const realBuf = this.device.createBuffer({
      size: size * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const imagBuf = this.device.createBuffer({
      size: size * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const paramBuf = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const readBuf = this.device.createBuffer({
      size: size * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: realBuf } },
        { binding: 1, resource: { buffer: imagBuf } },
        { binding: 2, resource: { buffer: paramBuf } },
      ],
    });

    const paramView = new DataView(new ArrayBuffer(16));

    pool = { realBuf, imagBuf, paramBuf, readBuf, bindGroup, paramView };
    this.bufferPool.set(size, pool);
    return pool;
  }

  /**
   * Run FFT on interleaved IQ data (Float32Array of [I0,Q0,I1,Q1,...])
   * Returns magnitude spectrum in dB (full N bins for FFT-shift by caller)
   */
  async fft(iq: Float32Array, size: number): Promise<Float32Array> {
    if (!this.ready) throw new Error('GPUFft not initialized');

    const { realBuf, imagBuf, paramBuf, readBuf, bindGroup, paramView } = this.getBuffers(size);

    // Deinterleave IQ into separate real/imag arrays
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      real[i] = iq[i * 2] ?? 0;
      imag[i] = iq[i * 2 + 1] ?? 0;
    }

    this.device.queue.writeBuffer(realBuf, 0, real as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(imagBuf, 0, imag as Float32Array<ArrayBuffer>);

    // Set params: n, stage=0, direction=1.0 (forward), pad=0
    paramView.setUint32(0, size, true);
    paramView.setUint32(4, 0, true);
    paramView.setFloat32(8, 1.0, true);
    paramView.setUint32(12, 0, true);
    this.device.queue.writeBuffer(paramBuf, 0, new Uint8Array(paramView.buffer));

    const workgroups = Math.ceil(size / 256);
    const stages = Math.log2(size);

    // Bit-reverse permutation
    let encoder = this.device.createCommandEncoder();
    let pass = encoder.beginComputePass();
    pass.setPipeline(this.bitReversePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Butterfly stages
    for (let s = 0; s < stages; s++) {
      paramView.setUint32(4, s, true);
      this.device.queue.writeBuffer(paramBuf, 0, new Uint8Array(paramView.buffer));

      encoder = this.device.createCommandEncoder();
      pass = encoder.beginComputePass();
      pass.setPipeline(this.butterflyPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(size / 2 / 256));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }

    // Magnitude → dB pass, then copy to read buffer
    encoder = this.device.createCommandEncoder();
    pass = encoder.beginComputePass();
    pass.setPipeline(this.magnitudePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(realBuf, 0, readBuf, 0, size * 4);
    this.device.queue.submit([encoder.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    return result;
  }

  /**
   * Run windowed FFT on interleaved IQ data with FFT-shift.
   * Applies window function, runs GPU FFT, returns FFT-shifted dB spectrum (N bins).
   * This is the main entry point for waterfall/spectrum display.
   */
  async fftWindowed(iq: Float32Array, size: number, window: Float32Array): Promise<Float32Array> {
    if (!this.ready) throw new Error('GPUFft not initialized');

    const { realBuf, imagBuf, paramBuf, readBuf, bindGroup, paramView } = this.getBuffers(size);

    // Deinterleave + apply window
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    const offset = iq.length > size * 2 ? iq.length - size * 2 : 0;
    for (let i = 0; i < size; i++) {
      real[i] = (iq[offset + i * 2] ?? 0) * window[i];
      imag[i] = (iq[offset + i * 2 + 1] ?? 0) * window[i];
    }

    this.device.queue.writeBuffer(realBuf, 0, real as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(imagBuf, 0, imag as Float32Array<ArrayBuffer>);

    paramView.setUint32(0, size, true);
    paramView.setUint32(4, 0, true);
    paramView.setFloat32(8, 1.0, true);
    paramView.setUint32(12, 0, true);
    this.device.queue.writeBuffer(paramBuf, 0, new Uint8Array(paramView.buffer));

    const workgroups = Math.ceil(size / 256);
    const stages = Math.log2(size);

    // Bit-reverse
    let encoder = this.device.createCommandEncoder();
    let pass = encoder.beginComputePass();
    pass.setPipeline(this.bitReversePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Butterfly stages
    for (let s = 0; s < stages; s++) {
      paramView.setUint32(4, s, true);
      this.device.queue.writeBuffer(paramBuf, 0, new Uint8Array(paramView.buffer));

      encoder = this.device.createCommandEncoder();
      pass = encoder.beginComputePass();
      pass.setPipeline(this.butterflyPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(size / 2 / 256));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }

    // Magnitude → dB
    encoder = this.device.createCommandEncoder();
    pass = encoder.beginComputePass();
    pass.setPipeline(this.magnitudePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(realBuf, 0, readBuf, 0, size * 4);
    this.device.queue.submit([encoder.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const raw = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    // FFT-shift: swap halves for centered spectrum display
    const half = size >> 1;
    const shifted = new Float32Array(size);
    shifted.set(raw.subarray(half), 0);
    shifted.set(raw.subarray(0, half), half);
    return shifted;
  }

  /**
   * Run FFT on separate real/imag arrays — returns magnitude spectrum in dB
   */
  async fftSeparate(real: Float32Array, imag: Float32Array): Promise<Float32Array> {
    const size = real.length;
    const iq = new Float32Array(size * 2);
    for (let i = 0; i < size; i++) {
      iq[i * 2] = real[i];
      iq[i * 2 + 1] = imag[i];
    }
    return this.fft(iq, size);
  }

  /** Destroy pooled buffers */
  destroy(): void {
    for (const pool of this.bufferPool.values()) {
      pool.realBuf.destroy();
      pool.imagBuf.destroy();
      pool.paramBuf.destroy();
      pool.readBuf.destroy();
    }
    this.bufferPool.clear();
    this.ready = false;
  }
}
