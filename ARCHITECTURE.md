# SignalForge Architecture

## Design Principles

1. **TypeScript everywhere** — unified stack, shared types between client and server
2. **GPU-first rendering** — WebGPU for waterfall, spectrum, and flow graph visualization
3. **Flow-based DSP** — every operation is a composable node in a visual graph
4. **Browser-native** — WebUSB for direct SDR access, WebSocket for remote SDR bridge
5. **Real-time** — sub-100ms latency from antenna to display

---

## System Layers

### Layer 1: Hardware Abstraction (Server)

```typescript
// SDR devices are abstracted behind a uniform interface
interface SDRDevice {
  id: string;
  name: string;
  type: 'rtlsdr' | 'airspy' | 'hackrf' | 'usrp' | 'limesdr' | 'file';
  sampleRate: number;
  centerFrequency: number;
  gain: number;
  bandwidth: number;
  
  open(): Promise<void>;
  close(): Promise<void>;
  readSamples(count: number): Promise<Float32Array>; // IQ interleaved
  setSampleRate(rate: number): Promise<void>;
  setCenterFrequency(freq: number): Promise<void>;
  setGain(gain: number): Promise<void>;
}
```

The server handles raw SDR hardware access via native bindings (rtl-sdr, SoapySDR wrappers) and streams IQ data to the browser over WebSocket binary frames.

### Layer 2: IQ Streaming (WebSocket)

Binary WebSocket protocol for streaming IQ samples:

```
Frame Header (8 bytes):
  [0-3] uint32  sequence number
  [4-5] uint16  sample rate (kHz)
  [6-7] uint16  frame size (samples)

Frame Payload:
  Float32Array[frameSize * 2]  // interleaved I/Q
```

The server supports fan-out: one SDR source can feed multiple browser clients.

### Layer 3: Flow Engine (Client)

The flow engine is a directed acyclic graph (DAG) of processing nodes:

```typescript
interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: Record<string, ParamValue>;
  process(inputs: Map<string, Float32Array>): Map<string, Float32Array>;
}

interface FlowConnection {
  id: string;
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
  targetPort: string;
}

interface FlowGraph {
  nodes: FlowNode[];
  connections: FlowConnection[];
  execute(): void; // topological sort + process
}
```

#### Node Categories

| Category | Nodes |
|----------|-------|
| **Sources** | SDR Source, File Source, Noise Generator, Tone Generator |
| **Filters** | Low Pass, High Pass, Band Pass, Notch, FIR Custom |
| **Demodulators** | FM, AM, SSB (USB/LSB), CW |
| **Decoders** | ADS-B, AIS, APRS, POCSAG, LoRa, SSTV, NOAA APT, METEOR LRPT |
| **Analysis** | FFT, Waterfall Display, Spectrum Display, Signal Meter |
| **Output** | Audio Output, File Recorder, Network Stream |
| **Satellite** | TLE Source, Pass Predictor, Doppler Corrector, Orbit Display |
| **Math** | Gain, Mixer, Resampler, Decimator, AGC |

### Layer 4: GPU Rendering (WebGPU)

#### Waterfall Renderer
- Compute shader transforms FFT magnitude data → color via configurable colormap
- Texture scroll for waterfall history (ring buffer in GPU memory)
- Overlay layer for frequency markers, VFO indicators, band plans
- Target: 60fps+ at 4096-point FFT, 100+ lines/second

#### Spectrum Renderer
- Vertex shader plots FFT magnitude as line graph
- Peak hold, averaging, min/max envelope as additional traces
- dB scale with configurable range and reference level

#### Flow Graph Renderer
- Node boxes with input/output ports
- Bézier curve connections with animated data flow
- Real-time data rate indicators on connections
- Minimap for large graphs

### Layer 5: Satellite Subsystem

```typescript
interface SatelliteTracker {
  // TLE management
  loadTLEs(source: string): Promise<TLE[]>;
  
  // Real-time position
  getPosition(satellite: TLE, time: Date): SatellitePosition;
  
  // Pass prediction
  predictPasses(satellite: TLE, observer: GroundStation, hours: number): Pass[];
  
  // Doppler
  getDopplerShift(satellite: TLE, observer: GroundStation, frequency: number): number;
}
```

Uses SGP4/SDP4 orbital propagation (satellite.js) running client-side for real-time updates. Map rendering via MapLibre GL with satellite footprints, ground tracks, and pass visualizations.

---

## Data Flow

```
SDR Hardware
    │
    ▼ (USB / Network)
Server: SDR Bridge
    │
    ▼ (WebSocket Binary - IQ frames)
Browser: SDR Source Node
    │
    ├──→ FFT Node ──→ Waterfall Display Node (WebGPU)
    │                  Spectrum Display Node (WebGPU)
    │
    ├──→ Filter Node ──→ FM Demod Node ──→ Audio Output Node
    │                         │
    │                         └──→ APRS Decoder Node ──→ Map Display
    │
    └──→ Filter Node ──→ AM Demod Node ──→ File Recorder Node
```

All DSP runs client-side in the browser. The server is a thin bridge to hardware. This means:
- **Zero server DSP load** — all processing happens on the client GPU/CPU
- **Instant parameter changes** — no round-trip to server
- **Offline capable** — file sources work without any server
- **Scalable** — server just streams IQ, clients do the work

---

## Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Frontend | React 19 + TypeScript | Component model, ecosystem |
| State | Zustand | Lightweight, no boilerplate |
| Flow Editor | Custom (Canvas/WebGPU) | Performance, full control |
| GPU Rendering | WebGPU | Compute shaders for DSP, modern API |
| Maps | MapLibre GL JS | Open source, vector tiles, 3D |
| Orbital Mechanics | satellite.js | SGP4/SDP4, proven, lightweight |
| Backend | Node.js + TypeScript | Unified stack |
| IQ Streaming | WebSocket (ws) | Binary frames, low latency |
| SDR Access | node-usb / native addons | Direct hardware control |
| Build | Vite + Turborepo | Fast builds, monorepo |
| Styling | Tailwind CSS + custom | Utility-first + sci-fi theme |

---

## Rules & Triggers Engine

The rules engine provides event-driven automation with a full condition/action pipeline, persisted to SQLite.

### Architecture

```
Events (APRS, ADS-B, AIS, system) 
    │
    ▼
Rule Engine (server/src/rules/engine.ts)
    │
    ├── Condition Evaluator (18 condition types)
    │   ├── Signal conditions: frequency range, mode match, signal strength
    │   ├── Entity conditions: callsign match, geofence enter/exit, speed threshold
    │   ├── Temporal conditions: time of day, schedule, cooldown
    │   ├── System conditions: decoder status, connection state, resource usage
    │   └── Compound: AND/OR/NOT grouping
    │
    └── Action Executor (10 action types)
        ├── Notify: WebSocket broadcast, UI toast, sound alert
        ├── Record: start/stop recording, snapshot
        ├── Control: retune SDR, enable/disable decoder
        ├── External: MQTT publish, webhook, email
        └── Flow: trigger DataFlow pipeline
```

### Storage
- Rules stored in SQLite (`rules` table)
- Event log for audit trail
- Entity tracking with timeout detection (lost entity alerts)

---

## Data Flow vs RF Flow — Two Distinct Editors

SignalForge has **two separate flow graph systems**:

### RF Flow Editor (`FlowEditor.tsx`)
- **Purpose:** Signal processing pipelines (IQ → DSP → output)
- **Nodes:** SDR sources, filters, demodulators, decoders, audio sinks
- **Data type:** Float32Array (IQ samples, audio)
- **25+ node types** in the palette

### Data Flow Editor (`DataFlowEditor.tsx`)
- **Purpose:** Event processing and automation pipelines
- **Nodes:** Event sources (APRS packet, ADS-B update), transforms, filters, actions
- **Data type:** Structured events (JSON)
- **Bridge nodes** connect the two: e.g., "Decoder Output" node in RF Flow → "Event Source" in Data Flow

### Bridge Nodes
```
RF Flow Graph                    Data Flow Graph
┌──────────┐                    ┌──────────────┐
│ APRS     │ ── bridge ──────→ │ APRS Event   │
│ Decoder  │    (structured)    │ Source        │
└──────────┘                    └──────┬───────┘
                                       │
                                ┌──────▼───────┐
                                │ Geofence     │
                                │ Check        │
                                └──────┬───────┘
                                       │
                                ┌──────▼───────┐
                                │ MQTT Publish │
                                └──────────────┘
```

---

## Live Feed Fallback Chain

Each decoder follows a consistent fallback pattern:

```
Local Hardware (best)
    │ unavailable?
    ▼
Public Feed (good)
    │ unavailable?
    ▼
Demo Data (always works)
```

| Protocol | Local Hardware | Public Feed Fallback | Demo |
|----------|---------------|---------------------|------|
| **ADS-B** | dump1090 on port 30003 (RTL-SDR @ 1090MHz) | OpenSky Network REST API | Generated aircraft |
| **APRS** | direwolf (RTL-SDR @ 144.8MHz) | APRS-IS TCP connection (live, 2000 station cap) | Generated stations |
| **AIS** | rtl_ais (RTL-SDR @ 162MHz) | Finnish Digitraffic live API | Generated vessels |
| **ACARS** | acarsdec subprocess | *(none yet)* | Generated messages |

This means SignalForge shows **real data out of the box** — no hardware required.

---

## Decoder Status Table

The server tracks decoder health and reports via WebSocket:

| Decoder | Connection Method | Health Check | Auto-Reconnect |
|---------|------------------|--------------|-----------------|
| APRS | TCP to APRS-IS (rotate.aprs2.net:14580) | Heartbeat + station count | Yes, with backoff |
| ADS-B | TCP to dump1090:30003 or OpenSky HTTP poll | Last message age | Yes |
| AIS | HTTP poll to Digitraffic API | Response status + vessel count | Yes, with backoff |
| Satellites | HTTP to CelesTrak | TLE age (refresh daily) | Yes |
| WebSDR | HTTP proxy to KiwiSDR/WebSDR.org | Connection status | Yes |

Status is exposed on the dashboard and via MCP tools.
