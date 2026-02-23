// ============================================================================
// SignalForge Academy — Full Lesson Content
// ============================================================================

export interface Lesson {
  id: string;
  module: string;
  moduleId: number;
  lessonNumber: number;
  title: string;
  content: string; // markdown
  quiz: QuizItem[];
  interactive?: string; // interactive component identifier
}

export interface QuizItem {
  question: string;
  options: string[];
  correct: number; // index
}

export interface AcademyModule {
  id: number;
  title: string;
  description: string;
  icon: string;
  lessonCount: number;
}

export const MODULES: AcademyModule[] = [
  { id: 1, title: 'Radio Fundamentals', description: 'Electromagnetic spectrum, modulation, and signal strength basics', icon: '📻', lessonCount: 3 },
  { id: 2, title: 'SDR Basics', description: 'Software-defined radio concepts — from ADC to waterfall', icon: '🔧', lessonCount: 3 },
  { id: 3, title: 'Satellite Tracking', description: 'Orbital mechanics, TLE data, and Doppler correction', icon: '🛰️', lessonCount: 3 },
  { id: 4, title: 'Digital Modes', description: 'ADS-B, APRS, AIS — decoding digital radio protocols', icon: '💻', lessonCount: 3 },
];

export const LESSONS: Lesson[] = [
  // ── Module 1: Radio Fundamentals ──────────────────────────────────────
  {
    id: 'rf-1-1',
    module: 'Radio Fundamentals',
    moduleId: 1,
    lessonNumber: 1,
    title: 'What is Radio?',
    interactive: 'frequency-slider',
    content: `# What is Radio?

Radio is **electromagnetic radiation** — the same phenomenon as visible light, but at much lower frequencies. Radio waves travel at the speed of light (≈300,000 km/s) and can carry information over vast distances.

## The Electromagnetic Spectrum

\`\`\`
Frequency →  Low                                              High
             ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐
             │  ELF │  VLF │  HF  │  VHF │  UHF │  SHF │  EHF │
             │ 3 Hz │30kHz │ 3MHz │30MHz │300MHz│ 3GHz │30GHz │
             └──────┴──────┴──────┴──────┴──────┴──────┴──────┘

Wavelength → Very long                                    Very short
             (100km)                                       (1mm)
\`\`\`

## Wavelength & Frequency

The relationship is beautifully simple:

> **λ = c / f**

Where:
- **λ** (lambda) = wavelength in metres
- **c** = speed of light (299,792,458 m/s)
- **f** = frequency in Hz

**Example:** An FM radio station at 100 MHz has a wavelength of:
\`299,792,458 / 100,000,000 = 2.998 metres ≈ 3m\`

## Radio Bands in Practice

| Band | Frequency | Wavelength | What You'll Hear |
|------|-----------|------------|------------------|
| HF | 3–30 MHz | 100–10 m | Shortwave broadcasts, amateur radio, numbers stations |
| VHF | 30–300 MHz | 10–1 m | FM radio, air traffic, NOAA satellites, marine |
| UHF | 300 MHz–3 GHz | 1m–10cm | ADS-B (1090MHz), AIS, DMR, ISM devices |
| SHF | 3–30 GHz | 10–1 cm | Radar, satellite downlinks, WiFi |

## 🎛️ Try the Interactive Frequency Slider

Use the slider below to explore different frequencies and see what band you're in, what the wavelength is, and what signals you might find there.

## Key Takeaways

1. Radio waves are electromagnetic radiation at frequencies below visible light
2. Lower frequency = longer wavelength = better penetration through obstacles
3. Higher frequency = shorter wavelength = more bandwidth available
4. The relationship λ = c/f connects wavelength and frequency
`,
    quiz: [
      {
        question: 'What is the wavelength of a 145 MHz signal?',
        options: ['About 0.5 metres', 'About 2 metres', 'About 10 metres', 'About 20 metres'],
        correct: 1,
      },
      {
        question: 'Which band does 1090 MHz (ADS-B) fall in?',
        options: ['HF', 'VHF', 'UHF', 'SHF'],
        correct: 2,
      },
      {
        question: 'If you double the frequency, what happens to wavelength?',
        options: ['It doubles', 'It halves', 'It stays the same', 'It quadruples'],
        correct: 1,
      },
    ],
  },

  {
    id: 'rf-1-2',
    module: 'Radio Fundamentals',
    moduleId: 1,
    lessonNumber: 2,
    title: 'Modulation Types',
    interactive: 'modulation-toggle',
    content: `# Modulation Types

To send information via radio, we **modulate** a carrier wave. The carrier is a pure sine wave at a specific frequency. Modulation changes one of its properties to encode data.

## The Four Main Types

### AM — Amplitude Modulation

The **amplitude** (height) of the carrier wave changes with the audio signal.

\`\`\`
AM Waveform:
    ╱╲     ╱╲          ╱╲
   ╱  ╲   ╱  ╲        ╱  ╲
  ╱    ╲ ╱    ╲      ╱    ╲
 ╱      ╳      ╲    ╱      ╲
╱      ╱ ╲      ╲  ╱        ╲      ← envelope follows audio
       ╱   ╲      ╲╱          ╲
\`\`\`

- **Used for:** AM broadcast (540–1700 kHz), aviation voice (118–137 MHz)
- **Pros:** Simple to demodulate, works with cheap receivers
- **Cons:** Wastes power (carrier + both sidebands), susceptible to noise

### FM — Frequency Modulation

The **frequency** of the carrier shifts up and down with the audio.

\`\`\`
FM Waveform:
 ││││    │ │ │    ││││    │ │ │
 ││││    │ │ │    ││││    │ │ │
 ││││    │ │ │    ││││    │ │ │
 dense = high freq    sparse = low freq
   (audio positive)     (audio negative)
\`\`\`

- **Used for:** FM broadcast (88–108 MHz), NOAA APT satellites, walkie-talkies
- **Pros:** Resistant to amplitude noise, high audio quality
- **Cons:** Uses more bandwidth than AM

### SSB — Single Sideband

An efficient variant of AM that transmits **only one sideband** — either upper (USB) or lower (LSB).

\`\`\`
AM spectrum:        SSB spectrum (USB):
 ┌─┐  │  ┌─┐         │  ┌─┐
 │L│  │  │U│         │  │U│
 │S│  C  │S│         C  │S│
 │B│  │  │B│         │  │B│
 └─┘  │  └─┘         │  └─┘
  ←──────→            ←──→
  Wasteful!           Efficient
\`\`\`

- **Used for:** HF amateur radio, maritime HF, military
- **Pros:** Half the bandwidth of AM, no wasted carrier power
- **Cons:** Requires precise tuning, sounds "Donald Duck" if mistuned

### CW — Continuous Wave (Morse Code)

The simplest modulation: the carrier is switched **on and off** to form dots and dashes.

\`\`\`
CW Signal:
 ▄ ▄▄▄ ▄ ▄   ▄▄▄ ▄ ▄▄▄   ▄▄▄ ▄▄▄ ▄▄▄
  H (····)    K (−·−)      O (−−−)
\`\`\`

- **Used for:** Amateur radio CW, beacon identification
- **Pros:** Narrowest bandwidth (~100 Hz), readable at very low SNR
- **Cons:** Requires learning Morse code

## 🎛️ Interactive: Modulation Visualiser

Toggle between AM, FM, SSB, and CW to see how the waveform changes in real-time.

## Key Takeaways

1. **AM** modulates amplitude — simple but wasteful
2. **FM** modulates frequency — noise-resistant, broadcast quality
3. **SSB** is efficient AM — used on HF for long-distance voice
4. **CW** is on/off keying — narrowest bandwidth, extreme weak-signal performance
`,
    quiz: [
      {
        question: 'Which modulation type is most resistant to amplitude noise?',
        options: ['AM', 'FM', 'SSB', 'CW'],
        correct: 1,
      },
      {
        question: 'What modulation do NOAA weather satellites use for APT?',
        options: ['AM', 'FM', 'SSB', 'PSK'],
        correct: 1,
      },
      {
        question: 'SSB transmits only one _____ of an AM signal.',
        options: ['Carrier', 'Sideband', 'Harmonic', 'Phase'],
        correct: 1,
      },
    ],
  },

  {
    id: 'rf-1-3',
    module: 'Radio Fundamentals',
    moduleId: 1,
    lessonNumber: 3,
    title: 'Decibels & Signal Strength',
    content: `# Decibels & Signal Strength

The **decibel (dB)** is a logarithmic unit used everywhere in radio. It expresses ratios — making it easy to work with the enormous range of signal levels we encounter.

## Why Logarithmic?

Radio signals span an incredible range:
- A satellite signal might be **0.000000000001 watts** (10⁻¹² W)
- A broadcast transmitter might be **100,000 watts** (10⁵ W)
- That's a ratio of **10¹⁷** — or 170 dB!

## The dB Scale

> **dB = 10 × log₁₀(P₁/P₂)**

**Key values to memorise:**

| dB Change | Power Ratio | Meaning |
|-----------|-------------|---------|
| +3 dB | × 2 | Double the power |
| +6 dB | × 4 | Quadruple |
| +10 dB | × 10 | Ten times |
| +20 dB | × 100 | Hundred times |
| +30 dB | × 1000 | Thousand times |
| -3 dB | × 0.5 | Half the power |

## dBm — Absolute Power

**dBm** references 1 milliwatt:

> **dBm = 10 × log₁₀(P / 1mW)**

| dBm | Power | Example |
|-----|-------|---------|
| +30 dBm | 1 W | Handheld radio |
| 0 dBm | 1 mW | Reference level |
| -50 dBm | 10 nW | Strong WiFi |
| -80 dBm | 10 pW | Weak but usable signal |
| -110 dBm | 0.1 pW | Typical noise floor |
| -130 dBm | 0.1 fW | Satellite signal |

## Signal-to-Noise Ratio (SNR)

The most important metric in radio:

> **SNR = Signal Power (dBm) - Noise Floor (dBm)**

**Example:** Signal at -80 dBm, noise floor at -110 dBm:
\`SNR = -80 - (-110) = 30 dB\`

A 30 dB SNR means the signal is **1000 times stronger** than the noise — excellent for most modes.

### SNR Quality Guide

| SNR | Quality |
|-----|---------|
| < 3 dB | Unusable |
| 3–10 dB | CW/Morse barely copyable |
| 10–20 dB | Digital modes work, voice marginal |
| 20–30 dB | Good voice quality |
| > 30 dB | Excellent, broadcast quality |

## Noise Floor

The **noise floor** is the level of background noise in your receiver. It depends on:
- **Thermal noise** (kTB — physics, can't avoid it)
- **Man-made noise** (electronics, power lines, LED lights)
- **Antenna gain** (directional antennas reject noise from other directions)
- **Receiver quality** (cheap SDRs have higher noise figures)

\`\`\`
Spectrum Display:
  ──────── Strong signal (peak)
  ╱    ╲
 ╱      ╲
╱        ╲──── Weak signal
─ ─ ─ ─ ─ ─── Noise floor
▓▓▓▓▓▓▓▓▓▓▓▓▓ Noise (random)
\`\`\`

## Key Takeaways

1. dB is a ratio — +3 dB doubles power, +10 dB multiplies by 10
2. dBm is absolute power referenced to 1 milliwatt
3. SNR = signal - noise (in dB), determines if you can decode a signal
4. Lower noise floor = better reception (keep noise sources away!)
`,
    quiz: [
      {
        question: 'If a signal is -80 dBm and noise floor is -110 dBm, what is the SNR?',
        options: ['20 dB', '30 dB', '80 dB', '190 dB'],
        correct: 1,
      },
      {
        question: 'What does a +10 dB increase represent?',
        options: ['2× power', '5× power', '10× power', '100× power'],
        correct: 2,
      },
      {
        question: 'What is 0 dBm equivalent to?',
        options: ['0 watts', '1 watt', '1 milliwatt', '1 microwatt'],
        correct: 2,
      },
    ],
  },

  // ── Module 2: SDR Basics ──────────────────────────────────────────────
  {
    id: 'sdr-2-1',
    module: 'SDR Basics',
    moduleId: 2,
    lessonNumber: 1,
    title: 'What is SDR?',
    content: `# What is Software-Defined Radio?

Traditional radios use **hardware** circuits for tuning, filtering, and demodulation. An SDR moves all of that into **software**, using a general-purpose computer to process radio signals digitally.

## The Core Concept

\`\`\`
Traditional Radio:
  Antenna → Filter → Mixer → IF Filter → Demodulator → Speaker
  [  ALL HARDWARE — fixed function  ]

Software-Defined Radio:
  Antenna → ADC → Computer (software does everything)
  [ HW ]   [        SOFTWARE         ]
\`\`\`

## The ADC — Analogue to Digital Converter

The heart of any SDR is the **ADC** (Analogue-to-Digital Converter). It samples the radio signal millions of times per second, converting continuous radio waves into discrete numbers.

**RTL-SDR specifications:**
- 8-bit ADC (256 levels of resolution)
- Up to 2.4 MSPS (million samples per second)
- Frequency range: 24 MHz – 1766 MHz

## Sampling & the Nyquist Theorem

> **You must sample at ≥ 2× the highest frequency component**

If you want to capture a signal with 1 MHz bandwidth, you need ≥ 2 MSPS sample rate. This is the **Nyquist rate**.

**Aliasing** occurs when you sample too slowly — signals fold back and appear at wrong frequencies.

## IQ Data — The Secret Sauce

SDRs produce **IQ (In-phase / Quadrature)** data — two streams of samples, 90° apart:

\`\`\`
        Q (Quadrature)
        │
        │    · signal
        │   ╱
        │  ╱ amplitude
        │ ╱
────────┼────────── I (In-phase)
        │
        │
\`\`\`

- **I** = the "real" component (cosine)
- **Q** = the "imaginary" component (sine)
- Together they capture **both amplitude AND phase**
- This is why SDR can demodulate any modulation type in software

## Why SDR is Revolutionary

| Feature | Traditional Radio | SDR |
|---------|-------------------|-----|
| Modes | Fixed (e.g., FM only) | Any mode via software |
| Bandwidth | Narrow | Wide (see entire band at once) |
| Cost | £100s per mode | £25 for everything |
| Upgradeable | Buy new hardware | Update software |
| Recording | Audio only | Record raw RF, re-demodulate later |

## Key Takeaways

1. SDR replaces hardware radio circuits with software processing
2. The ADC converts analogue radio waves to digital samples
3. Nyquist theorem: sample rate must be ≥ 2× signal bandwidth
4. IQ data captures full amplitude and phase information
`,
    quiz: [
      {
        question: 'What does ADC stand for?',
        options: ['Automatic Decoder Circuit', 'Analogue-to-Digital Converter', 'Advanced Data Channel', 'Amplitude Detection Controller'],
        correct: 1,
      },
      {
        question: 'To capture a 2 MHz wide signal, what minimum sample rate do you need?',
        options: ['1 MSPS', '2 MSPS', '4 MSPS', '8 MSPS'],
        correct: 2,
      },
      {
        question: 'What do the I and Q in IQ data represent?',
        options: ['Input and Quality', 'In-phase and Quadrature', 'Integer and Quantised', 'Interpolated and Queued'],
        correct: 1,
      },
    ],
  },

  {
    id: 'sdr-2-2',
    module: 'SDR Basics',
    moduleId: 2,
    lessonNumber: 2,
    title: 'Your First Reception',
    interactive: 'first-reception-guide',
    content: `# Your First Reception

Let's receive an FM broadcast station — the classic SDR "hello world."

## What You Need

- **RTL-SDR dongle** (RTL2832U + R820T2 chipset, ~£25)
- **Antenna** — the included telescopic whip works fine for FM
- **SignalForge** running on your computer

## Step 1: Connect Your SDR

1. Plug the RTL-SDR into a USB port
2. Attach the antenna to the SMA connector
3. Extend the antenna to roughly 75cm (quarter wavelength for FM)

In SignalForge, check the **SDR Status** indicator in the top bar — it should show your device.

## Step 2: Create a Flow

Open the **Flow Editor** (press \`2\`) and build this chain:

\`\`\`
┌─────────────┐    ┌──────────┐    ┌───────────┐
│  SDR Source  │───→│ FM Demod │───→│ Audio Out │
│  98.0 MHz   │    │  WFM     │    │  Speakers │
│  2.048 MSPS │    │  200kHz  │    │           │
└─────────────┘    └──────────┘    └───────────┘
\`\`\`

**Settings:**
- SDR Source: Frequency = your local FM station (e.g., 98.0 MHz)
- Sample rate: 2.048 MHz
- FM Demod: Wide FM (WFM), 200 kHz bandwidth
- Audio Out: default speakers

## Step 3: Tune to a Station

UK FM stations to try:
- **88.1–90.2 MHz** — BBC Radio 2
- **97.6–99.8 MHz** — BBC Radio 1
- **100.0–102.0 MHz** — Classic FM

Don't know the exact frequency? Open the **Waterfall** view — FM stations appear as bright, wide bands.

## Step 4: Hit Start!

Click **▶ Start** on the flowgraph. You should hear audio within a second.

**Troubleshooting:**
- No audio? Check your volume and audio output device
- Distorted? Reduce the RF gain (try 30–40 dB)
- Weak signal? Reposition the antenna near a window

## Step 5: Explore

Now that you're receiving:
- Open the **Waterfall** to see the signal visually
- Try different stations by changing the frequency
- Notice stereo FM stations have a wider bandwidth
- Look for RDS data (station name) in the decoder output

## What's Happening Under the Hood

\`\`\`
Radio waves → Antenna → RTL-SDR ADC → USB → Computer
→ IQ samples → Digital mixer (tune) → Low-pass filter
→ FM discriminator → Audio samples → Speakers 🔊
\`\`\`

All the filtering, mixing, and demodulation happens in software!

## 🎉 Congratulations!

You've received your first radio signal with SDR. From here, the entire radio spectrum is open to you.
`,
    quiz: [
      {
        question: 'What sample rate is recommended for FM broadcast reception?',
        options: ['256 kSPS', '1.024 MSPS', '2.048 MSPS', '10 MSPS'],
        correct: 2,
      },
      {
        question: 'What bandwidth does a wide FM broadcast signal occupy?',
        options: ['25 kHz', '50 kHz', '100 kHz', '200 kHz'],
        correct: 3,
      },
    ],
  },

  {
    id: 'sdr-2-3',
    module: 'SDR Basics',
    moduleId: 2,
    lessonNumber: 3,
    title: 'Understanding the Waterfall',
    interactive: 'waterfall-tutorial',
    content: `# Understanding the Waterfall Display

The **waterfall** (or spectrogram) is your most powerful tool for finding and identifying signals. Learning to read it is an essential SDR skill.

## How It Works

\`\`\`
Frequency →
     88MHz   92MHz   96MHz   100MHz  104MHz  108MHz
  ┌─────────────────────────────────────────────────┐
  │   ▓▓      ▓▓▓     ▓      ▓▓▓▓     ▓▓          │ ← now
  │   ▓▓      ▓▓▓     ▓      ▓▓▓▓     ▓▓          │
  │   ▓▓      ▓▓▓            ▓▓▓▓     ▓▓          │ ← 1s ago
Time │   ▓▓      ▓▓▓            ▓▓▓▓                 │
  ↓  │   ▓▓      ▓▓▓            ▓▓▓▓                 │ ← 2s ago
  │   ▓▓      ▓▓▓            ▓▓▓▓                 │
  └─────────────────────────────────────────────────┘
       FM stations (always on)    ↑ intermittent signal
\`\`\`

- **Horizontal axis** = frequency
- **Vertical axis** = time (most recent at top, scrolling down)
- **Colour/brightness** = signal strength (brighter = stronger)

## Signal Identification by Shape

### Continuous Carriers
\`\`\`
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← thin vertical line
\`\`\`
A thin, steady line = unmodulated carrier or CW beacon

### FM Broadcast
\`\`\`
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← ~200 kHz wide, constant
    ██████████
\`\`\`
Wide, constant band with varying intensity inside (the audio content)

### Voice (Narrowband FM / SSB)
\`\`\`
  ▓▓▓▓             ← appears when someone talks
        ▓▓▓▓       ← disappears during pauses
  ▓▓▓▓▓▓▓
\`\`\`
Intermittent, ~12.5–25 kHz wide, appears and disappears

### Digital Signals
\`\`\`
▓░▓░▓░▓░▓░▓░▓░▓░  ← regular pattern, fixed bandwidth
▓░▓░▓░▓░▓░▓░▓░▓░
\`\`\`
Uniform, regular pattern with sharp bandwidth edges

### Pulsed / Radar
\`\`\`
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← very wide, brief pulse
                              (gap)
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← repeats periodically
\`\`\`
Brief, wideband bursts at regular intervals

### Frequency Hopping
\`\`\`
  ▓▓                       ← hops around
         ▓▓
▓▓
              ▓▓
\`\`\`
Signal jumps between frequencies — military or spread-spectrum

## Colour Scales

| Colour | Meaning |
|--------|---------|
| Black/dark blue | Noise floor (no signal) |
| Green/yellow | Moderate signal |
| Red/white | Strong signal |

## Practical Tips

1. **Zoom in** on interesting signals — bandwidth reveals the modulation type
2. **Time patterns** tell you if a signal is continuous, periodic, or event-driven
3. **Symmetric sidebands** around a carrier = AM modulation
4. **Sharp rectangular edges** = digital signal
5. **Drift** over time suggests an unstable oscillator (cheap transmitter)

## Key Takeaways

1. The waterfall shows frequency (x), time (y), and power (colour)
2. Signal bandwidth and shape reveal the modulation type
3. Time patterns help distinguish beacons from voice from data
4. Practice makes perfect — spend time just watching the waterfall
`,
    quiz: [
      {
        question: 'On a waterfall display, what does the horizontal axis represent?',
        options: ['Time', 'Frequency', 'Signal strength', 'Phase'],
        correct: 1,
      },
      {
        question: 'How can you distinguish a digital signal from voice on a waterfall?',
        options: [
          'Digital signals are always stronger',
          'Digital signals have sharp bandwidth edges and uniform patterns',
          'Voice signals are wider',
          'Digital signals only appear at night'
        ],
        correct: 1,
      },
      {
        question: 'A thin, constant vertical line on the waterfall is most likely:',
        options: ['An FM broadcast', 'A digital data signal', 'An unmodulated carrier or CW beacon', 'Interference'],
        correct: 2,
      },
    ],
  },

  // ── Module 3: Satellite Tracking ──────────────────────────────────────
  {
    id: 'sat-3-1',
    module: 'Satellite Tracking',
    moduleId: 3,
    lessonNumber: 1,
    title: 'Orbital Mechanics Basics',
    content: `# Orbital Mechanics Basics

To track satellites, you need to understand how they move. Fortunately, orbital mechanics follows elegant mathematical laws.

## Kepler's Laws

1. **Orbits are ellipses** with Earth at one focus
2. **Equal areas in equal times** — satellites move faster when closer to Earth
3. **Period² ∝ semi-major axis³** — higher orbit = longer period

## Key Orbital Parameters (Keplerian Elements)

| Element | Symbol | Meaning |
|---------|--------|---------|
| Semi-major axis | a | Size of the orbit |
| Eccentricity | e | Shape (0 = circle, 0.99 = very elliptical) |
| Inclination | i | Tilt relative to equator |
| RAAN | Ω | Where the orbit crosses the equator (ascending) |
| Argument of perigee | ω | Orientation of the ellipse |
| Mean anomaly | M | Where the satellite is in its orbit |
| Epoch | t₀ | When these elements were measured |

## TLE — Two-Line Element Sets

Satellite positions are distributed as **TLEs** — a standardised two-line text format:

\`\`\`
ISS (ZARYA)
1 25544U 98067A   24056.50000000  .00016717  00000-0  10270-3 0  9993
2 25544  51.6420 208.7350 0006320 300.5430  59.5250 15.49610940450001
\`\`\`

Line 1 contains: catalogue number, classification, launch info, epoch, drag terms
Line 2 contains: inclination, RAAN, eccentricity, arg of perigee, mean anomaly, mean motion

## SGP4 — The Prediction Algorithm

**SGP4** (Simplified General Perturbations 4) is the standard algorithm for satellite prediction. It takes a TLE and computes the satellite's position at any time, accounting for:

- Earth's oblate shape (J2 perturbation)
- Atmospheric drag (for LEO satellites)
- Solar/lunar gravitational effects

**Accuracy:** ~1 km for recent TLEs, degrades over days/weeks as the TLE ages.

## Common Orbit Types

| Orbit | Altitude | Period | Example |
|-------|----------|--------|---------|
| LEO | 200–2000 km | 90–130 min | ISS, NOAA, Starlink |
| MEO | 2000–35786 km | 2–24 hrs | GPS, Galileo |
| GEO | 35,786 km | 24 hrs | GOES weather, TV satellites |
| HEO | Varies | Varies | Molniya (comms over Russia) |
| SSO | ~600–800 km | ~96 min | Earth observation, NOAA |

## Key Takeaways

1. Satellite orbits are described by 6 Keplerian elements
2. TLEs are the standard distribution format for orbital data
3. SGP4 predicts satellite positions from TLEs
4. TLE accuracy degrades — always use the freshest data available
`,
    quiz: [
      {
        question: 'What algorithm is used to predict satellite positions from TLEs?',
        options: ['FFT', 'SGP4', 'Kalman filter', 'Newton-Raphson'],
        correct: 1,
      },
      {
        question: 'The ISS orbits at roughly what altitude?',
        options: ['35,786 km', '20,200 km', '400 km', '800 km'],
        correct: 2,
      },
      {
        question: 'What does a TLE eccentricity of 0 indicate?',
        options: ['A circular orbit', 'A highly elliptical orbit', 'A decaying orbit', 'A retrograde orbit'],
        correct: 0,
      },
    ],
  },

  {
    id: 'sat-3-2',
    module: 'Satellite Tracking',
    moduleId: 3,
    lessonNumber: 2,
    title: 'Tracking a Satellite Pass',
    interactive: 'satellite-pass-tracker',
    content: `# Tracking a Satellite Pass

Now that you understand orbits, let's track a real satellite pass using SignalForge.

## The Pass Geometry

\`\`\`
                    · · Max elevation · ·
                 ·                         ·
              ·          ← PASS ARC →         ·
           ·                                     ·
        ·                                           ·
  AOS (rise)        Your location ⊕           LOS (set)
  ──────────────────────────────────────────────────────
       Horizon                                  Horizon
\`\`\`

**Key terms:**
- **AOS** (Acquisition of Signal) — satellite rises above horizon
- **LOS** (Loss of Signal) — satellite sets below horizon
- **Max elevation** — highest point in the pass (higher = better signal)
- **Pass duration** — typically 5–15 minutes for LEO satellites

## Step-by-Step: Track an ISS Pass

### 1. Open the Satellite Tracker

In SignalForge, press \`7\` for the **Observation Scheduler**, or find satellites in the **Map View**.

### 2. Check Upcoming Passes

The tracker shows upcoming passes for all tracked satellites. Look for:
- **ISS** (NORAD 25544) — brightest, easiest to track
- **NOAA 15/18/19** — weather satellites with receivable signals
- Passes with **max elevation > 20°** (higher is better)

### 3. Set Up for Reception

For NOAA weather satellites:
- Frequency: 137.100 / 137.620 / 137.9125 MHz
- Mode: FM, 34 kHz bandwidth
- Antenna: V-dipole or QFH recommended, whip works for high passes

### 4. Track the Pass

When the satellite rises above your horizon:
1. Signal appears — likely weak at first
2. Signal strengthens as elevation increases
3. You may notice **Doppler shift** (frequency changes — next lesson!)
4. Signal peaks at max elevation
5. Signal weakens and disappears at LOS

### 5. Review Your Observation

After the pass, check:
- Signal recording in the logbook
- Decoded data (APT image for NOAA)
- Pass statistics (max signal strength, duration)

## Pass Planning Tips

- **Morning/evening** passes often have the best geometry
- **Polar-orbiting** satellites give multiple passes per day from any location
- **Geostationary** satellites are always visible but require dish antennas
- Stack passes — sometimes two satellites pass within minutes of each other

## Key Takeaways

1. Satellite passes follow a predictable arc from horizon to horizon
2. Higher elevation passes give stronger signals and longer duration
3. Use SignalForge's scheduler to plan observations in advance
4. Start with NOAA or ISS — they're the easiest to receive
`,
    quiz: [
      {
        question: 'What does AOS stand for?',
        options: ['Automatic Operating System', 'Acquisition of Signal', 'Angle of Separation', 'Azimuth of Satellite'],
        correct: 1,
      },
      {
        question: 'Why are higher elevation passes preferred?',
        options: [
          'The satellite is moving faster',
          'Less atmosphere to pass through, stronger signal, longer visible',
          'The Doppler shift is less',
          'The satellite transmits at higher power'
        ],
        correct: 1,
      },
    ],
  },

  {
    id: 'sat-3-3',
    module: 'Satellite Tracking',
    moduleId: 3,
    lessonNumber: 3,
    title: 'Doppler Correction',
    interactive: 'doppler-simulator',
    content: `# Doppler Correction

You've probably heard the Doppler effect with ambulance sirens — the pitch rises as it approaches and falls as it recedes. The exact same thing happens with satellite radio signals.

## The Doppler Effect

A satellite in LEO moves at ~7.5 km/s. This causes the received frequency to shift:

\`\`\`
Satellite approaching →  Frequency HIGHER than nominal
                         (signal compressed)

Satellite overhead →     Frequency equals nominal
                         (no relative motion)

Satellite receding →     Frequency LOWER than nominal
                         (signal stretched)
\`\`\`

## The Doppler Formula

> **Δf = f₀ × (v_radial / c)**

Where:
- **f₀** = transmitted frequency
- **v_radial** = radial velocity (component toward/away from you)
- **c** = speed of light

## Real-World Example: NOAA at 137.1 MHz

A NOAA satellite at ~850 km altitude, max radial velocity ~6.5 km/s:

\`\`\`
Δf = 137,100,000 × (6,500 / 299,792,458) = ±2,972 Hz ≈ ±3 kHz
\`\`\`

So during a pass, the frequency sweeps from approximately:
- **137.103 MHz** (approaching) → **137.100 MHz** (overhead) → **137.097 MHz** (receding)

That's a **6 kHz total shift** over a 10-minute pass!

## Doppler Curve Shape

\`\`\`
Freq
  ↑    ╱‾‾‾‾‾‾‾‾‾‾‾╲
  │   ╱               ╲
  │  ╱                 ╲
  │─╱─ ─ ─ ─ ─ ─ ─ ─ ─╲── nominal freq
  │╱                     ╲
  ╱                       ╲
  └──────────────────────────→ Time
  AOS     Max El.      LOS

  Steepest change at closest approach!
\`\`\`

## Why It Matters

- **Narrowband signals** (CW, digital) become undecodable without correction
- **APT images** get distorted if Doppler isn't compensated
- **Satellite transponders** require pre-correcting your uplink frequency

## Doppler Correction in SignalForge

SignalForge's satellite tracker automatically:
1. Calculates the Doppler shift for each moment of a pass
2. Adjusts the SDR's tuning frequency in real-time
3. Keeps the signal centred in your receiver

For manual correction:
- Enable **"Doppler Track"** in the SDR Source settings
- Select the satellite from the tracker
- The frequency will auto-adjust during the pass

## Key Takeaways

1. Doppler shift is caused by relative motion between satellite and ground station
2. LEO satellites experience ±3–5 kHz shift on VHF frequencies
3. The shift is steepest at closest approach (maximum elevation)
4. SignalForge corrects Doppler automatically when tracking a satellite
`,
    quiz: [
      {
        question: 'During a satellite pass, when is the Doppler shift zero?',
        options: ['At AOS', 'At maximum elevation (closest approach)', 'At LOS', 'It is never zero'],
        correct: 1,
      },
      {
        question: 'A NOAA satellite at 137 MHz experiences roughly what total Doppler shift?',
        options: ['±100 Hz', '±3 kHz', '±30 kHz', '±300 kHz'],
        correct: 1,
      },
      {
        question: 'Why does Doppler correction matter more for narrowband signals?',
        options: [
          'Narrowband signals are weaker',
          'The shift can move the signal outside the receiver passband',
          'Narrowband signals travel slower',
          'It doesn\'t — all signals are equally affected'
        ],
        correct: 1,
      },
    ],
  },

  // ── Module 4: Digital Modes ───────────────────────────────────────────
  {
    id: 'dig-4-1',
    module: 'Digital Modes',
    moduleId: 4,
    lessonNumber: 1,
    title: 'ADS-B Aircraft Tracking',
    content: `# ADS-B Aircraft Tracking

**ADS-B** (Automatic Dependent Surveillance–Broadcast) is the system aircraft use to broadcast their position, altitude, speed, and identity. With a £25 RTL-SDR, you can track every aircraft within 200+ miles.

## How ADS-B Works

\`\`\`
Aircraft                              Your SDR
┌──────────┐     1090 MHz          ┌──────────────┐
│ GPS      │──→ Transponder ──→))) │ RTL-SDR      │
│ Position │     broadcasts        │ → Decoder    │
│ Altitude │     every second      │ → Map display│
│ Callsign │                       └──────────────┘
└──────────┘
\`\`\`

- **Frequency:** 1090 MHz
- **Modulation:** Pulse Position Modulation (PPM)
- **Message length:** 56 or 112 bits
- **Data rate:** 1 Mbit/s
- **Range:** 200–400 km with good antenna/line of sight

## Mode S Message Types

| Downlink Format | Content |
|----------------|---------|
| DF17 (ADS-B) | Position, velocity, callsign, squawk |
| DF4/5 | Altitude, identity (interrogated) |
| DF11 | All-call reply (ICAO address) |
| DF20/21 | Extended data (BDS registers) |

## What Each Aircraft Broadcasts

- **ICAO address** — unique 24-bit identifier (e.g., 406A3B)
- **Callsign** — flight number (e.g., BAW256, RYR1234)
- **Position** — latitude/longitude via CPR encoding
- **Altitude** — barometric or GNSS altitude in feet
- **Velocity** — ground speed and heading
- **Squawk** — transponder code (7700 = emergency!)
- **Category** — aircraft type (light, heavy, rotorcraft, etc.)

## Special Squawk Codes

| Code | Meaning |
|------|---------|
| 7700 | **EMERGENCY** (mayday) |
| 7600 | Radio failure |
| 7500 | Hijack |
| 7000 | Conspicuity (UK default) |

## Setting Up ADS-B in SignalForge

1. **Hardware:** RTL-SDR + antenna (quarter-wave ground plane ideal at 6.9 cm)
2. **Flow Editor:** SDR Source (1090 MHz, 2 MSPS) → ADS-B Decoder
3. **Map View:** Aircraft appear automatically with position updates
4. **Tip:** Mount antenna as high as possible — every metre counts!

## Feeding Services

You can contribute your data to:
- **FlightRadar24** — fr24feed
- **FlightAware** — piaware
- **ADS-B Exchange** — community-run, no filtering
- **OpenSky Network** — academic research

## Key Takeaways

1. ADS-B operates on 1090 MHz with no encryption
2. Each aircraft has a unique ICAO address and broadcasts position every second
3. A simple RTL-SDR with decent antenna can see aircraft 200+ miles away
4. Watch for special squawk codes — 7700 means someone is having a very bad day
`,
    quiz: [
      {
        question: 'What frequency does ADS-B operate on?',
        options: ['137.1 MHz', '156.8 MHz', '1090 MHz', '1575.42 MHz'],
        correct: 2,
      },
      {
        question: 'What does squawk code 7700 indicate?',
        options: ['Normal flight', 'Radio failure', 'Emergency', 'VFR flight'],
        correct: 2,
      },
      {
        question: 'What is the ideal antenna element length for 1090 MHz?',
        options: ['2 metres', '75 cm', '6.9 cm', '1.2 cm'],
        correct: 2,
      },
    ],
  },

  {
    id: 'dig-4-2',
    module: 'Digital Modes',
    moduleId: 4,
    lessonNumber: 2,
    title: 'APRS for Beginners',
    content: `# APRS for Beginners

**APRS** (Automatic Packet Reporting System) is a real-time tactical communication system using amateur radio. Think of it as "Twitter for ham radio" — short position reports and messages broadcast on a shared frequency.

## How APRS Works

\`\`\`
Mobile station        Digipeater          APRS-IS (Internet)
┌──────────┐         ┌──────────┐        ┌──────────────┐
│ GPS + TNC│──144.8→ │ Hilltop  │──→ iGate │ aprs.fi    │
│          │  MHz    │ repeater │        │ Web map     │
└──────────┘         └──────────┘        └──────────────┘
\`\`\`

- **Frequency:** 144.800 MHz (Europe), 144.390 MHz (North America)
- **Modulation:** AFSK (Audio Frequency Shift Keying) at 1200 baud
- **Protocol:** AX.25 packet radio
- **Encoding:** Bell 202 modem tones (1200/2200 Hz)

## APRS Packet Structure

\`\`\`
M0ABC>APRS,WIDE1-1,WIDE2-1:!5130.00N/00030.00W-PHG2360/My APRS station
│      │    │              │ │                      │
│      │    │              │ Position (lat/lon)     Comment
│      │    Digi path      │
│      Destination         Symbol (house, car, etc.)
Source callsign
\`\`\`

## Key Components

### Digipeaters
Radio relay stations on hilltops that rebroadcast APRS packets, extending range.

**WIDE1-1, WIDE2-1** is the standard path:
- WIDE1-1 → any fill-in digi within range
- WIDE2-1 → any wide-coverage digi

### iGates
Stations that bridge RF APRS to the internet (APRS-IS), making packets visible on aprs.fi.

### TNCs (Terminal Node Controllers)
Modems that convert digital data ↔ audio tones for transmission. Modern implementations use software TNCs (like Direwolf).

## What APRS Carries

| Data Type | Symbol | Example |
|-----------|--------|---------|
| Position | 📍 | Lat/lon from GPS |
| Weather | 🌤️ | Temperature, wind, rain, pressure |
| Messages | 💬 | Short text messages between stations |
| Telemetry | 📊 | Voltage, current, sensor readings |
| Objects | 📌 | Events, NOTAMS, hazards |
| Status | 📝 | Free-text status message |

## Receiving APRS with SignalForge

1. **Tune to 144.800 MHz** (or 144.390 in NA)
2. **Narrow FM** demod, 12.5 kHz bandwidth
3. Connect to the **APRS Decoder** block
4. Packets appear on the map with callsigns and paths

You don't need a ham licence to **receive** APRS — only to transmit.

## Key Takeaways

1. APRS operates on 144.800 MHz (EU) using 1200 baud AX.25 packets
2. Digipeaters relay packets over wide areas; iGates bridge to the internet
3. APRS carries position, weather, messages, and telemetry
4. SignalForge can decode APRS with just an RTL-SDR and antenna
`,
    quiz: [
      {
        question: 'What frequency is APRS on in Europe?',
        options: ['137.100 MHz', '144.800 MHz', '156.800 MHz', '433.920 MHz'],
        correct: 1,
      },
      {
        question: 'What is a digipeater?',
        options: [
          'A digital computer',
          'A radio relay station that rebroadcasts packets',
          'A type of antenna',
          'An internet gateway'
        ],
        correct: 1,
      },
      {
        question: 'What baud rate does standard APRS use?',
        options: ['300 baud', '1200 baud', '9600 baud', '115200 baud'],
        correct: 1,
      },
    ],
  },

  {
    id: 'dig-4-3',
    module: 'Digital Modes',
    moduleId: 4,
    lessonNumber: 3,
    title: 'AIS Maritime Tracking',
    content: `# AIS Maritime Tracking

**AIS** (Automatic Identification System) is the maritime equivalent of ADS-B. Every large vessel broadcasts its identity, position, course, and speed on VHF marine frequencies.

## How AIS Works

\`\`\`
Ship                                Your SDR
┌──────────────┐   VHF           ┌──────────────┐
│ AIS          │                 │ RTL-SDR      │
│ Transponder  │──→ 161.975 MHz  │ → AIS Decoder│
│ (Class A/B)  │──→ 162.025 MHz  │ → Map display│
│ + GPS        │                 └──────────────┘
└──────────────┘
\`\`\`

- **Frequencies:** 161.975 MHz (Ch 87B) and 162.025 MHz (Ch 88B)
- **Modulation:** GMSK (Gaussian Minimum Shift Keying)
- **Data rate:** 9600 bits/s
- **Protocol:** HDLC framing, NRZI encoding
- **TDMA:** Self-organising time slots (2250 slots per minute per channel)

## AIS Classes

| Class | Who | Update Rate | Range |
|-------|-----|-------------|-------|
| **Class A** | SOLAS vessels (>300 GT) | 2–10 seconds | ~40 nm |
| **Class B** | Pleasure craft, small commercial | 30 seconds–3 min | ~15 nm |
| **AtoN** | Buoys, lighthouses | 3 minutes | Varies |
| **SAR** | Search and rescue aircraft | As needed | Wide |

## What AIS Broadcasts

### Static Data (every 6 minutes)
- **MMSI** — 9-digit Maritime Mobile Service Identity (unique per vessel)
- **Vessel name and callsign**
- **Ship type** (cargo, tanker, passenger, fishing, etc.)
- **Dimensions** (length, beam, antenna position)

### Dynamic Data (every 2-10 seconds for Class A)
- **Position** (latitude/longitude)
- **Speed Over Ground (SOG)**
- **Course Over Ground (COG)**
- **Heading** (compass heading)
- **Rate of Turn (ROT)**
- **Navigation status** (underway, anchored, moored, etc.)

### Voyage Data (every 6 minutes)
- **Destination**
- **ETA**
- **Draught**
- **Cargo type**

## MMSI Number Structure

| Prefix | Meaning |
|--------|---------|
| 2XXXXX | UK vessels |
| 3XXXXX | US vessels |
| 00XXXXX | Coast stations |
| 111XXXXX | SAR aircraft |
| 97XXXXX | AIS AtoN (buoys/lights) |

## Setting Up AIS in SignalForge

SignalForge's AIS decoder monitors **both channels simultaneously**:

1. **SDR Source** → 162.000 MHz centre, 50 kHz bandwidth
2. **AIS Decoder** block (handles both channels)
3. Vessels appear on the **Map View** with real-time tracking

**Tip:** Coastal locations receive hundreds of vessels. Even 30 miles inland with a good antenna on a mast, you'll see plenty of maritime traffic.

## Key Takeaways

1. AIS operates on two VHF channels: 161.975 and 162.025 MHz
2. Every large vessel broadcasts position, speed, identity via AIS
3. MMSI is the unique identifier — like ICAO for ships
4. An RTL-SDR near the coast can track vessels across a wide area
`,
    quiz: [
      {
        question: 'What are the two AIS frequencies?',
        options: [
          '156.800 and 156.825 MHz',
          '161.975 and 162.025 MHz',
          '137.100 and 137.912 MHz',
          '144.800 and 145.000 MHz'
        ],
        correct: 1,
      },
      {
        question: 'What is an MMSI?',
        options: [
          'A type of modulation',
          'A 9-digit unique maritime vessel identifier',
          'A maritime safety protocol',
          'A satellite tracking number'
        ],
        correct: 1,
      },
      {
        question: 'How often does a Class A AIS transponder update position?',
        options: ['Every 30 seconds', 'Every 2-10 seconds', 'Every 3 minutes', 'Every 6 minutes'],
        correct: 1,
      },
    ],
  },
];

export function getModules(): AcademyModule[] {
  return MODULES;
}

export function getLessons(): Lesson[] {
  return LESSONS;
}

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find(l => l.id === id);
}

export function getLessonsByModule(moduleId: number): Lesson[] {
  return LESSONS.filter(l => l.moduleId === moduleId);
}
