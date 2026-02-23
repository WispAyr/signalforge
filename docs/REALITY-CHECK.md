# SignalForge Reality Check — What's Real vs Demo

**Date:** 2026-02-23
**Honest assessment of every feature**

## ✅ REAL — Actually works with real data/hardware

| Feature | Status | Details |
|---------|--------|---------|
| **Satellite Tracking** | ✅ REAL | Fetches TLE from CelesTrak, SGP4 propagation via satellite.js, real positions, pass predictions |
| **ADS-B Decoder** | ✅ REAL (with fallback) | Real dump1090 BaseStation parser on port 30003. Falls back to demo if no dump1090 running |
| **RTL-TCP SDR Bridge** | ✅ REAL | Full rtl_tcp protocol client, connects to real rtl_tcp instances, IQ streaming |
| **SoapySDR Client** | ✅ REAL | SoapyRemote protocol implementation, connects to real SoapySDR servers |
| **Rotator Control** | ✅ REAL | Hamlib rotctld TCP protocol, real az/el control |
| **MQTT Integration** | ✅ REAL | Full MQTT 3.1.1 client, connects to real brokers, publishes decoded data |
| **GPS/Location** | ✅ REAL | gpsd client (real GPS hardware), Nominatim geocoding, browser geolocation |
| **SatNOGS API** | ✅ REAL | Real API calls to network.satnogs.org |
| **Browser DSP** | ✅ REAL | FIR filters, FM/AM/SSB demod actually implemented in JS (Web Audio, NOT WebGPU) |
| **Flow Editor** | ✅ REAL | Canvas-based node graph, drag/drop, wiring, save/load — works |
| **Waterfall/Spectrum** | ✅ REAL | Canvas rendering of spectrum data — works with real or demo IQ |
| **3D Globe** | ✅ REAL | Globe.gl + Three.js, real satellite positions, interactive |
| **UI/Navigation** | ✅ REAL | Sidebar, command palette, themes, responsive — all functional |
| **MCP Server** | ✅ REAL | 41 tools defined with @modelcontextprotocol/sdk, routes to REST API |
| **Doppler Correction** | ✅ REAL | Math is correct, applies to SDR tuning during sat pass |
| **Signal Database** | ✅ REAL | 28+ built-in signal entries, search, bookmarks — static data but real |
| **Logbook** | ✅ REAL | ADIF format, CRUD operations, export — works (in-memory, no persistence yet) |

## 🟡 DEMO MODE — Has real connection code but currently running demo data

| Feature | Status | What's needed to make it real |
|---------|--------|-------------------------------|
| **ADS-B Aircraft** | ✅ REAL | OpenSky Network live feed as fallback from local dump1090. Real aircraft data out of the box. |
| **AIS Vessels** | ✅ REAL | Finnish Digitraffic live API feed as fallback from local rtl_ais. Real vessel data out of the box. |
| **ACARS Messages** | 🟡 Demo data | Need acarsdec running. Could also pull from AirWave project. |
| **APRS Stations** | ✅ REAL | Live APRS-IS connection (rotate.aprs2.net:14580), 2000 station cap, sortable/filterable table view |
| **IQ Streaming** | 🟡 Demo sine waves | Real rtl_tcp code works — just need hardware connected. Plug in RTL-SDR → real data. |
| **Observation Scheduler** | 🟡 Framework only | Scheduling logic exists, needs SDR+rotator connected to actually record |

## 🟠 STUB — Code structure exists but core logic is demo/simulated

| Feature | Status | Work needed |
|---------|--------|-------------|
| **rtl_433 IoT** | 🟠 Stub | Has demo data generator. Needs: spawn rtl_433 process, parse JSON output |
| **POCSAG/FLEX Pager** | 🟠 Stub | Demo messages. Needs: spawn multimon-ng, parse output |
| **Sub-GHz/HackRF** | 🟠 Stub | Demo data. Needs: hackrf_sweep integration, ISM protocol library |
| **SSTV Decoder** | 🟠 Stub | Demo image placeholder. Needs: actual SSTV audio→image DSP (complex!) |
| **Utility Meters** | 🟠 Stub | Demo readings. Needs: rtl_433 with meter protocols enabled |
| **WiFi Scanner** | 🟠 Stub | Demo AP list. Needs: aircrack-ng/iwlist subprocess, root/sudo |
| **Bluetooth Scanner** | 🟠 Stub | Demo devices. Needs: bluetoothctl/hcitool subprocess |
| **TSCM** | 🟠 Stub | Demo threat data. Needs: real spectrum data + baseline comparison logic |
| **Meshtastic** | 🟠 Stub | Demo nodes. Needs: Meshtastic serial/TCP protocol implementation |
| **VDL2** | 🟠 Stub | Demo messages. Needs: dumpvdl2 subprocess integration |
| **Digital Voice (DMR/D-STAR/C4FM)** | 🟠 Stub | Demo data. Needs: DSD/DSD+ integration (very complex DSP) |
| **Number Stations** | 🟠 Static DB | Database is real data but "now on air" is simulated scheduling |
| **DX Cluster** | ✅ REAL | Telnet-style feed integration working |
| **Audio Streaming** | 🟠 Framework | Web Audio scaffolding. Needs: real IQ→audio pipeline connected |
| **Aaronia Spectran** | 🟠 Stub | API client structure. Needs: real Aaronia hardware + RTSA-Suite running |

## 🔴 PLACEHOLDER — UI exists but minimal/no backend logic

| Feature | Status | Work needed |
|---------|--------|-------------|
| **WebGPU DSP** | 🔴 Labeled only | Status bar says "WebGPU" but DSP is plain JavaScript. Need actual WebGPU compute shaders. |
| **AI Signal Narrator** | 🔴 Placeholder | UI exists. Needs: LLM API integration + prompt engineering |
| **Community Hub** | 🔴 UI only | Pages exist. Needs: backend API, database, user system |
| **Training Academy** | 🔴 UI only | Pages exist. Needs: tutorial content, interactive exercises |
| **Signal Classifier (AI)** | 🔴 Basic heuristics | Pattern matching is simplistic. Hailo-8 stub is just a stub. |
| **Multi-Window** | 🔴 Not implemented | BroadcastChannel concept only |
| **Time Machine** | 🔴 UI only | Needs: recording storage, playback engine |
| **Integration Hub** | 🔴 UI only | Config forms exist. Needs: actual integration code per service |
| **Equipment Manager** | 🔴 Static data | Hardware database is static. No real device detection. |
| **Cinematic Mode** | 🔴 Basic | Auto-cycle exists but needs polished visualizations |
| **Geo-fencing** | ✅ REAL | Zone drawing + real-time entity checking via rules engine (geofence enter/exit conditions) |
| **Waterfall Recording** | 🔴 Framework | Start/stop UI. Needs: actual data capture and storage |
| **Plugin Loader** | 🔴 Static | 4 "built-in plugins" are hardcoded, not actually loadable externally |
| **Edge Node Package** | 🔴 Scaffolding | Package exists but minimal — needs real SDR/GPS integration code |
| **Offline/Field Mode** | 🔴 SW only | Service worker caches app shell. No real data bundling. |
| **Logbook Persistence** | ✅ REAL | SQLite persistence for logbook, recordings, settings, geofences, bookmarks |

## Priority Work Plan

### Phase A: Make the core loop real (1-2 days)
1. **Connect RTL-SDR** → rtl_tcp on NOC Pi (192.168.195.238) → real IQ streaming
2. **Real waterfall** from live IQ data
3. **Real FM demod** → audio output in browser
4. **SQLite persistence** for logbook, settings, recordings metadata
5. **Fix flow editor** canvas issue from sidebar

### Phase B: Real decoders via subprocess (2-3 days)
1. **dump1090** for ADS-B → real aircraft on map
2. **rtl_433** for IoT sensors → real 433MHz devices
3. **direwolf** or **APRS-IS** for APRS → real amateur stations
4. **acarsdec** for ACARS (or pull from AirWave)
5. All via: spawn subprocess → parse stdout/JSON → WebSocket to client

### Phase C: Edge nodes (2-3 days)
1. Build real edge-node package that runs on NOC Pi
2. Pi connects RTL-SDR, streams IQ to server
3. GPS from Pi's gpsd
4. Hailo-8 for signal classification (if models exist)

### Phase D: Harder integrations (1-2 weeks)
1. **DX Cluster** telnet client
2. **Meshtastic** serial protocol
3. **SSTV** decoding (use SatDump or port existing decoder)
4. **Digital voice** (DSD+ integration)
5. **TSCM** baseline/comparison logic
6. **WebGPU** FFT compute shader (real GPU acceleration)

### Phase E: Platform features (ongoing)
1. Community hub backend
2. Training content
3. Real plugin loader
4. AI narrator with LLM
5. Multi-window BroadcastChannel
6. Persistence layer (SQLite)
