import { EventEmitter } from 'events';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Observation, ObservationScheduleConfig } from '@signalforge/shared';

/**
 * Observation Scheduler — schedules automated satellite observations.
 * 
 * Integrates with:
 * - Satellite pass predictions to find upcoming passes
 * - SDR tuning to set frequency
 * - Doppler correction for frequency tracking
 * - Rotator control for antenna pointing
 * - Recording for capturing observation data
 */

const DATA_DIR = join(process.cwd(), 'data');
const OBS_FILE = join(DATA_DIR, 'observations.json');

export class ObservationScheduler extends EventEmitter {
  private observations: Observation[] = [];
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks for integration
  private predictPasses: ((catNum: number, hours: number) => Promise<any[]>) | null = null;
  private onObservationStart: ((obs: Observation) => void) | null = null;
  private onObservationEnd: ((obs: Observation) => void) | null = null;

  constructor() {
    super();
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    this.load();
  }

  private load() {
    try {
      if (existsSync(OBS_FILE)) {
        this.observations = JSON.parse(readFileSync(OBS_FILE, 'utf8'));
      }
    } catch { this.observations = []; }
  }

  private save() {
    try {
      writeFileSync(OBS_FILE, JSON.stringify(this.observations, null, 2));
    } catch (e) {
      console.error('Failed to save observations:', e);
    }
  }

  setCallbacks(opts: {
    predictPasses: (catNum: number, hours: number) => Promise<any[]>;
    onStart: (obs: Observation) => void;
    onEnd: (obs: Observation) => void;
  }) {
    this.predictPasses = opts.predictPasses;
    this.onObservationStart = opts.onStart;
    this.onObservationEnd = opts.onEnd;
  }

  start() {
    // Check every 30 seconds for upcoming observations
    this.checkInterval = setInterval(() => this.check(), 30000);
    console.log('📅 Observation scheduler started');
  }

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }

  getObservations(status?: string): Observation[] {
    if (status) return this.observations.filter(o => o.status === status);
    return [...this.observations];
  }

  getObservation(id: string): Observation | undefined {
    return this.observations.find(o => o.id === id);
  }

  async scheduleObservation(config: ObservationScheduleConfig): Promise<Observation[]> {
    if (!this.predictPasses) throw new Error('Pass prediction not configured');

    // Find upcoming passes
    const passes = await this.predictPasses(config.satelliteCatalogNumber, 48);
    const eligiblePasses = passes.filter(p => p.maxElevation >= config.minElevation);

    const maxObs = config.maxObservations || 5;
    const scheduled: Observation[] = [];

    for (const pass of eligiblePasses.slice(0, maxObs)) {
      const obs: Observation = {
        id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${config.satelliteName} @ ${(config.frequency / 1e6).toFixed(3)} MHz`,
        satelliteCatalogNumber: config.satelliteCatalogNumber,
        satelliteName: config.satelliteName,
        frequency: config.frequency,
        mode: config.mode,
        minElevation: config.minElevation,
        autoRecord: config.autoRecord,
        autoDoppler: config.autoDoppler,
        autoRotator: config.autoRotator,
        status: 'scheduled',
        scheduledStart: pass.aos,
        scheduledEnd: pass.los,
        notes: config.notes,
        created: new Date().toISOString(),
      };
      this.observations.push(obs);
      scheduled.push(obs);
    }

    this.save();
    return scheduled;
  }

  cancelObservation(id: string) {
    const obs = this.observations.find(o => o.id === id);
    if (obs && obs.status === 'scheduled') {
      obs.status = 'cancelled';
      this.save();
      this.emit('update', obs);
    }
  }

  deleteObservation(id: string) {
    this.observations = this.observations.filter(o => o.id !== id);
    this.save();
  }

  private async check() {
    const now = Date.now();

    for (const obs of this.observations) {
      if (obs.status !== 'scheduled') continue;

      const start = obs.scheduledStart ? new Date(obs.scheduledStart).getTime() : 0;
      const end = obs.scheduledEnd ? new Date(obs.scheduledEnd).getTime() : 0;

      // Observation should start
      if (start <= now && now <= end) {
        obs.status = 'active';
        obs.actualStart = new Date().toISOString();
        this.save();
        this.emit('update', obs);
        this.onObservationStart?.(obs);
        console.log(`📡 Observation started: ${obs.name}`);
      }

      // Observation missed (start was >10 min ago and never activated)
      if (start > 0 && now - start > 600000 && obs.status === 'scheduled') {
        obs.status = 'missed';
        this.save();
        this.emit('update', obs);
      }
    }

    // Check active observations that should end
    for (const obs of this.observations) {
      if (obs.status !== 'active') continue;

      const end = obs.scheduledEnd ? new Date(obs.scheduledEnd).getTime() : 0;
      if (end > 0 && now > end) {
        obs.status = 'completed';
        obs.actualEnd = new Date().toISOString();
        this.save();
        this.emit('update', obs);
        this.onObservationEnd?.(obs);
        console.log(`✅ Observation completed: ${obs.name}`);
      }
    }
  }
}
