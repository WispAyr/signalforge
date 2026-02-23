# SDR Architecture — Technical Deep-Dive

## rtl_tcp Protocol

`rtl_tcp` is a simple TCP server that streams raw IQ data from an RTL-SDR dongle.

### Handshake
On connect, the server sends 12 bytes:
- Bytes 0-3: Magic `RTL0` (ASCII)
- Bytes 4-7: Tuner type (uint32 big-endian) — 5 = R820T, 6 = R828D, etc.
- Bytes 8-11: Gain count (uint32 big-endian)

### IQ Data Stream
After handshake, raw unsigned 8-bit IQ samples stream continuously:
```
[I0][Q0][I1][Q1][I2][Q2]...
```
Each byte is 0-255. To convert to float: `(byte - 127.5) / 127.5` → range [-1.0, +1.0].

### Commands
Client sends 5-byte command packets:
```
[cmd_byte][value_uint32_be]
```
| Cmd | Function |
|-----|----------|
| 0x01 | Set frequency (Hz) |
| 0x02 | Set sample rate (Hz) |
| 0x03 | Set gain mode (0=auto, 1=manual) |
| 0x04 | Set gain (tenths of dB) |
| 0x05 | Set frequency correction (ppm) |
| 0x08 | Set AGC mode |
| 0x0E | Set bias tee |

## IQ Data Format

IQ (In-phase/Quadrature) data represents radio signals as complex numbers:
- **I** = real component (cosine carrier)
- **Q** = imaginary component (sine carrier)
- Together: `signal[n] = I[n] + j·Q[n]`

At 2.048 MS/s centered on 153.350 MHz, the captured bandwidth is ±1.024 MHz (152.326 — 154.374 MHz). Every signal in that band is captured simultaneously.

## Virtual Receiver DSP Math

### Complex Mixer (Frequency Shift)

To extract a signal at frequency `f_target` from wideband IQ centered at `f_center`:

```
offset = f_target - f_center
phase_increment = -2π × offset / sample_rate
shifted[n] = iq[n] × exp(j × phase_accumulator)
phase_accumulator += phase_increment
```

This is equivalent to tuning a radio — it shifts the desired signal to 0 Hz (baseband).

**Implementation note:** We compute `cos(phase)` and `sin(phase)` per sample. The phase accumulator is bounded to [-π, π] to prevent floating-point drift.

### FIR Low-Pass Filter Design

We use a windowed-sinc method with Blackman-Harris window:

**Sinc function** (ideal low-pass impulse response):
```
h[n] = sin(2π × f_cutoff × (n - M)) / (π × (n - M))    for n ≠ M
h[M] = 2 × f_cutoff                                       for n = M
```
Where `M = (numTaps - 1) / 2` and `f_cutoff` is normalized (0 to 0.5).

**Blackman-Harris window** (excellent sidelobe suppression, -92 dB):
```
w[n] = 0.35875 - 0.48829·cos(2πn/(N-1)) + 0.14128·cos(4πn/(N-1)) - 0.01168·cos(6πn/(N-1))
```

**Final filter:** `taps[n] = h[n] × w[n]`, then normalize so taps sum to 1.0.

We use 65 taps, which at 2.048 MS/s provides a transition bandwidth of ~30 kHz — adequate for 12.5 kHz NFM channels.

### Decimation

After filtering removes out-of-band energy, we downsample by keeping every Nth sample:
```
decimation_factor = floor(input_rate / output_rate)
output[k] = filtered[k × N]
```

For pager decoding: `N = floor(2,048,000 / 22,050) = 92`

The FIR filter serves as the anti-aliasing filter required before decimation. We compute the filter output only at decimation points (polyphase optimization would be even faster but isn't needed at these rates).

### NFM Demodulation

Narrowband FM demodulation using the conjugate-product FM discriminator:

```
cross = Q[n]·I[n-1] - I[n]·Q[n-1]
dot   = I[n]·I[n-1] + Q[n]·Q[n-1]
audio[n] = atan2(cross, dot) / π
```

This computes the instantaneous phase difference between consecutive samples, which is proportional to the instantaneous frequency — exactly what FM encodes.

Division by π normalizes to [-1, 1]. For NFM with ±5 kHz deviation at 22050 Hz sample rate, this gives clean audio.

### AM Demodulation
Envelope detection: `audio[n] = √(I[n]² + Q[n]²)`

### SSB Demodulation (Simplified)
- **USB**: `audio[n] = I[n]` (real component after frequency shift to baseband)
- **LSB**: `audio[n] = Q[n]`

A proper SSB implementation would use a Hilbert transform, but for monitoring purposes this is adequate.

## FFT for Spectrum Display

Radix-2 DIT FFT with Blackman-Harris windowing:

1. Apply window to IQ data (2048 complex samples)
2. In-place radix-2 butterfly (bit-reversal + Cooley-Tukey)
3. Compute magnitude: `20 × log10(√(re² + im²) / N)` → dB
4. FFT-shift: swap halves so DC is centered
5. Broadcast Float32Array via WebSocket (binary)

Throttled to every 4th IQ chunk (~125 Hz update rate at 2.048 MS/s with 2048-point FFT).

## multimon-ng Integration

### Subprocess
```bash
/opt/homebrew/bin/multimon-ng -a POCSAG512 -a POCSAG1200 -a POCSAG2400 -a FLEX -t raw -f alpha /dev/stdin
```

Raw 16-bit signed PCM audio is piped to stdin. Decoded messages appear on stdout.

### Audio Conversion
Virtual receiver outputs Float32 [-1, 1] samples. Conversion to 16-bit PCM:
```
pcm_sample = round(clamp(float_sample, -1, 1) × 32767)
```
Written as little-endian int16 to multimon-ng's stdin.

### Output Parsing
```
POCSAG1200: Address: 1234000  Function: 0  Alpha:   FIRE ALARM AT 123 MAIN ST
POCSAG512:  Address: 5678000  Function: 2  Numeric:   1234567890
```

Regex: `POCSAG(\d+):\s+Address:\s+(\d+)\s+Function:\s+(\d+)\s+(Alpha|Numeric|Tone):\s*(.*)`

Parsed fields are passed to `PagerService.processMessage()`.

## Auto-Detection Flow

```
Server startup
  ├── SDRMultiplexer.autoStart()
  │     ├── detectDevice()
  │     │     └── exec: rtl_test -t (timeout 5s)
  │     │           ├── "Found" in output → device present
  │     │           └── error/timeout → no device, graceful exit
  │     │
  │     ├── pkill rtl_tcp (clean slate)
  │     ├── spawn: rtl_tcp -p 1235
  │     │     └── wait for "listening" on stderr (or 2s timeout)
  │     │
  │     ├── connect('127.0.0.1', 1235)
  │     │     ├── TCP connect → handshake (12 bytes)
  │     │     ├── Set frequency: 153.350 MHz
  │     │     ├── Set sample rate: 2.048 MS/s
  │     │     └── Set gain: 40 dB
  │     │
  │     └── addReceiver({
  │           centerFreq: 153.350e6,
  │           bandwidth: 12500,
  │           outputRate: 22050,
  │           mode: 'NFM',
  │           decoder: 'multimon-ng'
  │         })
  │           ├── VirtualReceiver created
  │           ├── FIR filter designed (65 taps, Blackman-Harris)
  │           ├── DecoderPipeline spawns multimon-ng
  │           └── rx.on('audio') → decoder.feedAudio()
  │
  └── sdrMultiplexer.on('pager_message') → pagerService.processMessage()
```

## API Reference

### Multiplexer Status
```
GET /api/sdr/multiplexer/status
→ {
    connected: true,
    centerFreq: 153350000,
    sampleRate: 2048000,
    fftSize: 2048,
    fftRate: 250,
    receivers: [{
      id: "vrx-...",
      centerFreq: 153350000,
      bandwidth: 12500,
      outputRate: 22050,
      mode: "NFM",
      decoder: "multimon-ng",
      label: "Pager 153.350 MHz",
      offsetHz: 0,
      decimation: 92,
      active: true
    }],
    rtlTcpPid: 12345
  }
```

### Add Virtual Receiver
```
POST /api/sdr/multiplexer/receiver
Body: { centerFreq: 162025000, bandwidth: 25000, outputRate: 48000, mode: "NFM", decoder: "none", label: "AIS Ch2" }
→ VirtualReceiverStatus
```

### Remove Virtual Receiver
```
DELETE /api/sdr/multiplexer/receiver/:id
→ { success: true }
```

### Retune Virtual Receiver
```
POST /api/sdr/multiplexer/receiver/:id/tune
Body: { centerFreq: 153375000 }
→ { success: true }
```

### Multiplexer as Flow Graph
```
GET /api/sdr/multiplexer/flow
→ { id, name, nodes: [...], connections: [...], auto: true }
```

### Background Flows
```
GET /api/background-flows → [{ id, name, description, locked, status, icon, ... }]
GET /api/background-flows/:id → full flow with nodes/edges
POST /api/background-flows/:id/lock → { locked: bool }
PUT /api/background-flows/:id → update nodes/edges (must be unlocked)
GET /api/flows/all → combined background + user flows list
```

### WebSocket Message Types

| Type | Direction | Format | Description |
|------|-----------|--------|-------------|
| `fft_data` | server→client | Binary Float32Array | FFT magnitudes (dB), 2048 bins |
| `fft_meta` | server→client | JSON | `{ type, centerFrequency, sampleRate, fftSize }` |
| `iq_meta` | server→client | JSON | `{ type, sampleRate, centerFrequency, timestamp }` |
| `sdr_connected` | server→client | JSON | SDR connection established |
| `sdr_disconnected` | server→client | JSON | SDR connection lost |

## Hardware Tested

- **RTL-SDR Blog V3** (R820T2 tuner) — primary development dongle
- **rtl_tcp** at `/opt/homebrew/bin/rtl_tcp` (macOS ARM64 via Homebrew)
- **multimon-ng** at `/opt/homebrew/bin/multimon-ng`
- **Frequency range**: 24 MHz — 1766 MHz
- **Max sample rate**: 3.2 MS/s (2.048 MS/s used for stability)
