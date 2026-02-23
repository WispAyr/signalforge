// ============================================================================
// SignalForge — TSCM (Counter-Surveillance) Service
// ============================================================================
import { EventEmitter } from 'events';
import type { TSCMBaseline, TSCMAnomaly, KnownBugFrequency, TSCMSweepResult, TSCMBandResult, TSCMConfig, TSCMReport, ThreatLevel } from '@signalforge/shared';

const KNOWN_BUGS: KnownBugFrequency[] = [
  { frequency: 139.0e6, bandwidth: 200e3, type: 'Room Bug', description: 'Common VHF room transmitter', commonNames: ['VHF bug'] },
  { frequency: 160.0e6, bandwidth: 500e3, type: 'Room Bug', description: 'Upper VHF room transmitter range', commonNames: ['VHF bug'] },
  { frequency: 418.0e6, bandwidth: 1e6, type: 'Digital Bug', description: 'ISM band digital transmitter', commonNames: ['Digital room bug'] },
  { frequency: 433.92e6, bandwidth: 2e6, type: 'ISM Device', description: '433 MHz ISM band — could be bug or legitimate device', commonNames: ['433 bug', 'ISM transmitter'] },
  { frequency: 868.0e6, bandwidth: 2e6, type: 'Digital Bug', description: 'SRD868 band — digital surveillance devices', commonNames: ['SRD bug'] },
  { frequency: 1575.42e6, bandwidth: 2e6, type: 'GPS Tracker', description: 'GPS L1 — may indicate GPS tracking device transmitting', commonNames: ['GPS tracker'] },
  { frequency: 2400.0e6, bandwidth: 80e6, type: 'WiFi Camera', description: '2.4 GHz WiFi — hidden cameras, WiFi bugs', commonNames: ['WiFi camera', 'WiFi bug'] },
  { frequency: 5800.0e6, bandwidth: 100e6, type: 'WiFi Camera', description: '5.8 GHz — video transmitters, WiFi cameras', commonNames: ['5G camera', 'Video TX'] },
];

const SWEEP_BANDS = [
  { name: 'VHF Low', start: 30e6, end: 88e6 }, { name: 'VHF High', start: 136e6, end: 174e6 },
  { name: 'UHF', start: 380e6, end: 512e6 }, { name: 'ISM 433', start: 430e6, end: 440e6 },
  { name: 'ISM 868', start: 863e6, end: 870e6 }, { name: 'GSM 900', start: 880e6, end: 960e6 },
  { name: 'GSM 1800', start: 1710e6, end: 1880e6 }, { name: 'WiFi 2.4G', start: 2400e6, end: 2500e6 },
];

export class TSCMService extends EventEmitter {
  private baselines: TSCMBaseline[] = [];
  private sweepResults: TSCMSweepResult[] = [];
  private anomalies: TSCMAnomaly[] = [];
  private reports: TSCMReport[] = [];
  private config: TSCMConfig = {
    enabled: false, anomalyThresholdDb: 15, autoSweepInterval: 0,
    sweepBands: SWEEP_BANDS,
  };
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getBaselines(): TSCMBaseline[] { return this.baselines; }
  getBaseline(id: string): TSCMBaseline | undefined { return this.baselines.find(b => b.id === id); }
  getSweepResults(limit = 50): TSCMSweepResult[] { return this.sweepResults.slice(0, limit); }
  getAnomalies(limit = 100): TSCMAnomaly[] { return this.anomalies.slice(0, limit); }
  getReports(): TSCMReport[] { return this.reports; }
  getKnownBugs(): KnownBugFrequency[] { return KNOWN_BUGS; }

  acknowledgeAnomaly(id: string): boolean {
    const a = this.anomalies.find(a => a.id === id);
    if (a) { a.acknowledged = true; return true; }
    return false;
  }

  recordBaseline(name: string, location: string): TSCMBaseline {
    const numSamples = 256;
    const samples = new Array(numSamples).fill(0).map(() => -80 + Math.random() * 10);
    const baseline: TSCMBaseline = {
      id: `bl-${Date.now()}`, name, timestamp: Date.now(), location,
      startFreq: 30e6, endFreq: 6e9, samples, stepSize: (6e9 - 30e6) / numSamples,
      noiseFloor: -80,
    };
    this.baselines.push(baseline);
    this.emit('baseline_recorded', baseline);
    return baseline;
  }

  runSweep(baselineId?: string, location = 'Unknown'): TSCMSweepResult {
    const baseline = baselineId ? this.baselines.find(b => b.id === baselineId) : this.baselines[0];
    const sweepAnomalies: TSCMAnomaly[] = [];
    const bandResults: TSCMBandResult[] = [];

    for (const band of SWEEP_BANDS) {
      const anomalyCount = Math.random() > 0.7 ? Math.floor(Math.random() * 3) + 1 : 0;
      let maxDev = 0;
      for (let i = 0; i < anomalyCount; i++) {
        const freq = band.start + Math.random() * (band.end - band.start);
        const deviation = 10 + Math.random() * 30;
        maxDev = Math.max(maxDev, deviation);
        const bugMatch = KNOWN_BUGS.find(b => Math.abs(b.frequency - freq) < b.bandwidth);
        const threatLevel: ThreatLevel = deviation > 25 ? 'high' : deviation > 15 ? 'medium' : 'low';
        const anomaly: TSCMAnomaly = {
          id: `an-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(), frequency: freq, power: -50 + deviation,
          baselinePower: baseline ? -80 : -80, deviation, threatLevel,
          description: bugMatch ? `Possible ${bugMatch.type}: ${bugMatch.description}` : `Unknown signal ${(freq / 1e6).toFixed(1)} MHz`,
          acknowledged: false, knownBugMatch: bugMatch || undefined,
        };
        sweepAnomalies.push(anomaly);
        this.anomalies.unshift(anomaly);
      }
      const status: ThreatLevel = maxDev > 25 ? 'high' : maxDev > 15 ? 'medium' : anomalyCount > 0 ? 'low' : 'clear';
      bandResults.push({ name: band.name, startFreq: band.start, endFreq: band.end, status, anomalyCount, maxDeviation: maxDev });
    }

    if (this.anomalies.length > 1000) this.anomalies = this.anomalies.slice(0, 1000);

    const overallThreat: ThreatLevel = sweepAnomalies.some(a => a.threatLevel === 'critical') ? 'critical'
      : sweepAnomalies.some(a => a.threatLevel === 'high') ? 'high'
      : sweepAnomalies.some(a => a.threatLevel === 'medium') ? 'medium'
      : sweepAnomalies.length > 0 ? 'low' : 'clear';

    const result: TSCMSweepResult = {
      id: `sw-${Date.now()}`, timestamp: Date.now(), location,
      duration: 30 + Math.random() * 60, baselineId: baseline?.id || 'none',
      anomalies: sweepAnomalies, overallThreat, bandsSwept: bandResults,
    };
    this.sweepResults.unshift(result);
    if (this.sweepResults.length > 100) this.sweepResults = this.sweepResults.slice(0, 100);
    this.emit('sweep_complete', result);
    return result;
  }

  generateReport(sweepId: string, operator = 'Operator'): TSCMReport | undefined {
    const sweep = this.sweepResults.find(s => s.id === sweepId);
    if (!sweep) return undefined;
    const recommendations: string[] = [];
    if (sweep.overallThreat === 'clear') recommendations.push('No anomalies detected. Environment appears clean.');
    if (sweep.anomalies.some(a => a.knownBugMatch)) recommendations.push('Known surveillance device signatures detected. Physical inspection recommended.');
    if (sweep.overallThreat === 'high' || sweep.overallThreat === 'critical') recommendations.push('Significant RF anomalies found. Recommend professional TSCM team inspection.');
    const report: TSCMReport = {
      id: `rpt-${Date.now()}`, sweep, generatedAt: Date.now(),
      location: sweep.location, operator,
      summary: `TSCM sweep completed: ${sweep.bandsSwept.length} bands, ${sweep.anomalies.length} anomalies, overall threat: ${sweep.overallThreat.toUpperCase()}`,
      recommendations,
    };
    this.reports.push(report);
    return report;
  }

  getConfig(): TSCMConfig { return this.config; }
  updateConfig(cfg: Partial<TSCMConfig>): TSCMConfig { Object.assign(this.config, cfg); return this.config; }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    this.recordBaseline('Office Baseline', 'Office - Floor 2');
    this.demoInterval = setInterval(() => { this.runSweep(undefined, 'Office - Floor 2'); }, 30000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
