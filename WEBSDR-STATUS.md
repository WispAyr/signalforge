# WebSDR Status Report
*2026-02-23*

## ✅ What Works

### Server-Side (verified, not modified)
- **WebSDR API endpoints** — all functional (`/api/websdr/receivers`, `/status`, `/connect`, `/tune`, `/disconnect`)
- **KiwiSDR WebSocket protocol** — connects, authenticates, tunes, receives audio frames
- **Audio forwarding** — server correctly tags audio with `WSD` (0x57 0x53 0x44) prefix and broadcasts via WebSocket
- **Event wiring** — `connected`, `disconnected`, `tuned`, `error` events all broadcast as JSON to WS clients
- **12 curated receivers** listed (though many are offline — see below)

### Successfully Tested
- **`sdr.hfunderground.com:8073`** (KiwiSDR) — connected successfully, status showed `connected: true, streaming: true`
- **Server logs confirmed**: `[WebSDR] KiwiSDR connected: Custom Receiver`

### Client-Side (updated)
- **WSD tag parsing** — correct (checks bytes 0x57, 0x53, 0x44)
- **Audio playback** — fixed scheduling: now uses `nextPlayTime` to queue buffers seamlessly instead of fire-and-forget `source.start()` which caused glitchy/overlapping audio
- **12kHz → 44.1kHz resampling** — Web Audio API handles this automatically via `createBuffer(1, length, 12000)`
- **WebSocket URL** — uses `ws://host/ws` which works through Vite proxy

## 🔧 Client Fixes Applied

1. **Audio scheduling** — Added `nextPlayTimeRef` to schedule audio buffers consecutively, preventing gaps and overlaps
2. **S-Meter** — Added signal strength display with S-units (S0–S9+dB), peak hold, and visual bar
3. **Spectrum display** — Added separate spectrum canvas above waterfall showing real-time frequency response curve
4. **Responsive canvases** — Replaced fixed 600×120 with ResizeObserver-based dynamic sizing
5. **Band plan overlay** — Visual HF band plan bar (0–30 MHz) with clickable bands and current frequency indicator
6. **More presets** — Added UK/Europe relevant: RAF Volmet, Shannon Volmet, Navtex, RTE Radio 1, CW bands, SSB calling freqs, FT8 30m, Radio Romania, Deutsche Welle
7. **Receiver info panel** — Shows connected receiver location, type, bands when connected
8. **Active preset highlighting** — Current frequency/mode combo highlighted in preset list
9. **Better error feedback** — Shows "receiver may be offline or full" when connection fails without explicit error

## ⚠️ Receiver Availability Issues

### DNS/Connectivity Problems (tested from Bravo)
| Receiver | Issue |
|----------|-------|
| `hackgreen.kiwisdr.com:8073` | **DNS NXDOMAIN** — domain not resolving |
| `rx.linkfanel.net:8073` | ECONNREFUSED — port 8073 closed |
| `kiwisdr.oe3rau.at:8073` | Connection timeout |
| `kiwisdr.sk3w.se:8073` | Connection timeout |
| `sdr.telcal.it:8073` | Connection timeout |
| `websdr.suws.org.uk` | Connection timeout (WebSDR type) |

### WebSDR Protocol Issue
| Receiver | Issue |
|----------|-------|
| `websdr.ewi.utwente.nl:8901` | **HTTP Parse Error** — `Expected HTTP/, RTSP/ or ICE/` — Twente's `~~stream` endpoint returns non-standard HTTP response |

### Working
| Receiver | Status |
|----------|--------|
| `sdr.hfunderground.com:8073` | ✅ KiwiSDR — connects and streams |

## 🔴 Server Changes Needed (DO NOT edit server files)

### 1. WebSDR HTTP Streaming Parse Fix
The `connectWebSDR()` method in `websdr.ts` uses Node.js `http.get()` which expects standard HTTP responses. The Twente WebSDR `~~stream` endpoint returns a non-standard streaming response that Node's HTTP parser rejects.

**Fix needed in `packages/server/src/sdr/websdr.ts`:**
- Replace `http.get()` with raw TCP socket (`net.Socket`) for WebSDR-type connections
- OR use a more permissive HTTP client that can handle non-standard responses
- The WebSDR stream URL format is: `http://host/~~stream?freq=F&band=0&lo=L&hi=H&mode=M`

### 2. Update Receiver List
Many hardcoded receivers are offline. Consider:
- Adding `sdr.hfunderground.com:8073` (confirmed working)
- Removing or marking `hackgreen.kiwisdr.com:8073` as offline (DNS dead)
- Adding a receiver health-check on startup that pings each receiver
- Consider querying `kiwisdr.com/public` API for live receiver list

### 3. Receiver Status Polling
All receivers show `status: "unknown"`. Add periodic connectivity checks to update status to `online`/`offline` so users know which receivers are available before trying to connect.

## Architecture Summary

```
Client (WebSDRView.tsx)
  ├── REST API calls → /api/websdr/* → Server handles connect/tune/disconnect
  ├── WebSocket /ws → receives binary frames tagged 'WSD' + PCM 16-bit LE @ 12kHz
  └── AudioContext (44.1kHz) ← createBuffer(12kHz) → auto-resample → speakers

Server (websdr.ts)
  ├── KiwiSDR: WebSocket to receiver → auth → tune → SND binary frames → emit('audio')
  ├── WebSDR: HTTP GET ~~stream → chunked response → emit('audio') [BROKEN - parse error]
  └── index.ts: websdrService.on('audio') → prepend [0x57,0x53,0x44] → broadcastBinary()
```
