import fftShaderCode from './fft.wgsl?raw';

export class GPUFft {
  private device: GPUDevice;
  private bitReversePipeline!: GPUComputePipeline;
  private butterflyPipeline!: GPUComputePipeline;
  private magnitudePipeline!: GPUComputePipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private ready = false;

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

  /**
   * Run FFT on interleaved IQ data (Float32Array of [I0,Q0,I1,Q1,...])
   * Returns magnitude spectrum in dB (first N/2 bins)
   */
  async fft(iq: Float32Array, size: number): Promise<Float32Array> {
    if (!this.ready) throw new Error('GPUFft not initialized');

    // Deinterleave IQ
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      real[i] = iq[i * 2] ?? 0;
      imag[i] = iq[i * 2 + 1] ?? 0;
    }

    const realBuf = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const imagBuf = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const paramBuf = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const readBuf = this.device.createBuffer({ size: size * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    this.device.queue.writeBuffer(realBuf, 0, real as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(imagBuf, 0, imag as Float32Array<ArrayBuffer>);

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: realBuf } },
        { binding: 1, resource: { buffer: imagBuf } },
        { binding: 2, resource: { buffer: paramBuf } },
      ],
    });

    const workgroups = Math.ceil(size / 256);
    const stages = Math.log2(size);

    // Bit-reverse pass
    this.device.queue.writeBuffer(paramBuf, 0, new Uint32Array([size, 0, 0, 0]));
    // Rewrite direction as float
    const paramView = new DataView(new ArrayBuffer(16));
    paramView.setUint32(0, size, true);
    paramView.setUint32(4, 0, true);
    paramView.setFloat32(8, 1.0, true);
    paramView.setUint32(12, 0, true);
    this.device.queue.writeBuffer(paramBuf, 0, new Uint8Array(paramView.buffer));

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

    // Magnitude pass
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

    // Cleanup
    realBuf.destroy(); imagBuf.destroy(); paramBuf.destroy(); readBuf.destroy();

    // Return first half (positive frequencies)
    return result.slice(0, size / 2);
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
}
