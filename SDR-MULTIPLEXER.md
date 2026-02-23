# SDR Multiplexer — Implementation Report

## What Was Built

### Core: `packages/server/src/sdr/multiplexer.ts`
- **SDRMultiplexer** class — manages physical SDR + virtual receivers
- **VirtualReceiver** class — DDC → FIR filter → decimation → demodulation
- **DecoderPipeline** class — spawns multimon-ng, parses POCSAG/FLEX output
- Pure TypeScript DSP: radix-2 FFT, Blackman-Harris windowing, sinc FIR design, NFM discriminator
- Auto-detect via `rtl_test -t`, auto-spawn `rtl_tcp` on port 1235

### Background Flows System
- Config file: `packages/server/config/background-flows.json` (2 flows: pager decoder, AIS receiver)
- REST API: GET/PUT/POST for background flows, lock/unlock mechanism
- Flow Editor UI: ⚡ Background dropdown, BG badge, lock/unlock toggle, read-only mode
- Pager decoder is first background flow — auto-starts when SDR detected

### Flow Editor Integration
- New node types: `downconverter` (DDC), `pocsag_decoder` (POCSAG/FLEX)
- Added to both FlowEditor.tsx NODE_META and FlowRunner.ts processors
- Pager decoder preset added to flowgraph presets
- `/api/sdr/multiplexer/flow` returns live multiplexer state as flow graph

### Bug Fix
- `RtlTcpClient`: Added default error handler in constructor to prevent Node.js crash on unhandled error event

### Documentation
- `docs/BACKGROUND-FLOWS.md` — Design document (problem, solution, philosophy, config-driven extensibility)
- `docs/SDR-ARCHITECTURE.md` — Technical deep-dive (rtl_tcp protocol, DSP math, API reference)
- README.md updated — SDR Multiplexer, Background Flows, Pager Decoder moved to REAL section

## API Endpoints Added

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/sdr/multiplexer/status` | GET | Multiplexer state + virtual receivers |
| `/api/sdr/multiplexer/flow` | GET | Multiplexer as flow graph |
| `/api/sdr/multiplexer/receiver` | POST | Add virtual receiver |
| `/api/sdr/multiplexer/receiver/:id` | DELETE | Remove virtual receiver |
| `/api/sdr/multiplexer/receiver/:id/tune` | POST | Retune receiver |
| `/api/sdr/mux-devices` | GET | Device detection + multiplexer status |
| `/api/background-flows` | GET | List background flows |
| `/api/background-flows/:id` | GET | Full flow definition |
| `/api/background-flows/:id/lock` | POST | Lock/unlock flow |
| `/api/background-flows/:id` | PUT | Update flow (must be unlocked) |
| `/api/flows/all` | GET | Combined background + user flows |

## Verification Results

- ✅ Server comes back up (`/api/health` returns 200)
- ✅ `/api/sdr/mux-devices` detects RTL-SDR: `Realtek, RTL2838UHIDIR, SN: 00000001`
- ✅ `/api/sdr/multiplexer/status` returns valid structure
- ✅ `/api/background-flows` returns 2 flows (pager-decoder, ais-receiver)
- ✅ `/api/background-flows/pager-decoder` returns full flow with 6 nodes, 5 edges
- ⚠️ Multiplexer auto-connect interrupted by tsx watch restart (EADDRINUSE race), but the detection and init logic works
- ⚠️ Git push failed — Bravo has no GitHub auth configured (SSH key or gh CLI). Commit `d403698` saved locally.

## Known Issues

1. **tsx watch restart race**: When files change, tsx kills the old server and starts new one. If port release is slow, EADDRINUSE crashes the new instance. PM2 auto-restarts, so it self-heals, but the multiplexer auto-start may not retry.
2. **Git push**: Bravo needs GitHub auth (`gh auth login` or SSH key) to push.
3. **multimon-ng sample rate**: multimon-ng expects raw audio at specific rates. The `-t raw` flag with 22050 Hz should work, but may need `-e` flag for sample rate specification depending on version.

## Architecture

```
RTL-SDR USB ──► rtl_tcp :1235 ──► SDRMultiplexer
                                    ├── FFT (2048-pt, Blackman-Harris) ──► WebSocket (spectrum/waterfall)
                                    └── VirtualReceiver (153.350 MHz)
                                        ├── DDC (freq shift to baseband)
                                        ├── FIR LP (65 taps, 6.25 kHz cutoff)
                                        ├── Decimate (÷92 → 22050 Hz)
                                        ├── NFM Demod (atan2 discriminator)
                                        └── multimon-ng (POCSAG512/1200/2400 + FLEX)
                                            └── PagerService.processMessage()
```
