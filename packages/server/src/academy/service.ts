import EventEmitter from 'events';
import type { Tutorial, QuizQuestion, AcademyProgress, TutorialDifficulty } from '@signalforge/shared';

export class AcademyService extends EventEmitter {
  private tutorials: Tutorial[] = [];
  private quizQuestions: QuizQuestion[] = [];
  private progress: AcademyProgress = { completedTutorials: [], quizScores: {}, totalPoints: 0, rank: 'Novice Listener' };

  constructor() {
    super();
    this.loadContent();
  }

  private loadContent() {
    this.tutorials = [
      {
        id: 'tut-fm-reception', title: 'Your First FM Reception', description: 'Learn to receive and demodulate a local FM broadcast station — the classic first SDR experience.', difficulty: 'beginner', category: 'Basics', estimatedMinutes: 10, iconEmoji: '📻', prerequisites: [],
        steps: [
          { id: 's1', title: 'Connect Your SDR', content: '## Getting Started\n\nPlug in your RTL-SDR dongle and ensure an antenna is connected. A basic telescopic whip antenna works fine for FM broadcast.\n\n**Tip:** The supplied magnetic base antenna is perfect for this tutorial.' },
          { id: 's2', title: 'Create a Flow', content: '## Build Your First Flowgraph\n\n1. Navigate to the **Flow Editor** (press `2`)\n2. Drag an **SDR Source** from the palette\n3. Drag an **FM Demod** block\n4. Drag an **Audio Out** block\n5. Connect them: SDR Source → FM Demod → Audio Out', highlightElement: '.flow-editor' },
          { id: 's3', title: 'Tune to FM', content: '## Find a Station\n\nSet the SDR Source frequency to a known local FM station. In the UK, try:\n- **88.1 - 90.2 MHz** — BBC Radio 2\n- **97.6 - 99.8 MHz** — BBC Radio 1\n- **100.0 - 102.0 MHz** — Classic FM\n\nSet bandwidth to **200 kHz** and sample rate to **2.048 MHz**.' },
          { id: 's4', title: 'Listen!', content: '## You\'re Receiving!\n\nClick **Start** on the flowgraph. You should hear the FM station through your speakers.\n\n**Experiment:**\n- Open the **Waterfall** view to see the signal visually\n- Try tuning to different stations\n- Notice how signal strength changes with antenna position\n\n🎉 Congratulations — you\'ve completed your first SDR reception!' },
        ],
      },
      {
        id: 'tut-adsb', title: 'Tracking Aircraft with ADS-B', description: 'Set up a complete ADS-B receiver to track aircraft in real-time on the map.', difficulty: 'beginner', category: 'Aviation', estimatedMinutes: 15, iconEmoji: '✈️', prerequisites: ['tut-fm-reception'],
        steps: [
          { id: 's1', title: 'About ADS-B', content: '## What is ADS-B?\n\nAutomatic Dependent Surveillance–Broadcast (ADS-B) is a system where aircraft broadcast their GPS position, altitude, speed, and callsign on **1090 MHz**.\n\nWith a simple RTL-SDR, you can receive these signals and plot aircraft on a map — the same data used by FlightRadar24!' },
          { id: 's2', title: 'Antenna Setup', content: '## Optimal Antenna\n\nADS-B works best with a vertical antenna tuned for 1090 MHz:\n- A quarter-wave ground plane (6.9cm elements)\n- Or the stock whip antenna (less optimal but works)\n\n**Placement matters:** Higher is better. A window-mounted antenna can easily pick up aircraft 100+ miles away.' },
          { id: 's3', title: 'Configure the Decoder', content: '## Set Up ADS-B Decoding\n\n1. Go to **Flow Editor**\n2. Add **SDR Source** → set to **1090 MHz**, **2 MHz bandwidth**\n3. Add **ADS-B Decoder** block and connect it\n4. Start the flowgraph\n5. Switch to **Map View** (press `4`)\n\nAircraft should start appearing within seconds!' },
          { id: 's4', title: 'Explore the Data', content: '## Understanding ADS-B Data\n\nEach aircraft shows:\n- **Callsign** — the flight identifier (e.g., BAW256)\n- **Altitude** — in feet\n- **Speed** — ground speed in knots\n- **Heading** — direction of travel\n- **Squawk** — transponder code (7700 = emergency!)\n\nClick an aircraft on the map to see full details and track history.' },
        ],
      },
      {
        id: 'tut-weather-sat', title: 'Decoding Weather Satellites', description: 'Receive and decode live weather satellite images from NOAA satellites using APT.', difficulty: 'intermediate', category: 'Satellite', estimatedMinutes: 25, iconEmoji: '🌦️', prerequisites: ['tut-fm-reception'],
        steps: [
          { id: 's1', title: 'NOAA Satellites', content: '## Weather Satellites\n\nNOAA 15, 18, and 19 are polar-orbiting weather satellites that transmit images using Automatic Picture Transmission (APT) on:\n- **NOAA 15:** 137.620 MHz\n- **NOAA 18:** 137.9125 MHz\n- **NOAA 19:** 137.100 MHz\n\nThey pass overhead every ~90 minutes, and each pass gives you a 10-15 minute window to receive an image.' },
          { id: 's2', title: 'When to Listen', content: '## Find Satellite Passes\n\n1. Go to **Observation Scheduler** (press `7`)\n2. Look for upcoming NOAA satellite passes\n3. You need a pass with at least **20° maximum elevation** for a decent image\n4. Higher passes = better images\n\n**Tip:** Schedule the observation and SignalForge will auto-tune and record!' },
          { id: 's3', title: 'Receive the Signal', content: '## APT Reception\n\nAPT signals are FM-modulated at **137 MHz**:\n1. Use **FM Demod** with **34 kHz** bandwidth\n2. The signal sounds like a rhythmic ticking — that\'s the image data!\n3. Record the audio for offline decoding\n\nSignalForge\'s built-in APT decoder can decode in real-time.' },
          { id: 's4', title: 'View Your Image', content: '## Your First Satellite Image!\n\nThe decoded APT image shows two channels side by side:\n- **Channel A** — visible light (daytime) or near-IR\n- **Channel B** — thermal infrared\n\nYou can see clouds, coastlines, and weather systems — all received directly from space with a £25 SDR!\n\n🛰️ Next challenge: Try Meteor-M2 LRPT for higher resolution colour images.' },
        ],
      },
      {
        id: 'tut-sigint-basics', title: 'Introduction to SIGINT', description: 'Learn the fundamentals of signals intelligence — spectrum surveys, signal identification, and analysis.', difficulty: 'advanced', category: 'SIGINT', estimatedMinutes: 30, iconEmoji: '🕵️', prerequisites: ['tut-fm-reception', 'tut-adsb'],
        steps: [
          { id: 's1', title: 'What is SIGINT?', content: '## Signals Intelligence\n\nSIGINT is the art of intercepting and analysing radio signals to extract intelligence. In the civilian world, this means:\n- **Spectrum monitoring** — what\'s transmitting and where\n- **Signal identification** — classifying unknown signals\n- **Pattern analysis** — when do signals appear, how often, what patterns emerge\n\n⚠️ **Legal note:** In the UK, it\'s legal to receive any signal. It\'s illegal to act on certain intercepted communications (RIPA 2000). Always operate within the law.' },
          { id: 's2', title: 'Spectrum Survey', content: '## Conducting a Spectrum Survey\n\n1. Open **Frequency Scanner**\n2. Set a range (e.g., 400-470 MHz for UHF)\n3. Run a sweep — note active frequencies\n4. Use the **Signal Classifier** to identify signal types\n5. Log interesting findings in the **Logbook**\n\nThe TSCM (Technical Surveillance Countermeasures) view is useful for sweeping a location for unknown transmitters.' },
          { id: 's3', title: 'Signal Analysis', content: '## Analysing Unknown Signals\n\nWhen you find an unidentified signal:\n1. Note the **frequency**, **bandwidth**, and **modulation type**\n2. Check the **Signal Guide** for known allocations\n3. Use the **Waterfall** for visual pattern analysis\n4. Check if it\'s periodic — the **Analytics** heatmap reveals timing patterns\n5. Cross-reference with online databases (sigidwiki.com)' },
          { id: 's4', title: 'Best Practices', content: '## SIGINT Best Practices\n\n- **Document everything** — use the Logbook and Timeline\n- **Baseline first** — know what\'s normal before looking for anomalies\n- **Multiple observations** — one sighting isn\'t intelligence\n- **OPSEC** — be aware of your own RF emissions\n- **Legal compliance** — always operate within your jurisdiction\'s laws\n\nSignalForge\'s analytics and history features are your primary SIGINT tools.' },
        ],
      },
    ];

    this.quizQuestions = [
      { id: 'q1', question: 'What frequency is used for ADS-B aircraft tracking?', options: ['137.100 MHz', '156.800 MHz', '1090 MHz', '2.4 GHz'], correctIndex: 2, explanation: 'ADS-B (Automatic Dependent Surveillance–Broadcast) operates on 1090 MHz. Aircraft broadcast their position, altitude, and callsign on this frequency.', difficulty: 'beginner' },
      { id: 'q2', question: 'What does the "S" in SSB stand for?', options: ['Single', 'Super', 'Signal', 'Sub'], correctIndex: 0, explanation: 'SSB = Single Sideband. It\'s a mode where only one sideband of the AM signal is transmitted, making it more power-efficient for voice communications.', difficulty: 'beginner' },
      { id: 'q3', question: 'What is the international maritime distress frequency?', options: ['121.5 MHz', '156.800 MHz (Ch 16)', '243.0 MHz', '406 MHz'], correctIndex: 1, explanation: 'VHF Channel 16 (156.800 MHz) is the international maritime distress and calling frequency. All vessels monitor this channel.', difficulty: 'intermediate' },
      { id: 'q4', question: 'What modulation does NOAA APT use?', options: ['AM', 'FM', 'SSB', 'BPSK'], correctIndex: 1, explanation: 'NOAA APT (Automatic Picture Transmission) uses FM modulation with a 2400 Hz subcarrier. The image data is amplitude-modulated onto the subcarrier.', difficulty: 'intermediate' },
      { id: 'q5', question: 'What is the Nyquist rate for a signal with 10 kHz bandwidth?', options: ['5 kHz', '10 kHz', '20 kHz', '40 kHz'], correctIndex: 2, explanation: 'The Nyquist rate is twice the bandwidth: 2 × 10 kHz = 20 kHz. You must sample at least this fast to avoid aliasing.', difficulty: 'advanced' },
      { id: 'q6', question: 'DMR uses which type of multiple access?', options: ['FDMA', 'TDMA', 'CDMA', 'OFDMA'], correctIndex: 1, explanation: 'DMR (Digital Mobile Radio) uses TDMA (Time Division Multiple Access) with two time slots per 12.5 kHz channel.', difficulty: 'advanced' },
    ];
  }

  getTutorials(difficulty?: TutorialDifficulty): Tutorial[] {
    if (difficulty) return this.tutorials.filter(t => t.difficulty === difficulty);
    return [...this.tutorials];
  }

  getTutorial(id: string): Tutorial | undefined { return this.tutorials.find(t => t.id === id); }

  getQuizQuestions(difficulty?: TutorialDifficulty, limit = 10): QuizQuestion[] {
    let qs = [...this.quizQuestions];
    if (difficulty) qs = qs.filter(q => q.difficulty === difficulty);
    return qs.slice(0, limit);
  }

  submitQuizAnswer(questionId: string, answerIndex: number): { correct: boolean; explanation: string } {
    const q = this.quizQuestions.find(q => q.id === questionId);
    if (!q) return { correct: false, explanation: 'Question not found' };
    const correct = answerIndex === q.correctIndex;
    if (correct) this.progress.totalPoints += 10;
    this.progress.quizScores[questionId] = correct ? 1 : 0;
    this.updateRank();
    return { correct, explanation: q.explanation };
  }

  completeTutorial(id: string): void {
    if (!this.progress.completedTutorials.includes(id)) {
      this.progress.completedTutorials.push(id);
      this.progress.totalPoints += 50;
      this.updateRank();
    }
  }

  getProgress(): AcademyProgress { return { ...this.progress }; }

  private updateRank() {
    const pts = this.progress.totalPoints;
    if (pts >= 500) this.progress.rank = 'Signal Master';
    else if (pts >= 300) this.progress.rank = 'Spectrum Analyst';
    else if (pts >= 150) this.progress.rank = 'Radio Operator';
    else if (pts >= 50) this.progress.rank = 'Apprentice';
    else this.progress.rank = 'Novice Listener';
  }
}
