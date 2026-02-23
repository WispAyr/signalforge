// Phase 8: WebGPU DSP types

export type DSPBackend = 'webgpu' | 'webgl2' | 'cpu';

export interface DSPBenchmark {
  backend: DSPBackend;
  fftSize: number;
  fftTimeMs: number;
  firTaps: number;
  firTimeMs: number;
  fmDemodTimeMs: number;
  decimationFactor: number;
  decimationTimeMs: number;
  samplesPerSecond: number;
  timestamp: number;
}

export interface DSPPipelineConfig {
  fftSize: 256 | 512 | 1024 | 2048 | 4096 | 8192;
  firTaps: number[];
  firEnabled: boolean;
  fmDemodEnabled: boolean;
  decimationFactor: number;
  preferredBackend: DSPBackend;
}

export interface DSPStatus {
  activeBackend: DSPBackend;
  pipelineRunning: boolean;
  samplesProcessed: number;
  droppedBuffers: number;
  gpuMemoryUsedBytes: number;
  latencyMs: number;
  benchmarks: DSPBenchmark[];
}
