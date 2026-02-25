# Pager Decoder Status — SignalForge

## Status: ✅ WORKING (Real POCSAG decoding active)

**Date:** 2026-02-23  
**Frequency:** 153.350 MHz (UK POCSAG — NHS, emergency services)  
**Pipeline:** rtl_fm → multimon-ng → HTTP POST → SignalForge PagerService

## Architecture

```
RTL-SDR (device 0) 
  → rtl_fm -f 153.350M -s 22050 -g 49.6
    → multimon-ng -a POCSAG512 -a POCSAG1200 -a POCSAG2400 -a FLEX -t raw
      → pager-decoder.py (Python, pty-based for unbuffered output)
        → POST http://localhost:3401/api/pager/messages
          → PagerService.processMessage()
```

## Files Created

| File | Purpose |
|------|---------|
| `pager-decoder.py` | Main decoder pipeline (Python, uses pty for unbuffered multimon-ng) |
| `pager-decoder.sh` | Bash version (backup, has stdout buffering issues) |
| `PAGER-STATUS.md` | This file |

## Server Changes

- **`packages/server/src/index.ts`**: Added `POST /api/pager/messages` endpoint for external decoder injection
- **Fixed**: Pre-existing emoji syntax errors in SDR Multiplexer console.log statements (unquoted template literals)

## Decoded Messages (confirmed working)

| Time | Protocol | Address | Content |
|------|----------|---------|---------|
| 20:10 (test) | POCSAG2400 | 1190641 | (tone-only) |
| 20:27-20:30 | Multiple | Various | 5 messages (server was down, POST failed) |
| 20:34:38 | POCSAG2400 | 981618 | (tone-only) |
| 20:37:53 | POCSAG1200 | 1614395 | (tone-only) |

## Running the Decoder

```bash
# Start (kills rtl_tcp if running — only 1 SDR dongle)
nohup python3 ~/operations/signalforge/pager-decoder.py >> /tmp/pager-py.log 2>&1 &

# Stop
pkill -f pager-decoder.py; pkill -9 rtl_fm; pkill -9 multimon
```

## Constraints & Notes

1. **Single SDR dongle** — rtl_tcp must be killed for rtl_fm to use the dongle
2. **Demo mode** still runs alongside real decoding (no API to stop it; need server edit)
3. **Signal strength** — mostly tone-only messages decoded; alpha messages need better antenna/gain
4. **Output buffering** — Python pty wrapper solves multimon-ng stdout buffering on macOS
5. **multimon-ng** was built from source (not in homebrew), installed at `/opt/homebrew/bin/multimon-ng`

## UK Pager Frequencies (for future use)

| Frequency | Service |
|-----------|---------|
| **153.350 MHz** | Main UK POCSAG (NHS, emergency services) — **ACTIVE** |
| 153.075 MHz | UK paging |
| 153.3625 MHz | UK paging |
| 466.075 MHz | On-site paging |
| 148.8125 MHz | Vodafone paging (historical) |

## TODO

- [ ] Stop demo mode when real decoder is active
- [ ] Add launchd/PM2 service for persistent decoder operation
- [ ] Better antenna for alpha message reception
- [ ] Support frequency switching via API
- [ ] Consider SDR multiplexer approach (share dongle between waterfall + pager)
