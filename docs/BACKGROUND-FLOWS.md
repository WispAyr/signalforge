# Background Flows — Design Document

## The Problem

SignalForge has one RTL-SDR dongle. Traditionally, SDR applications are single-consumer: `rtl_fm` decodes one channel, `rtl_tcp` streams to one client, and they all fight over the device. You can't simultaneously display a waterfall, decode pager messages, and listen to AIS — they each want exclusive access to the USB device.

## The Solution

A **software SDR multiplexer** captures wideband IQ data once from `rtl_tcp`, then software-splits it into multiple virtual receivers. Each virtual receiver extracts a narrowband channel via digital downconversion (frequency shift → low-pass filter → decimation → demodulation). This is exactly how professional SDR platforms (GNU Radio, SDR#, etc.) work.

The multiplexer is wrapped in a **Background Flow** — a persistent, config-driven signal processing pipeline that runs automatically and powers core features.

```
                            ┌─────────────────────────────────┐
                            │     SignalForge Server           │
                            │                                  │
  RTL-SDR ──► rtl_tcp ──►  │  SDR Multiplexer                 │
              (2.048 MS/s)  │    ├── FFT ──► Spectrum/Waterfall│ ──► WebSocket ──► Browser
                            │    │           (broadcast)       │
                            │    ├── VRx1: 153.350 MHz         │
                            │    │   └─ DDC ─► NFM ─► PCM     │ ──► multimon-ng ──► PagerService
                            │    │                              │
                            │    ├── VRx2: 162.025 MHz (future)│
                            │    │   └─ DDC ─► GMSK ─► AIS    │ ──► AISDecoder
                            │    │                              │
                            │    └── VRxN: ...                  │
                            └─────────────────────────────────┘
```

## Background Flows vs User Flows

### Philosophy

SignalForge has two categories of flow graphs:

| | Background Flows | User Flows |
|---|---|---|
| **Purpose** | Core infrastructure — always-on signal processing | Experimentation, learning, one-off analysis |
| **Lifecycle** | Persistent across restarts, config-driven | Saved to localStorage / server, manually loaded |
| **Editing** | Locked by default, explicit unlock with warning | Freely editable |
| **Visual** | Amber border, "BG" badge, status indicator | Standard cyan theme |
| **Creation** | Config file (`config/background-flows.json`) | Flow Editor UI |
| **Examples** | Pager decoder, AIS receiver, APRS gateway | "Can I hear this FM station?", test filters |

### Why Locked by Default

Background flows power live operational systems. The pager decoder is feeding real-time emergency messages to PagerService. If someone accidentally deletes a connection or changes a frequency in the Flow Editor, they break live signal processing.

The lock mechanism provides **operational safety** while maintaining **full transparency** — you can see exactly what the system is doing (it's a visible flow graph), but you can't accidentally break it.

The unlock flow requires explicit confirmation: click 🔒 → warning dialog → confirm → flow becomes editable. Re-lock when done.

## Config-Driven Extensibility

Background flows are defined in `packages/server/config/background-flows.json`:

```json
{
  "flows": [
    {
      "id": "pager-decoder",
      "name": "UK Pager Decoder",
      "description": "POCSAG/FLEX on 153.350 MHz",
      "locked": true,
      "autoStart": true,
      "category": "decoder",
      "icon": "📟",
      "nodes": [...],
      "edges": [...]
    }
  ]
}
```

To add a new background flow (e.g., AIS maritime receiver):

1. Add the flow definition to `background-flows.json`
2. If new node types are needed, add processors to `FlowRunner.ts` and metadata to `FlowEditor.tsx`
3. If the flow needs a new virtual receiver, the multiplexer creates it automatically based on the flow config
4. Restart the server — the new flow auto-starts if `autoStart: true`

## The DSP Pipeline

Each virtual receiver performs these steps in pure TypeScript (no external DSP libraries):

### 1. Digital Downconversion (DDC)
Shift the desired signal to baseband by multiplying IQ samples with a complex sinusoid:

```
shifted[n] = iq[n] × e^(-j × 2π × offset/sampleRate × n)
```

Where `offset = desiredFreq - sdrCenterFreq`. This shifts the desired signal to 0 Hz.

### 2. Low-Pass FIR Filter
A 65-tap FIR filter designed using the windowed-sinc method with Blackman-Harris window. Cutoff is set to half the channel bandwidth (e.g., 6.25 kHz for a 12.5 kHz NFM channel).

### 3. Decimation
After filtering, keep every Nth sample to reduce the sample rate. For pager decoding: 2,048,000 → 22,050 Hz (decimation factor ≈ 93).

### 4. Demodulation
- **NFM**: FM discriminator using conjugate product — `atan2(Q[n]·I[n-1] - I[n]·Q[n-1], I[n]·I[n-1] + Q[n]·Q[n-1])`
- **AM**: Envelope detection — `√(I² + Q²)`
- **USB/LSB**: Take real/imaginary component (simplified)

### 5. Decoder
The demodulated PCM audio is piped to `multimon-ng` via stdin for POCSAG/FLEX pager decoding. Decoded messages are parsed from stdout and fed into PagerService.

## Flow Editor Integration

Background flows appear in the Flow Editor via the **⚡ Background** dropdown button. Each flow shows:
- Icon and name
- Status badge (running / stopped / error)
- Lock indicator (🔒)

When loaded, background flows display with:
- Amber **BG** badge next to the flow name
- **READ-ONLY** indicator when locked
- **EDITING** indicator when unlocked (red, to signal caution)
- Locked flows allow panning/zooming but block node drag, wire creation, and deletion

## Future Vision

### Multiple SDRs
The multiplexer architecture supports multiple physical SDRs. Each creates its own set of virtual receivers. The Flow Editor would show multiple source nodes.

### Network SDRs
`rtl_tcp` already supports remote connections. Edge nodes (Raspberry Pi with SDR) can run `rtl_tcp` and the multiplexer connects over the network. This enables distributed SDR networks.

### Edge Node SDRs
Each SignalForge edge node could run its own multiplexer, with background flows processing signals locally and forwarding decoded data to the central server.

### Dynamic Flow Creation
Currently, virtual receivers are created programmatically. Future: creating a flow graph in the editor automatically provisions the corresponding virtual receivers in the multiplexer.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/background-flows` | GET | List all background flows (summary) |
| `/api/background-flows/:id` | GET | Get full flow definition (nodes + edges) |
| `/api/background-flows/:id/lock` | POST | Lock/unlock a flow (`{ locked: bool }`) |
| `/api/background-flows/:id` | PUT | Update flow (only if unlocked) |
| `/api/flows/all` | GET | Combined list of background + user flows |
| `/api/sdr/multiplexer/status` | GET | Multiplexer state + all virtual receivers |
| `/api/sdr/multiplexer/flow` | GET | Current multiplexer as a flow graph |
| `/api/sdr/multiplexer/receiver` | POST | Add virtual receiver |
| `/api/sdr/multiplexer/receiver/:id` | DELETE | Remove virtual receiver |
| `/api/sdr/multiplexer/receiver/:id/tune` | POST | Retune virtual receiver |
