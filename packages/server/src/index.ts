import { Socket as NetSocket } from "net";
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { SDRBridge } from './sdr/bridge.js';
import { RtlTcpClient } from './sdr/rtltcp.js';
import { SDRMultiplexer } from './sdr/multiplexer.js';
import { SoapyClient } from './sdr/soapy.js';
import { RotatorClient } from './sdr/rotator.js';
import { DopplerService } from './sdr/doppler.js';
import { SpectrumAnalyzer } from './sdr/spectrum.js';
import { ObservationScheduler } from './sdr/scheduler.js';
import { MqttClient } from './sdr/mqtt.js';
import { SatelliteService } from './satellite/service.js';
import { ADSBDecoder } from './decoders/adsb.js';
import { ACARSDecoder } from './decoders/acars.js';
import { AISDecoder } from './decoders/ais.js';
import { APRSDecoder } from './decoders/aprs.js';
import { LocationService } from './location/service.js';
import { SignalDatabaseService } from './signals/database.js';
import { SessionManager } from './multiuser/sessions.js';
import { PluginLoader } from './plugins/loader.js';
import { EdgeNodeManager } from './edge/manager.js';
import { FrequencyScanner } from './scanner/service.js';
import { AirportScannerService } from './scanner/airport-scanner.js';
import { UHFScannerService } from './scanner/uhf-scanner.js';
import { createUHFScannerRouter } from './scanner/uhf-routes.js';
import { SignalClassifier } from './classifier/service.js';
import { TimelineService } from './timeline/service.js';
import { TelemetryService } from './telemetry/service.js';
// Phase 6 imports
import { SatNOGSService } from './satnogs/service.js';
import { WaterfallRecorder } from './waterfall/recorder.js';
import { GeofenceService } from './geofence/service.js';
import { DigitalVoiceDecoder } from './voice/decoder.js';
import { PropagationService } from './propagation/service.js';
import { LogbookService } from './logbook/service.js';
import { AnalyticsService } from './analytics/service.js';
import { DXClusterService } from './dxcluster/service.js';
import { AudioStreamingService } from './audio/streaming.js';
// Phase 7 imports
import { RTL433Service } from './rtl433/service.js';
import { PagerService } from './pager/service.js';
import { SubGHzService } from './subghz/service.js';
import { SSTVService } from './sstv/service.js';
import { MeterService } from './meters/service.js';
import { WiFiService } from './wifi/service.js';
import { BluetoothService } from './bluetooth/service.js';
import { TSCMService } from './tscm/service.js';
import { MeshtasticService } from './meshtastic/service.js';
import { NumberStationsService } from './numberstations/service.js';
import { FieldModeService } from './fieldmode/service.js';
import { VDL2Service } from './vdl2/service.js';
// Phase 8 imports
import { NarratorService } from './narrator/service.js';
import { DecoderManager } from './decoders/manager.js';
import { CommunityService } from './community/service.js';
import { AcademyService } from './academy/service.js';
import { getModules, getLessons, getLesson, getLessonsByModule } from './academy/content.js';
import { HistoryService } from './history/service.js';
import { IntegrationHubService } from './integrations/service.js';
import { EquipmentService } from './equipment/service.js';
import { AaroniaService } from './services/aaronia.js';
import { WebSDRService } from './sdr/websdr.js';
import { TimeMachineService } from './timemachine/service.js';
import { SettingsService } from './services/settings.js';
import { PersistenceService } from './persistence/service.js';
import { db } from './services/database.js';
import { FilesystemPluginLoader } from './plugins/fs-loader.js';
import { CommunityDBService } from './community/db-service.js';
import { TrainingService } from './training/service.js';
// Rules engine
import { RulesEngine } from './rules/engine.js';
import { createRulesRouter } from './rules/api.js';
import { createDataFlowRouter } from './rules/dataflow-api.js';
import type { DashboardStats, ActivityFeedItem, IntegrationType } from '@signalforge/shared';

// ============================================================================
// Global Error Handling — Prevents Silent Crashes
// ============================================================================
process.on('uncaughtException', (err, origin) => {
  console.error('🚨 Uncaught Exception:', err.message, 'origin:', origin);
  console.error(err.stack || 'no stack trace');
  // DO NOT exit — keep process alive but log
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  // DO NOT exit — just log
});

const PORT = parseInt(process.env.PORT || '3401');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 200;
app.use((req, res, next) => {
  if (req.path.startsWith('/api/health') || req.path.startsWith('/api/docs')) return next();
  const ip = req.ip || 'unknown';
  const entry = rateLimitMap.get(ip);
  const now = Date.now();
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
});

const server = createServer(app);

// CyberEther split-channel: two WebSocket servers, manual upgrade routing
const wss = new WebSocketServer({ noServer: true });
const signalWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/ws/signal') {
    signalWss.handleUpgrade(req, socket, head, (ws) => signalWss.emit('connection', ws, req));
  } else if (pathname === '/ws/scanner-audio') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log('📡 Scanner audio client connected');
      uhfScanner.addAudioClient(ws);
      ws.on('close', () => uhfScanner.removeAudioClient(ws));
    });
  } else if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

signalWss.on('connection', (ws) => {
  console.log('⚡ Signal client connected (binary-only channel)');
  ws.on('close', () => console.log('⚡ Signal client disconnected'));
});

function broadcastSignal(data: Buffer | ArrayBuffer) {
  signalWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: true });
  });
}

// ============================================================================
// Services
// ============================================================================
const sdrBridge = new SDRBridge();
const satelliteService = new SatelliteService();
const adsbDecoder = new ADSBDecoder();
const acarsDecoder = new ACARSDecoder();
const aisDecoder = new AISDecoder();
const aprsDecoder = new APRSDecoder();
const signalDb = new SignalDatabaseService();
const dopplerService = new DopplerService();
const spectrumAnalyzer = new SpectrumAnalyzer();
const observationScheduler = new ObservationScheduler();
const mqttClient = new MqttClient();

// SDR connections
const rtlTcpConnections = new Map<string, RtlTcpClient>();
const sdrMultiplexer = new SDRMultiplexer();
const soapyConnections = new Map<string, SoapyClient>();
let rotatorClient: RotatorClient | null = null;

const sessionManager = new SessionManager();
const pluginLoader = new PluginLoader();
const edgeNodeManager = new EdgeNodeManager();
const frequencyScanner = new FrequencyScanner();
const airportScanner = new AirportScannerService();
const uhfScanner = new UHFScannerService();
uhfScanner.setMultiplexer(sdrMultiplexer);
const signalClassifier = new SignalClassifier();
const timelineService = new TimelineService();
const telemetryService = new TelemetryService();

// Phase 6 services
const satnogsService = new SatNOGSService();
const waterfallRecorder = new WaterfallRecorder();
const geofenceService = new GeofenceService();
const voiceDecoder = new DigitalVoiceDecoder();
const propagationService = new PropagationService();
const logbookService = new LogbookService();
const analyticsService = new AnalyticsService();
const dxClusterService = new DXClusterService();
const audioStreamingService = new AudioStreamingService();

// Phase 7 services
const rtl433Service = new RTL433Service();
const pagerService = new PagerService();
const subghzService = new SubGHzService();
const sstvService = new SSTVService();
const meterService = new MeterService();
const wifiService = new WiFiService();
const bluetoothService = new BluetoothService();
const tscmService = new TSCMService();
const meshtasticService = new MeshtasticService();
const numberStationsService = new NumberStationsService();
const fieldModeService = new FieldModeService();
const vdl2Service = new VDL2Service();
// Phase 8
const narratorService = new NarratorService();
const decoderManager = new DecoderManager();
const communityService = new CommunityService();
const academyService = new AcademyService();
const historyService = new HistoryService();
const integrationHubService = new IntegrationHubService();
const equipmentService = new EquipmentService();
const aaroniaService = new AaroniaService();
const webSDRService = new WebSDRService();
const timeMachineService = new TimeMachineService();
const settingsService = new SettingsService();
const persistenceService = new PersistenceService();

// Community DB + Training services (sqlite-backed)
const communityDBService = new CommunityDBService();
const trainingService = new TrainingService();

// Filesystem plugin loader (initialized lazily after all services are ready)
let fsPluginLoader: FilesystemPluginLoader;

// Rules engine — evaluates all decoder events against user-defined rules
const rulesEngine = new RulesEngine(
  broadcast,
  (topic: string, payload: string) => { if (mqttClient.getConfig().connected) mqttClient.publish(topic, payload); },
  (zoneId: string, entityId: string) => {
    const pos = (geofenceService as any).entityPositions?.get(entityId);
    if (!pos) return 'unknown';
    return pos.inside?.has(zoneId) ? 'inside' : 'outside';
  }
);
const locationService = new LocationService();
locationService.start();

// Start demo telemetry
// telemetryService.startDemoTelemetry(); // DISABLED - real data only

// Start Phase 6 services
geofenceService.start();
propagationService.start();
// voiceDecoder.startDemo(); // DISABLED

// Start Phase 7 demo services
// rtl433Service.startDemo(); // DISABLED
// pagerService.startDemo(); // DISABLED
// subghzService.startDemo(); // DISABLED
// sstvService.startDemo(); // DISABLED
// meterService.startDemo(); // DISABLED
// wifiService.startDemo(); // DISABLED
// bluetoothService.startDemo(); // DISABLED
// tscmService.startDemo(); // DISABLED
// meshtasticService.startDemo(); // DISABLED
// vdl2Service.startDemo(); // DISABLED

// Session cleanup interval
setInterval(() => sessionManager.cleanup(), 60000);
// Edge node health check
setInterval(() => edgeNodeManager.checkHealth(), 15000);

// Wire up events to timeline
sessionManager.on('chat', (msg) => {
  broadcast({ type: 'chat_message', message: msg });
});
sessionManager.on('observation', (obs) => {
  broadcast({ type: 'shared_observation', observation: obs });
  timelineService.addEvent({ type: 'observation', title: `${obs.nickname}: ${obs.description}`, description: `${(obs.frequency / 1e6).toFixed(3)} MHz ${obs.mode}`, timestamp: Date.now(), frequency: obs.frequency, icon: '📡', color: obs.color, userId: obs.userId, nickname: obs.nickname });
});
sessionManager.on('user_joined', (user) => {
  broadcast({ type: 'users_update', users: sessionManager.getOnlineUsers() });
  timelineService.addEvent({ type: 'system', title: `${user.nickname} joined`, description: 'New operator connected', timestamp: Date.now(), icon: '👤', color: user.color });
});
sessionManager.on('user_left', (user) => {
  broadcast({ type: 'users_update', users: sessionManager.getOnlineUsers() });
});
sessionManager.on('tuning_changed', (user) => {
  broadcast({ type: 'users_update', users: sessionManager.getOnlineUsers() });
});

edgeNodeManager.on('node_online', (node) => {
  broadcast({ type: 'edge_nodes', nodes: edgeNodeManager.getNodes() });
  timelineService.addEvent({ type: 'system', title: `Edge node online: ${node.name}`, description: `${node.hostname} (${node.ip})`, timestamp: Date.now(), icon: '🖥️', color: '#00e676' });
});
edgeNodeManager.on('node_offline', (node) => {
  broadcast({ type: 'edge_nodes', nodes: edgeNodeManager.getNodes() });
});
edgeNodeManager.on('heartbeat', () => {
  broadcast({ type: 'edge_nodes', nodes: edgeNodeManager.getNodes() });
});

// UHF Scanner events
uhfScanner.on('state_change', (status) => broadcast({ type: 'uhf_scanner_status', status }));
uhfScanner.on('signal_detected', (sig) => {
  broadcast({ type: 'uhf_scanner_signal', signal: sig });
  timelineService.addEvent({ type: 'scan_hit', title: 'UHF Signal: ' + (sig.frequency / 1e6).toFixed(4) + ' MHz', description: (sig.channel?.label || 'Unknown') + ' ' + sig.signalStrengthDb.toFixed(1) + ' dB', timestamp: Date.now(), frequency: sig.frequency, icon: '📡', color: '#ff6b35' });
});
uhfScanner.on('hit', (hit) => broadcast({ type: 'uhf_scanner_hit', hit }));

frequencyScanner.on('scan_update', (state) => broadcast({ type: 'scanner_state', state }));
frequencyScanner.on('signal_detected', (activity) => {
  broadcast({ type: 'scan_hit', activity });
  timelineService.addEvent({ type: 'scan_hit', title: `Signal on ${(activity.frequency / 1e6).toFixed(3)} MHz`, description: `${activity.signalStrength.toFixed(0)} dBm`, timestamp: Date.now(), frequency: activity.frequency, icon: '📻', color: '#ffab00' });
});


// Airport Scanner WebSocket events
airportScanner.on('scanner_channel_update', (channels: any) => broadcast({ type: 'scanner_channel_update', channels }));
airportScanner.on('scanner_recording', (recording: any) => broadcast({ type: 'scanner_recording', recording }));
airportScanner.on('scanner_discovery', (signal: any) => broadcast({ type: 'scanner_discovery', signal }));
airportScanner.on('scanner_status', (status: any) => broadcast({ type: 'scanner_status', status }));
signalClassifier.on('classification', (result) => {
  broadcast({ type: 'classification', result });
  timelineService.addEvent({ type: 'classification', title: `${result.classification.toUpperCase()} signal classified`, description: `${(result.frequency / 1e6).toFixed(3)} MHz — ${(result.confidence * 100).toFixed(0)}% confidence`, timestamp: Date.now(), frequency: result.frequency, icon: '🧠', color: '#748ffc' });
  // Feed classified signals to narrator
  narratorService.updateRFState({ classifiedSignals: signalClassifier.getResults(10).map(r => ({ freq: r.frequency, classification: r.classification, confidence: r.confidence, bandwidth: r.bandwidth })) });
});

narratorService.on('narration', (narration) => {
  broadcast({ type: 'narrator_update', narration });
  broadcast({ type: 'narration', narration });
});

// Decoder Manager events
decoderManager.on('decoder_message', ({ decoder, data }) => {
  broadcast({ type: 'decoder_message', decoder, data });
  // Feed rtl_433 data into rtl433Service for existing UI
  if (decoder === 'rtl_433' && data.type === 'ism_device') {
    rtl433Service.processMessage(data);
  }
  // Feed pager data into pagerService
  if (decoder === 'multimon-ng' && data.type === 'pager') {
    pagerService.processMessage(data);
  }
});
decoderManager.on('decoder_started', (name) => {
  broadcast({ type: 'decoder_status', decoders: decoderManager.getDecoders() });
  console.log(`📡 Decoder started: ${name}`);
});
decoderManager.on('decoder_stopped', (name) => {
  broadcast({ type: 'decoder_status', decoders: decoderManager.getDecoders() });
  console.log(`📡 Decoder stopped: ${name}`);
});

telemetryService.on('frame', (frame) => {
  broadcast({ type: 'telemetry_frame', frame });
});

pluginLoader.on('plugin_changed', () => {
  broadcast({ type: 'plugins_update', plugins: pluginLoader.getPluginStatus() });
});

// Phase 6 event wiring
geofenceService.on('geo_alert', (alert) => {
  broadcast({ type: 'geo_alert', alert });
  timelineService.addEvent({ type: 'alert', title: `${alert.event.toUpperCase()}: ${alert.entityName}`, description: `Zone: ${alert.zoneName}`, timestamp: Date.now(), icon: '🔔', color: '#ff5252' });
});

voiceDecoder.on('voice_frame', (frame) => {
  broadcast({ type: 'voice_frame', frame });
  analyticsService.recordDecoderMessage(frame.protocol);
});

propagationService.on('solar_update', (data) => {
  broadcast({ type: 'solar_update', data });
});
propagationService.on('band_update', (conditions) => {
  broadcast({ type: 'band_update', conditions });
});

dxClusterService.on('spot', (spot) => {
  broadcast({ type: 'dx_spot', spot });
});
dxClusterService.on('spot_alert', ({ alert, spot }) => {
  broadcast({ type: 'dx_spot_alert', alert, spot });
  timelineService.addEvent({ type: 'alert', title: `DX SPOT: ${spot.spotted}`, description: `${(spot.frequency / 1e6).toFixed(3)} MHz ${spot.mode || ''} — ${spot.entity || ''}`, timestamp: Date.now(), icon: '🌍', color: '#ff9100' });
});

waterfallRecorder.on('recording_started', (rec) => {
  broadcast({ type: 'waterfall_recording', recording: rec });
});
waterfallRecorder.on('recording_stopped', (rec) => {
  broadcast({ type: 'waterfall_recording', recording: rec });
});

audioStreamingService.on('stream_created', (stream) => {
  broadcast({ type: 'audio_streams', streams: audioStreamingService.getActiveStreams() });
});
audioStreamingService.on('stream_stopped', () => {
  broadcast({ type: 'audio_streams', streams: audioStreamingService.getActiveStreams() });
});

// Phase 7 event wiring
rtl433Service.on('device_update', (device) => {
  broadcast({ type: 'ism_device', device });
  analyticsService.recordDecoderMessage('ISM-433');
});

pagerService.on('message', (message) => {
  broadcast({ type: 'pager_message', message });
  analyticsService.recordDecoderMessage(message.protocol);
});
pagerService.on('alert', (alert) => {
  broadcast({ type: 'pager_alert', alert });
  timelineService.addEvent({ type: 'alert', title: `PAGER: ${alert.filterName}`, description: alert.message.content.slice(0, 80), timestamp: Date.now(), icon: '📟', color: '#ff6b6b' });
});

subghzService.on('signal', (signal) => {
  broadcast({ type: 'subghz_signal', signal });
  if (signal.isReplay) {
    timelineService.addEvent({ type: 'alert', title: `REPLAY DETECTED: ${(signal.frequency / 1e6).toFixed(3)} MHz`, description: `${signal.protocol || 'Unknown'} — ${signal.replayCount} replays`, timestamp: Date.now(), icon: '⚠️', color: '#ff5252' });
  }
});
subghzService.on('sweep', (sweep) => broadcast({ type: 'subghz_sweep', sweep }));

sstvService.on('image', (image) => {
  broadcast({ type: 'sstv_image', image });
  timelineService.addEvent({ type: 'system', title: `SSTV: ${image.mode} decoded`, description: `${image.source} — ${image.width}×${image.height}`, timestamp: Date.now(), icon: '📺', color: '#e040fb' });
});

meterService.on('reading', ({ meter, reading }) => {
  broadcast({ type: 'meter_reading', meter, reading });
});

wifiService.on('deauth', (evt) => {
  broadcast({ type: 'wifi_deauth', event: evt });
  timelineService.addEvent({ type: 'alert', title: `DEAUTH: ${evt.bssid}`, description: `${evt.sourceMac} → ${evt.targetMac} (${evt.count}×)`, timestamp: Date.now(), icon: '⚠️', color: '#ff9100' });
});

bluetoothService.on('proximity_alert', (alert) => {
  broadcast({ type: 'bt_alert', alert });
  timelineService.addEvent({ type: 'alert', title: `BT TRACKER: ${alert.deviceName}`, description: `${alert.trackerType} — RSSI: ${alert.rssi.toFixed(0)} dBm`, timestamp: Date.now(), icon: '🔵', color: '#448aff' });
});

tscmService.on('sweep_complete', (result) => {
  broadcast({ type: 'tscm_sweep', result });
  if (result.overallThreat !== 'clear') {
    timelineService.addEvent({ type: 'alert', title: `TSCM: ${result.overallThreat.toUpperCase()}`, description: `${result.anomalies.length} anomalies in ${result.location}`, timestamp: Date.now(), icon: '🛡️', color: '#ff5252' });
  }
});

meshtasticService.on('message', (message) => {
  broadcast({ type: 'mesh_message', message });
});
meshtasticService.on('nodes_update', (nodes) => {
  broadcast({ type: 'mesh_nodes', nodes });
});

vdl2Service.on('message', (message) => {
  broadcast({ type: 'vdl2_message', message });
  analyticsService.recordDecoderMessage('VDL2');
});

// Feed decoder data into analytics
adsbDecoder.on('message', (msg) => analyticsService.recordDecoderMessage('ADS-B'));
acarsDecoder.on('message', () => analyticsService.recordDecoderMessage('ACARS'));
aisDecoder.on('message', () => analyticsService.recordDecoderMessage('AIS'));
aprsDecoder.on('message', () => analyticsService.recordDecoderMessage('APRS'));

// Feed decoder data into persistence (SQLite)
adsbDecoder.on('message', (msg) => persistenceService.recordADSB(msg));
aisDecoder.on('message', (msg) => persistenceService.recordAIS(msg));
aprsDecoder.on('message', (pkt) => persistenceService.recordAPRS(pkt));

// Feed aircraft/vessel positions into geofencing
adsbDecoder.on('message', (msg) => {
  if (msg.latitude && msg.longitude && msg.callsign) {
    geofenceService.updateEntityPosition('aircraft', msg.icao || msg.callsign, msg.callsign, msg.latitude, msg.longitude, msg.altitude);
  }
});
aisDecoder.on('message', (msg) => {
  if (msg.latitude && msg.longitude) {
    geofenceService.updateEntityPosition('vessel', String(msg.mmsi), msg.shipName || String(msg.mmsi), msg.latitude, msg.longitude);
  }
});

locationService.on('location', (loc) => {
  broadcast({ type: 'location', observer: loc });
});

// Wire live data into narrator every 25 seconds (just before narration cycle)
setInterval(() => {
  narratorService.updateRFState({
    adsbAircraft: adsbDecoder.getAircraft().map(a => ({
      callsign: a.callsign || '', altitude: a.altitude || 0,
      heading: a.heading || 0, speed: a.speed || 0,
      lat: a.latitude, lon: a.longitude, squawk: a.squawk,
      verticalRate: a.verticalRate,
    })),
    aisVessels: aisDecoder.getVessels().slice(0, 50).map(v => ({
      name: v.shipName || '', mmsi: v.mmsi, type: v.shipTypeName || '',
      sog: v.sog || 0, cog: v.cog || 0, destination: v.destination,
      navStatus: v.navStatusName,
    })),
    aprsStations: aprsDecoder.getStations().slice(0, 30).map(s => ({
      callsign: s.callsign, lat: s.latitude || 0, lon: s.longitude || 0,
      speed: s.lastPacket?.speed || 0, course: s.lastPacket?.course || 0,
      comment: s.comment || '',
    })),
    decoderStatus: decoderManager.getDecoders().map(d => ({
      name: d.name, running: d.running,
      messagesDecoded: d.messagesDecoded, lastMessage: d.lastMessage,
    })),
    ismDevices: rtl433Service.getDevices().map(d => ({
      model: d.model, type: d.deviceType,
      lastReading: d.lastReading as any,
    })),
    pagerMessages: pagerService.getMessages(5).map(m => ({
      protocol: m.protocol, content: m.content,
      capcode: m.capcode, timestamp: m.timestamp,
    })),
    sdrStatus: {
      connected: sdrMultiplexer.getStatus().connected,
      frequency: sdrMultiplexer.getStatus().centerFreq,
      sampleRate: sdrMultiplexer.getStatus().sampleRate,
    },
  });
}, 25000);

// Start decoders
adsbDecoder.start();
acarsDecoder.start();
aisDecoder.start();
aprsDecoder.start();

// Start observation scheduler
observationScheduler.setCallbacks({
  predictPasses: (catNum, hours) => {
    const obs = locationService.getObserver();
    return satelliteService.predictPassesForSat(catNum, {
      name: 'Observer', latitude: obs.latitude, longitude: obs.longitude, altitude: obs.altitude,
    }, hours);
  },
  onStart: (obs) => {
    broadcast({ type: 'observation_update', observation: obs });
    addActivity({ type: 'system', icon: '📡', title: `Observation started: ${obs.name}`, detail: obs.satelliteName || '', timestamp: Date.now() });
  },
  onEnd: (obs) => {
    broadcast({ type: 'observation_update', observation: obs });
    addActivity({ type: 'system', icon: '✅', title: `Observation completed: ${obs.name}`, detail: '', timestamp: Date.now() });
  },
});
observationScheduler.start();

// Doppler events
dopplerService.on('correction', (correction) => {
  broadcast({ type: 'doppler', correction });
});

// Spectrum analyzer events
spectrumAnalyzer.on('sweep', (result) => {
  broadcast({ type: 'spectrum_sweep', result: {
    ...result,
    frequencies: Array.from(result.frequencies),
    powers: Array.from(result.powers),
    maxHold: Array.from(result.maxHold),
  }});
});
spectrumAnalyzer.on('signals', (signals) => {
  broadcast({ type: 'detected_signals', signals });
});

// MQTT events
mqttClient.on('message', (msg) => {
  broadcast({ type: 'mqtt_message', message: msg });
});

// Observation scheduler events
observationScheduler.on('update', (obs) => {
  broadcast({ type: 'observation_update', observation: obs });
});

// ============================================================================
// Activity feed
// ============================================================================
const activityFeed: ActivityFeedItem[] = [];
const MAX_ACTIVITY = 100;

function addActivity(item: Omit<ActivityFeedItem, 'id'>) {
  const entry: ActivityFeedItem = { ...item, id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
  activityFeed.unshift(entry);
  if (activityFeed.length > MAX_ACTIVITY) activityFeed.pop();
  broadcast({ type: 'activity', item: entry });
}

adsbDecoder.on('message', (msg) => {
  if (msg.callsign) {
    addActivity({ type: 'aircraft', icon: '✈️', title: `${msg.callsign}`, detail: `FL${Math.round((msg.altitude || 0) / 100)} ${msg.speed || 0}kts`, timestamp: msg.timestamp });
  }
  broadcast({ type: 'adsb', aircraft: adsbDecoder.getAircraft() });

  // Publish to MQTT if connected
  if (mqttClient.getConfig().connected && msg.callsign) {
    mqttClient.publish('signalforge/adsb', JSON.stringify(msg));
  }
});

acarsDecoder.on('message', (msg) => {
  addActivity({ type: 'acars', icon: '📡', title: `ACARS ${msg.flightNumber || ''}`, detail: msg.messageText.slice(0, 60), timestamp: msg.timestamp });
  broadcast({ type: 'acars_message', message: msg });
  if (mqttClient.getConfig().connected) {
    mqttClient.publish('signalforge/acars', JSON.stringify(msg));
  }
});

aisDecoder.on('message', (msg) => {
  if (msg.shipName) {
    addActivity({ type: 'vessel', icon: '🚢', title: msg.shipName, detail: `${msg.sog?.toFixed(1) || 0} kts → ${msg.destination || '?'}`, timestamp: msg.timestamp });
  }
  // Individual update only — was flooding 2000+ vessels per msg
  broadcast({ type: 'ais_update', vessel: msg });
  if (mqttClient.getConfig().connected && msg.shipName) {
    mqttClient.publish('signalforge/ais', JSON.stringify(msg));
  }
});

aprsDecoder.on('message', (pkt) => {
  addActivity({ type: 'aprs', icon: '📍', title: pkt.source, detail: pkt.comment || pkt.dataType, timestamp: pkt.timestamp });
  // Individual update only — was flooding all stations per msg
  broadcast({ type: 'aprs_update', station: pkt });
  if (mqttClient.getConfig().connected) {
    mqttClient.publish('signalforge/aprs', JSON.stringify(pkt));
  }
});

// Wire all decoder events into the rules engine
adsbDecoder.on('message', (msg) => rulesEngine.evaluate('adsb', msg.icao || msg.callsign || 'unknown', msg));
acarsDecoder.on('message', (msg) => rulesEngine.evaluate('acars', msg.flightNumber || 'unknown', msg));
aisDecoder.on('message', (msg) => rulesEngine.evaluate('ais', String(msg.mmsi || 'unknown'), msg));
aprsDecoder.on('message', (pkt) => rulesEngine.evaluate('aprs', pkt.source || 'unknown', pkt));
rtl433Service.on('device_update', (d) => rulesEngine.evaluate('rtl433', d.id || d.model || 'unknown', d));
meshtasticService.on('message', (m) => rulesEngine.evaluate('meshtastic', m.from || 'unknown', m));
// Safe send — catches EPIPE/ECONNRESET from dead clients
function safeSend(client: WebSocket, data: string | Buffer | ArrayBuffer, opts?: { binary?: boolean }) {
  try {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, opts || {}, (err) => {
        if (err) {
          // Client gone — terminate silently
          try { client.terminate(); } catch { /* already dead */ }
        }
      });
    }
  } catch {
    try { client.terminate(); } catch { /* already dead */ }
  }
}

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => safeSend(client, msg));
}

// Binary broadcast for IQ data
function broadcastBinary(data: Buffer | ArrayBuffer) {
  wss.clients.forEach((client) => safeSend(client, data as Buffer, { binary: true }));
}

// ── Satellite pass notification scheduler ──────────────────────────────
setInterval(async () => {
  try {
    const obs = locationService.getObserver();
    const passes = await satelliteService.predictPasses(
      { name: obs.name || 'Observer', latitude: obs.latitude, longitude: obs.longitude, altitude: obs.altitude },
      1
    );
    for (const pass of passes) {
      const aosMs = new Date(pass.aos).getTime();
      const now = Date.now();
      const minsUntil = (aosMs - now) / 60000;
      if (minsUntil > 0 && minsUntil <= 5 && pass.maxElevation >= 20) {
        const notif = signalDb.addNotification({
          type: 'satellite_pass',
          title: `🛰️ ${pass.satellite} pass in ${Math.round(minsUntil)}m`,
          message: `Max el: ${pass.maxElevation.toFixed(0)}° — Duration: ${pass.duration}s`,
          data: { pass },
        });
        broadcast({ type: 'notification', notification: notif });
      }
    }
  } catch { /* ignore */ }
}, 60000);

// ============================================================================
// REST API — OpenAPI/Swagger docs
// ============================================================================

// Serve OpenAPI spec
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SignalForge API',
    version: '0.4.0',
    description: 'Universal Radio Platform — SDR control, satellite tracking, signal analysis, and decoder APIs',
    contact: { name: 'SignalForge', url: 'https://github.com/WispAyr/signalforge' },
    license: { name: 'MIT' },
  },
  servers: [{ url: `http://localhost:${PORT}`, description: 'Local development' }],
  paths: {
    '/api/health': { get: { summary: 'Health check', tags: ['System'], responses: { '200': { description: 'Server status' } } } },
    '/api/sdr/devices': { get: { summary: 'List SDR devices', tags: ['SDR'], responses: { '200': { description: 'Available SDR devices' } } } },
    '/api/sdr/connect': { post: { summary: 'Connect to rtl_tcp server', tags: ['SDR'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'number' } } } } } }, responses: { '200': { description: 'Connection info' } } } },
    '/api/sdr/connections': { get: { summary: 'List active SDR connections', tags: ['SDR'], responses: { '200': { description: 'Active connections' } } } },
    '/api/sdr/disconnect/{id}': { post: { summary: 'Disconnect SDR', tags: ['SDR'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Disconnected' } } } },
    '/api/sdr/frequency': { post: { summary: 'Set SDR frequency', tags: ['SDR'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { connectionId: { type: 'string' }, frequency: { type: 'number' } } } } } }, responses: { '200': { description: 'OK' } } } },
    '/api/sdr/gain': { post: { summary: 'Set SDR gain', tags: ['SDR'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { connectionId: { type: 'string' }, gain: { type: 'number' } } } } } }, responses: { '200': { description: 'OK' } } } },
    '/api/sdr/samplerate': { post: { summary: 'Set sample rate', tags: ['SDR'], responses: { '200': { description: 'OK' } } } },
    '/api/sdr/agc': { post: { summary: 'Set AGC mode', tags: ['SDR'], responses: { '200': { description: 'OK' } } } },
    '/api/soapy/connect': { post: { summary: 'Connect to SoapySDR server', tags: ['SoapySDR'], responses: { '200': { description: 'Connection info' } } } },
    '/api/soapy/connections': { get: { summary: 'List SoapySDR connections', tags: ['SoapySDR'], responses: { '200': { description: 'Connections' } } } },
    '/api/rotator/connect': { post: { summary: 'Connect to rotctld', tags: ['Rotator'], responses: { '200': { description: 'Rotator state' } } } },
    '/api/rotator/state': { get: { summary: 'Get rotator state', tags: ['Rotator'], responses: { '200': { description: 'Current position' } } } },
    '/api/rotator/position': { post: { summary: 'Set rotator position', tags: ['Rotator'], responses: { '200': { description: 'OK' } } } },
    '/api/rotator/stop': { post: { summary: 'Stop rotator', tags: ['Rotator'], responses: { '200': { description: 'Stopped' } } } },
    '/api/doppler/start': { post: { summary: 'Start Doppler tracking', tags: ['Doppler'], responses: { '200': { description: 'Tracking started' } } } },
    '/api/doppler/stop': { post: { summary: 'Stop Doppler tracking', tags: ['Doppler'], responses: { '200': { description: 'Stopped' } } } },
    '/api/doppler/status': { get: { summary: 'Get Doppler status', tags: ['Doppler'], responses: { '200': { description: 'Current correction' } } } },
    '/api/spectrum/sweep/start': { post: { summary: 'Start spectrum sweep', tags: ['Spectrum'], responses: { '200': { description: 'Sweep started' } } } },
    '/api/spectrum/sweep/stop': { post: { summary: 'Stop spectrum sweep', tags: ['Spectrum'], responses: { '200': { description: 'Stopped' } } } },
    '/api/spectrum/signals': { get: { summary: 'Get detected signals', tags: ['Spectrum'], responses: { '200': { description: 'Detected signals' } } } },
    '/api/observations': { get: { summary: 'List observations', tags: ['Scheduler'], responses: { '200': { description: 'Observations' } } }, post: { summary: 'Schedule observation', tags: ['Scheduler'], responses: { '200': { description: 'Scheduled' } } } },
    '/api/observations/{id}': { delete: { summary: 'Delete observation', tags: ['Scheduler'], responses: { '200': { description: 'Deleted' } } } },
    '/api/observations/{id}/cancel': { post: { summary: 'Cancel observation', tags: ['Scheduler'], responses: { '200': { description: 'Cancelled' } } } },
    '/api/mqtt/connect': { post: { summary: 'Connect to MQTT broker', tags: ['MQTT'], responses: { '200': { description: 'Connected' } } } },
    '/api/mqtt/disconnect': { post: { summary: 'Disconnect MQTT', tags: ['MQTT'], responses: { '200': { description: 'Disconnected' } } } },
    '/api/mqtt/status': { get: { summary: 'MQTT status', tags: ['MQTT'], responses: { '200': { description: 'Status' } } } },
    '/api/mqtt/publish': { post: { summary: 'Publish MQTT message', tags: ['MQTT'], responses: { '200': { description: 'Published' } } } },
    '/api/mqtt/messages': { get: { summary: 'Recent MQTT messages', tags: ['MQTT'], responses: { '200': { description: 'Messages' } } } },
    '/api/satellites': { get: { summary: 'Search satellites', tags: ['Satellites'], responses: { '200': { description: 'Satellites' } } } },
    '/api/satellites/positions': { get: { summary: 'Get satellite positions', tags: ['Satellites'], responses: { '200': { description: 'Positions' } } } },
    '/api/satellites/{id}/passes': { get: { summary: 'Predict passes', tags: ['Satellites'], responses: { '200': { description: 'Passes' } } } },
    '/api/aircraft': { get: { summary: 'Get aircraft', tags: ['Decoders'], responses: { '200': { description: 'Aircraft' } } } },
    '/api/vessels': { get: { summary: 'Get vessels', tags: ['Decoders'], responses: { '200': { description: 'Vessels' } } } },
    '/api/aprs': { get: { summary: 'Get APRS stations', tags: ['Decoders'], responses: { '200': { description: 'Stations' } } } },
    '/api/signals': { get: { summary: 'Search signal database', tags: ['Signals'], responses: { '200': { description: 'Signals' } } } },
    '/api/signals/identify': { get: { summary: 'Identify frequency', tags: ['Signals'], responses: { '200': { description: 'Matches' } } } },
  },
  tags: [
    { name: 'System' }, { name: 'SDR' }, { name: 'SoapySDR' }, { name: 'Rotator' },
    { name: 'Doppler' }, { name: 'Spectrum' }, { name: 'Scheduler' }, { name: 'MQTT' },
    { name: 'Satellites' }, { name: 'Decoders' }, { name: 'Signals' },
  ],
};

// ============================================================================
// REST endpoints
// ============================================================================

// Rules & Data Flow routes
app.use('/api', createRulesRouter(rulesEngine));
app.use('/api', createUHFScannerRouter(uhfScanner));
app.use('/api', createDataFlowRouter());
app.get('/api/health', (_req, res) => {
  const memUsage = process.memoryUsage();
  const components = [
    { name: 'SDR Bridge', status: 'up' as const, lastCheck: Date.now() },
    { name: 'Satellite Service', status: 'up' as const, lastCheck: Date.now() },
    { name: 'ADS-B Decoder', status: 'up' as const, lastCheck: Date.now(), details: { aircraft: adsbDecoder.getAircraft().length } },
    { name: 'AIS Decoder', status: 'up' as const, lastCheck: Date.now(), details: { vessels: aisDecoder.getVessels().length } },
    { name: 'ACARS Decoder', status: 'up' as const, lastCheck: Date.now() },
    { name: 'APRS Decoder', status: 'up' as const, lastCheck: Date.now(), details: { stations: aprsDecoder.getStations().length } },
    { name: 'MQTT', status: (mqttClient.getConfig().connected ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'Propagation', status: (propagationService.getSolarData() ? 'up' : 'degraded') as 'up' | 'degraded', lastCheck: Date.now() },
    { name: 'DX Cluster', status: (dxClusterService.getConfig().connected ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'Geofence', status: 'up' as const, lastCheck: Date.now(), details: { zones: geofenceService.getZones().length } },
    { name: 'Voice Decoder', status: 'up' as const, lastCheck: Date.now() },
    { name: 'Logbook', status: 'up' as const, lastCheck: Date.now() },
    { name: 'RTL-433', status: (rtl433Service.getStatus().connected ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now(), details: { devices: rtl433Service.getDevices().length } },
    { name: 'Pager', status: (pagerService.getConfig().enabled ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'Sub-GHz', status: (subghzService.getStatus().connected ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'SSTV', status: (sstvService.getStatus().active ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'WiFi', status: (wifiService.getStatus().scanning ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'Bluetooth', status: (bluetoothService.getStatus().scanning ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'TSCM', status: 'up' as const, lastCheck: Date.now() },
    { name: 'Meshtastic', status: (meshtasticService.getStatus().connected ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'VDL2', status: (vdl2Service.getStatus().connected ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now() },
    { name: 'Airport Scanner', status: (airportScanner.getStatus().running ? 'up' : 'down') as 'up' | 'down', lastCheck: Date.now(), details: { channels: airportScanner.getChannels().length } },
  ];
  const allUp = components.every(c => c.status === 'up');
  const anyDown = components.some(c => c.status === 'down');
  res.json({
    status: anyDown ? 'degraded' : allUp ? 'healthy' : 'degraded',
    name: 'SignalForge',
    version: '0.7.0',
    uptime: process.uptime(),
    timestamp: Date.now(),
    components,
    system: {
      cpuUsage: 0, // Would need os module
      memoryUsed: memUsage.heapUsed,
      memoryTotal: memUsage.heapTotal,
      nodeVersion: process.version,
      platform: process.platform,
    },
    usersOnline: sessionManager.getOnlineUsers().length,
    edgeNodes: edgeNodeManager.getOnlineNodes().length,
    pluginsLoaded: pluginLoader.getPlugins().length,
    sdrConnections: rtlTcpConnections.size + soapyConnections.size,
    rotatorConnected: rotatorClient?.isConnected || false,
    mqttConnected: mqttClient.getConfig().connected,
    dopplerTracking: dopplerService.isTracking,
    spectrumSweeping: spectrumAnalyzer.isSweeping,
  });
});

// --- OpenAPI / Swagger ---
app.get('/api/docs/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

// Serve Swagger UI
app.get('/api/docs', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>SignalForge API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs/openapi.json', dom_id: '#swagger-ui', deepLinking: true, presets: [SwaggerUIBundle.presets.apis], layout: 'StandaloneLayout' })</script>
</body></html>`);
});

// --- SDR Device Management ---
app.get('/api/sdr/devices', (_req, res) => {
  const devices = [...sdrBridge.getDevices()];

  // Add connected rtl_tcp devices
  for (const [, conn] of rtlTcpConnections) {
    const info = conn.getConnectionInfo();
    devices.push({
      id: info.id,
      name: `RTL-TCP ${info.host}:${info.port} (${info.deviceInfo?.tunerType || 'connecting'})`,
      type: 'rtlsdr' as const,
      serial: info.id,
      available: info.connected,
      remote: true,
      host: info.host,
      port: info.port,
      sampleRates: [250000, 1000000, 2000000, 2400000, 3200000],
      frequencyRange: { min: 24e6, max: 1766e6 },
      gainRange: { min: 0, max: 50 },
    });
  }

  // Add connected SoapySDR devices
  for (const [, conn] of soapyConnections) {
    const info = conn.getConnectionInfo();
    devices.push({
      id: info.id,
      name: `SoapySDR ${info.host}:${info.port} (${info.driver})`,
      type: 'soapy' as const,
      serial: info.id,
      available: info.connected,
      remote: true,
      host: info.host,
      port: info.port,
      sampleRates: info.sampleRates,
      frequencyRange: info.frequencyRange,
      gainRange: { min: 0, max: 62 },
    });
  }

  res.json(devices);
});

app.post('/api/sdr/connect', async (req, res) => {
  const { host, port } = req.body;
  if (!host) return res.status(400).json({ error: 'host required' });
  const p = port || 1234;

  try {
    const client = new RtlTcpClient(host, p);

    client.on('iq_data', (data) => {
      // Convert float32 to buffer and broadcast binary
      const buf = Buffer.from(data.samples.buffer);
      broadcastBinary(buf);
      // Also broadcast metadata
      broadcast({
        type: 'iq_meta',
        sampleRate: data.sampleRate,
        centerFrequency: data.centerFrequency,
        timestamp: data.timestamp,
      });
    });

    client.on('disconnected', () => {
      rtlTcpConnections.delete(client.id);
      broadcast({ type: 'sdr_disconnected', id: client.id });
    });

    const info = await client.connect();
    rtlTcpConnections.set(client.id, client);
    broadcast({ type: 'sdr_connected', connection: info });

    addActivity({ type: 'system', icon: '📡', title: 'SDR Connected', detail: `RTL-TCP ${host}:${p}`, timestamp: Date.now() });

    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sdr/connections', (_req, res) => {
  const connections = [];
  for (const [, conn] of rtlTcpConnections) {
    connections.push({ type: 'rtltcp', ...conn.getConnectionInfo() });
  }
  for (const [, conn] of soapyConnections) {
    connections.push({ type: 'soapy', ...conn.getConnectionInfo() });
  }
  res.json(connections);
});

app.post('/api/sdr/disconnect/:id', (req, res) => {
  const { id } = req.params;
  const rtl = rtlTcpConnections.get(id);
  if (rtl) {
    rtl.disconnect();
    rtlTcpConnections.delete(id);
    broadcast({ type: 'sdr_disconnected', id });
    return res.json({ ok: true });
  }
  const soapy = soapyConnections.get(id);
  if (soapy) {
    soapy.disconnect();
    soapyConnections.delete(id);
    return res.json({ ok: true });
  }
  res.status(404).json({ error: 'Connection not found' });
});

app.post('/api/sdr/frequency', (req, res) => {
  const { connectionId, frequency } = req.body;
  if (!frequency) return res.status(400).json({ error: 'frequency required' });

  if (connectionId) {
    const rtl = rtlTcpConnections.get(connectionId);
    if (rtl) { rtl.setFrequency(frequency); return res.json({ ok: true }); }
    const soapy = soapyConnections.get(connectionId);
    if (soapy) { soapy.setFrequency(frequency); return res.json({ ok: true }); }
    return res.status(404).json({ error: 'Connection not found' });
  }

  // Set on all connections
  for (const [, c] of rtlTcpConnections) c.setFrequency(frequency);
  for (const [, c] of soapyConnections) c.setFrequency(frequency);
  res.json({ ok: true });
});

app.post('/api/sdr/gain', (req, res) => {
  const { connectionId, gain } = req.body;
  if (gain === undefined) return res.status(400).json({ error: 'gain required' });
  // Try multiplexer first (primary SDR path)
  if ((sdrMultiplexer as any).connected && (sdrMultiplexer as any).client) {
    (sdrMultiplexer as any).client.setGain(gain);
    return res.json({ ok: true, source: 'multiplexer', gain });
  }
  const rtl = connectionId ? rtlTcpConnections.get(connectionId) : rtlTcpConnections.values().next().value;
  if (rtl) { rtl.setGain(gain); return res.json({ ok: true, source: 'direct', gain }); }
  res.status(404).json({ error: 'No SDR connection' });
});

app.post('/api/sdr/samplerate', (req, res) => {
  const { connectionId, sampleRate } = req.body;
  if (!sampleRate) return res.status(400).json({ error: 'sampleRate required' });
  const rtl = connectionId ? rtlTcpConnections.get(connectionId) : rtlTcpConnections.values().next().value;
  if (rtl) { rtl.setSampleRate(sampleRate); return res.json({ ok: true }); }
  res.status(404).json({ error: 'No SDR connection' });
});

app.post('/api/sdr/agc', (req, res) => {
  const { connectionId, enabled } = req.body;
  const rtl = connectionId ? rtlTcpConnections.get(connectionId) : rtlTcpConnections.values().next().value;
  if (rtl) { rtl.setAGC(!!enabled); return res.json({ ok: true }); }
  res.status(404).json({ error: 'No SDR connection' });
});

// ── SDR Multiplexer endpoints ──
app.get('/api/sdr/multiplexer/status', (_req, res) => {
  res.json(sdrMultiplexer.getStatus());
});

app.get('/api/sdr/multiplexer/flow', (_req, res) => {
  // Return the multiplexer's current state as a flow graph for the FlowEditor
  const status = sdrMultiplexer.getStatus();
  const nodes: any[] = [];
  const connections: any[] = [];
  let y = 200;

  // Source node
  nodes.push({
    id: 'mux-sdr-source',
    type: 'sdr_source',
    position: { x: 80, y: 200 },
    params: { freq: status.centerFreq, rate: status.sampleRate, label: 'RTL-SDR (Multiplexed)' },
  });

  // FFT/Waterfall branch
  nodes.push({ id: 'mux-fft', type: 'fft', position: { x: 340, y: 80 }, params: { size: status.fftSize } });
  nodes.push({ id: 'mux-waterfall', type: 'waterfall', position: { x: 580, y: 80 }, params: {} });
  connections.push({ id: 'c-sdr-fft', from: 'mux-sdr-source', fromPort: 'iq-out-0', to: 'mux-fft', toPort: 'iq-in-0' });
  connections.push({ id: 'c-fft-wf', from: 'mux-fft', fromPort: 'fft-out-0', to: 'mux-waterfall', toPort: 'fft-in-0' });

  // Virtual receivers
  for (const rx of status.receivers) {
    y += 160;
    const dcId = `mux-dc-${rx.id}`;
    const demodId = `mux-demod-${rx.id}`;
    nodes.push({
      id: dcId, type: 'downconverter',
      position: { x: 340, y },
      params: { centerFreq: rx.centerFreq, bandwidth: rx.bandwidth, outputRate: rx.outputRate },
    });
    connections.push({ id: `c-sdr-${rx.id}`, from: 'mux-sdr-source', fromPort: 'iq-out-0', to: dcId, toPort: 'iq-in-0' });

    nodes.push({
      id: demodId, type: 'fm_demod',
      position: { x: 580, y },
      params: { mode: rx.mode, bandwidth: rx.bandwidth },
    });
    connections.push({ id: `c-dc-demod-${rx.id}`, from: dcId, fromPort: 'iq-out-0', to: demodId, toPort: 'iq-in-0' });

    if (rx.decoder === 'multimon-ng') {
      const decId = `mux-pocsag-${rx.id}`;
      nodes.push({ id: decId, type: 'pocsag_decoder', position: { x: 820, y }, params: {} });
      connections.push({ id: `c-demod-dec-${rx.id}`, from: demodId, fromPort: 'audio-out-0', to: decId, toPort: 'audio-in-0' });
    }
  }

  res.json({ id: 'sdr-multiplexer', name: 'SDR Multiplexer', nodes, connections, auto: true });
});


app.post('/api/sdr/multiplexer/receiver', (req, res) => {
  try {
    const rx = sdrMultiplexer.addReceiver(req.body);
    res.json(rx.getStatus());
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/sdr/multiplexer/receiver/:id', (req, res) => {
  const ok = sdrMultiplexer.removeReceiver(req.params.id);
  res.json({ success: ok });
});

app.post('/api/sdr/multiplexer/receiver/:id/tune', (req, res) => {
  const ok = sdrMultiplexer.retuneReceiver(req.params.id, req.body.centerFreq);
  res.json({ success: ok });
});

app.post('/api/sdr/multiplexer/reconnect', async (_req, res) => {
  try {
    const ok = await sdrMultiplexer.autoStart();
    res.json({ success: ok, status: sdrMultiplexer.getStatus() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sdr/mux-devices', (_req, res2) => {
  const detection = sdrMultiplexer.detectDevice();
  const muxStatus = sdrMultiplexer.getStatus();
  res2.json({
    detected: detection.found,
    info: detection.info,
    multiplexer: muxStatus,
  });
});

// --- SoapySDR ---
app.post('/api/soapy/connect', async (req, res) => {
  const { host, port, driver } = req.body;
  if (!host) return res.status(400).json({ error: 'host required' });

  try {
    const client = new SoapyClient(host, port, driver);

    client.on('iq_data', (data) => {
      const buf = Buffer.from(data.samples.buffer);
      broadcastBinary(buf);
    });

    client.on('disconnected', () => {
      soapyConnections.delete(client.id);
    });

    const info = await client.connect();
    soapyConnections.set(client.id, client);
    broadcast({ type: 'soapy_connected', connection: info });

    addActivity({ type: 'system', icon: '📡', title: 'SoapySDR Connected', detail: `${host}:${port || 55132}`, timestamp: Date.now() });

    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/soapy/connections', (_req, res) => {
  const connections = [];
  for (const [, conn] of soapyConnections) connections.push(conn.getConnectionInfo());
  res.json(connections);
});

// --- Rotator Control ---
app.post('/api/rotator/connect', async (req, res) => {
  const { host, port } = req.body;
  if (!host) return res.status(400).json({ error: 'host required' });

  try {
    if (rotatorClient) rotatorClient.disconnect();
    rotatorClient = new RotatorClient(host, port);

    rotatorClient.on('position', (state) => {
      broadcast({ type: 'rotator_state', state });
    });

    rotatorClient.on('disconnected', () => {
      broadcast({ type: 'rotator_state', state: { connected: false, azimuth: 0, elevation: 0, moving: false } });
    });

    const state = await rotatorClient.connect();
    addActivity({ type: 'system', icon: '🎯', title: 'Rotator Connected', detail: `${host}:${port || 4533}`, timestamp: Date.now() });
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/rotator/state', (_req, res) => {
  res.json(rotatorClient?.getState() || { connected: false, azimuth: 0, elevation: 0, moving: false });
});

app.post('/api/rotator/position', async (req, res) => {
  const { azimuth, elevation } = req.body;
  if (!rotatorClient?.isConnected) return res.status(400).json({ error: 'Rotator not connected' });
  try {
    await rotatorClient.setPosition(azimuth || 0, elevation || 0);
    res.json(rotatorClient.getState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/rotator/stop', async (_req, res) => {
  if (!rotatorClient?.isConnected) return res.status(400).json({ error: 'Rotator not connected' });
  await rotatorClient.stop();
  res.json(rotatorClient.getState());
});

app.post('/api/rotator/park', async (_req, res) => {
  if (!rotatorClient?.isConnected) return res.status(400).json({ error: 'Rotator not connected' });
  await rotatorClient.park();
  res.json(rotatorClient.getState());
});

app.post('/api/rotator/disconnect', (_req, res) => {
  if (rotatorClient) {
    rotatorClient.disconnect();
    rotatorClient = null;
  }
  res.json({ ok: true });
});

// --- Doppler Correction ---
app.post('/api/doppler/start', async (req, res) => {
  const { satelliteCatalogNumber, satelliteName, frequency } = req.body;
  if (!frequency) return res.status(400).json({ error: 'frequency required' });

  dopplerService.startTracking(
    satelliteName || `SAT-${satelliteCatalogNumber}`,
    frequency,
    () => {
      if (!satelliteCatalogNumber) return null;
      const pos = satelliteService.getPosition(satelliteCatalogNumber);
      if (!pos) return null;
      return { name: satelliteName, latitude: pos.latitude, longitude: pos.longitude, altitude: pos.altitude };
    },
    () => locationService.getObserver(),
  );

  // Auto-tune SDR with Doppler correction
  dopplerService.on('correction', (correction) => {
    for (const [, c] of rtlTcpConnections) c.setFrequency(correction.correctedFrequency);
    for (const [, c] of soapyConnections) c.setFrequency(correction.correctedFrequency);

    // Auto-track with rotator
    if (rotatorClient?.isConnected && satelliteCatalogNumber) {
      const pos = satelliteService.getPosition(satelliteCatalogNumber);
      if (pos) {
        // Calculate az/el from observer to satellite
        const obs = locationService.getObserver();
        const { azimuth, elevation } = calculateAzEl(obs, pos);
        if (elevation > 0) {
          rotatorClient.setPosition(azimuth, elevation);
        }
      }
    }
  });

  addActivity({ type: 'system', icon: '🎯', title: 'Doppler tracking started', detail: `${satelliteName} @ ${(frequency / 1e6).toFixed(3)} MHz`, timestamp: Date.now() });

  res.json({ ok: true, tracking: true });
});

app.post('/api/doppler/stop', (_req, res) => {
  dopplerService.stopTracking();
  res.json({ ok: true, tracking: false });
});

app.get('/api/doppler/status', (_req, res) => {
  res.json({
    tracking: dopplerService.isTracking,
    correction: dopplerService.currentCorrection,
  });
});

// --- Spectrum Analyzer ---
app.post('/api/spectrum/sweep/start', (req, res) => {
  const config = {
    startFrequency: req.body.startFrequency || 87.5e6,
    endFrequency: req.body.endFrequency || 108e6,
    stepSize: req.body.stepSize || 100e3,
    dwellTime: req.body.dwellTime || 50,
    rbw: req.body.rbw || 10e3,
    fftSize: req.body.fftSize || 4096,
  };

  // Connect to SDR tuning if available
  const firstRtl = rtlTcpConnections.values().next().value;
  if (firstRtl) {
    spectrumAnalyzer.setTuneCallback((freq) => firstRtl.setFrequency(freq));
  }

  spectrumAnalyzer.startSweep(config);
  res.json({ ok: true, config });
});

app.post('/api/spectrum/sweep/stop', (_req, res) => {
  spectrumAnalyzer.stopSweep();
  res.json({ ok: true });
});

app.get('/api/spectrum/signals', (_req, res) => {
  res.json(spectrumAnalyzer.getDetectedSignals());
});

// --- Observation Scheduler ---
app.get('/api/observations', (req, res) => {
  const status = req.query.status as string | undefined;
  res.json(observationScheduler.getObservations(status));
});

app.post('/api/observations', async (req, res) => {
  try {
    const scheduled = await observationScheduler.scheduleObservation(req.body);
    res.json(scheduled);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/observations/:id/cancel', (req, res) => {
  observationScheduler.cancelObservation(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/observations/:id', (req, res) => {
  observationScheduler.deleteObservation(req.params.id);
  res.json({ ok: true });
});

// --- MQTT ---
app.get('/api/mqtt/status', (_req, res) => {
  res.json(mqttClient.getConfig());
});

app.post('/api/mqtt/connect', async (req, res) => {
  const { broker, port, username, password } = req.body;
  if (!broker) return res.status(400).json({ error: 'broker required' });
  try {
    const config = await mqttClient.connect(broker, port || 1883, username, password);
    addActivity({ type: 'system', icon: '📡', title: 'MQTT Connected', detail: `${broker}:${port || 1883}`, timestamp: Date.now() });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/mqtt/disconnect', (_req, res) => {
  mqttClient.disconnect();
  res.json({ ok: true });
});

app.post('/api/mqtt/publish', (req, res) => {
  const { topic, payload, qos } = req.body;
  if (!topic || !payload) return res.status(400).json({ error: 'topic and payload required' });
  mqttClient.publish(topic, payload, qos || 0);
  res.json({ ok: true });
});

app.post('/api/mqtt/subscribe', (req, res) => {
  const { topic, qos } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });
  mqttClient.subscribe(topic, qos || 0);
  res.json({ ok: true });
});

app.get('/api/mqtt/messages', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(mqttClient.getMessages(limit));
});

app.post('/api/mqtt/topics', (req, res) => {
  mqttClient.addTopicConfig(req.body);
  res.json({ ok: true });
});

app.delete('/api/mqtt/topics/:topic', (req, res) => {
  mqttClient.removeTopicConfig(decodeURIComponent(req.params.topic));
  res.json({ ok: true });
});

// --- Location / Observer ---
app.get('/api/settings/location', (_req, res) => {
  res.json(locationService.getSettings());
});

app.post('/api/settings/location', (req, res) => {
  try {
    locationService.updateSettings(req.body);
    res.json(locationService.getSettings());
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get('/api/observer', (_req, res) => {
  res.json(locationService.getObserver());
});

app.post('/api/observer', (req, res) => {
  const { latitude, longitude, altitude, name, source } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'latitude and longitude required as numbers' });
  }
  locationService.setLocation({ latitude, longitude, altitude: altitude || 0, name, source: source || 'manual' });
  res.json(locationService.getObserver());
});

// --- Geocoding proxy ---
app.get('/api/geocode', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: 'q parameter required' });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`, {
      headers: { 'User-Agent': 'SignalForge/0.4' },
    });
    const results = await response.json();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/devices', (_req, res) => {
  res.json(sdrBridge.getDevices());
});

// --- Satellites ---
app.get('/api/satellites', async (req, res) => {
  try {
    const search = (req.query.search as string || '').toLowerCase();
    const limit = parseInt(req.query.limit as string) || 200;
    let satellites = await satelliteService.getSatellites();
    if (search) satellites = satellites.filter(s => s.name.toLowerCase().includes(search));
    res.json(satellites.slice(0, limit));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/satellites/positions', async (req, res) => {
  try {
    const search = (req.query.search as string || '').toLowerCase();
    const limit = parseInt(req.query.limit as string) || 100;
    let sats = await satelliteService.getSatellites();
    if (search) sats = sats.filter(s => s.name.toLowerCase().includes(search));
    sats = sats.slice(0, limit);
    const positions = sats.map(s => {
      const pos = satelliteService.getPosition(s.catalogNumber);
      return pos ? { ...s, position: pos } : null;
    }).filter(Boolean);
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/satellites/:id/passes', async (req, res) => {
  const catalogNumber = parseInt(req.params.id);
  const obs = locationService.getObserver();
  const lat = parseFloat(req.query.lat as string) || obs.latitude;
  const lon = parseFloat(req.query.lon as string) || obs.longitude;
  const alt = parseFloat(req.query.alt as string) || obs.altitude;
  const hours = parseFloat(req.query.hours as string) || 24;
  try {
    const passes = await satelliteService.predictPassesForSat(catalogNumber, { name: 'Observer', latitude: lat, longitude: lon, altitude: alt }, hours);
    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/satellites/passes', async (req, res) => {
  const obs = locationService.getObserver();
  const lat = parseFloat(req.query.lat as string) || obs.latitude;
  const lon = parseFloat(req.query.lon as string) || obs.longitude;
  const alt = parseFloat(req.query.alt as string) || obs.altitude;
  const hours = parseFloat(req.query.hours as string) || 12;
  try {
    const passes = await satelliteService.predictPasses(
      { name: 'Observer', latitude: lat, longitude: lon, altitude: alt },
      hours
    );
    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Decoders ---
app.get('/api/aircraft', (_req, res) => res.json(adsbDecoder.getAircraft()));
app.get('/api/acars', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(acarsDecoder.getMessages(limit));
});
app.get('/api/vessels', (_req, res) => res.json(aisDecoder.getVessels()));
app.get('/api/aprs', (_req, res) => res.json(aprsDecoder.getStations()));

// --- Signal Database ---
app.get('/api/signals', (req, res) => {
  const query = req.query.q as string | undefined;
  const category = req.query.category as string | undefined;
  res.json(signalDb.getSignals(query, category));
});

app.get('/api/signals/identify', (req, res) => {
  const freq = parseFloat(req.query.freq as string);
  if (isNaN(freq)) return res.status(400).json({ error: 'freq parameter required' });
  const tolerance = parseFloat(req.query.tolerance as string) || 500e3;
  res.json(signalDb.identifyFrequency(freq, tolerance));
});

// --- Bookmarks ---
app.get('/api/bookmarks', (_req, res) => res.json(signalDb.getBookmarks()));
app.post('/api/bookmarks', (req, res) => res.json(signalDb.addBookmark(req.body)));
app.delete('/api/bookmarks/:id', (req, res) => {
  signalDb.removeBookmark(req.params.id);
  res.json({ ok: true });
});

// --- Recordings (SQLite-backed) ---
app.get('/api/recordings', (_req, res) => res.json(waterfallRecorder.getAllRecordings()));
app.post('/api/recordings/start', (req, res) => {
  const { frequency, mode, sampleRate, name } = req.body;
  res.json(waterfallRecorder.startRecording({ name: name || `Recording ${new Date().toISOString()}`, frequency: frequency || 100e6, mode: mode || 'FM', sampleRate }));
});
app.post('/api/recordings/stop', (_req, res) => {
  const active = waterfallRecorder.getActiveRecordings();
  if (active.length === 0) return res.status(404).json({ error: 'No active recording' });
  res.json(waterfallRecorder.stopRecording(active[0].id));
});
app.get('/api/recordings/:id/play', (req, res) => {
  const filePath = waterfallRecorder.getRecordingFilePath(req.params.id);
  if (!filePath) return res.status(404).json({ error: 'Recording not found' });
  try {
    const stat = require('fs').statSync(filePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    require('fs').createReadStream(filePath).pipe(res);
  } catch { res.status(404).json({ error: 'File not found' }); }
});
app.delete('/api/recordings/:id', (req, res) => {
  waterfallRecorder.deleteRecording(req.params.id);
  res.json({ ok: true });
});

// --- Notifications ---
app.get('/api/notifications', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(signalDb.getNotifications(limit));
});
app.get('/api/notifications/configs', (_req, res) => res.json(signalDb.getNotificationConfigs()));
app.post('/api/notifications/configs', (req, res) => {
  signalDb.setNotificationConfig(req.body);
  res.json({ ok: true });
});
app.post('/api/notifications/:id/read', (req, res) => {
  signalDb.markNotificationRead(req.params.id);
  res.json({ ok: true });
});

// --- Dashboard ---
app.get('/api/dashboard', async (_req, res) => {
  const sats = await satelliteService.getSatellites();
  const stats: DashboardStats = {
    satellitesTracked: sats.length,
    aircraftSeen: adsbDecoder.getAircraft().length,
    vesselsSeen: aisDecoder.getVessels().length,
    aprsStations: aprsDecoder.getStations().length,
    activeDecoders: 4,
    acarsMessages: acarsDecoder.getMessageCount(),
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
  };
  res.json(stats);
});

app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 30;
  res.json(activityFeed.slice(0, limit));
});

// --- Flow Save/Load ---
interface SavedFlow {
  id: string;
  name: string;
  nodes: unknown[];
  connections: unknown[];
  savedAt: number;
}
const savedFlows: SavedFlow[] = [];

app.get('/api/flows', (_req, res) => {
  res.json(savedFlows.map(f => ({ id: f.id, name: f.name, savedAt: f.savedAt, nodeCount: f.nodes.length })));
});

app.post('/api/flows', (req, res) => {
  const flow: SavedFlow = {
    id: req.body.id || `f${Date.now()}`,
    name: req.body.name || 'Untitled',
    nodes: req.body.nodes || [],
    connections: req.body.connections || [],
    savedAt: Date.now(),
  };
  const idx = savedFlows.findIndex(f => f.id === flow.id);
  if (idx >= 0) savedFlows[idx] = flow; else savedFlows.push(flow);
  res.json({ ok: true, id: flow.id });
});

app.delete('/api/flows/:id', (req, res) => {
  const idx = savedFlows.findIndex(f => f.id === req.params.id);
  if (idx >= 0) savedFlows.splice(idx, 1);
  res.json({ ok: true });
});


// --- Background Flows ---
const __dirname_bg = dirname(fileURLToPath(import.meta.url));
const BG_FLOWS_PATH = join(__dirname_bg, '..', 'config', 'background-flows.json');

interface BackgroundFlow {
  id: string;
  name: string;
  description: string;
  locked: boolean;
  autoStart: boolean;
  category: string;
  icon: string;
  nodes: unknown[];
  edges: unknown[];
  status?: 'running' | 'stopped' | 'error';
}

let backgroundFlows: BackgroundFlow[] = [];
try {
  if (existsSync(BG_FLOWS_PATH)) {
    const raw = JSON.parse(readFileSync(BG_FLOWS_PATH, 'utf-8'));
    backgroundFlows = (raw.flows || []).map((f: BackgroundFlow) => ({
      ...f,
      status: f.autoStart ? 'running' : 'stopped',
    }));
    console.log(`📋 Loaded ${backgroundFlows.length} background flows`);
  }
} catch (err: any) {
  console.error(`📋 Failed to load background flows: ${err.message}`);
}

// If multiplexer is running, mark pager-decoder as running
sdrMultiplexer.on('connected', () => {
  const pf = backgroundFlows.find(f => f.id === 'pager-decoder');
  if (pf) pf.status = 'running';
});
sdrMultiplexer.on('disconnected', () => {
  const pf = backgroundFlows.find(f => f.id === 'pager-decoder');
  if (pf) pf.status = 'stopped';
});

app.get('/api/background-flows', (_req, res) => {
  res.json(backgroundFlows.map(f => ({
    id: f.id, name: f.name, description: f.description, locked: f.locked,
    autoStart: f.autoStart, category: f.category, icon: f.icon,
    status: f.status || 'stopped', nodeCount: f.nodes.length, edgeCount: f.edges.length,
  })));
});

app.get('/api/background-flows/:id', (req, res) => {
  const flow = backgroundFlows.find(f => f.id === req.params.id);
  if (!flow) return res.status(404).json({ error: 'Not found' });
  res.json(flow);
});

app.post('/api/background-flows/:id/lock', (req, res) => {
  const flow = backgroundFlows.find(f => f.id === req.params.id);
  if (!flow) return res.status(404).json({ error: 'Not found' });
  flow.locked = req.body.locked !== false;
  // Persist
  try {
    writeFileSync(BG_FLOWS_PATH, JSON.stringify({ flows: backgroundFlows }, null, 2));
  } catch {}
  res.json({ ok: true, locked: flow.locked });
});

app.put('/api/background-flows/:id', (req, res) => {
  const flow = backgroundFlows.find(f => f.id === req.params.id);
  if (!flow) return res.status(404).json({ error: 'Not found' });
  if (flow.locked) return res.status(403).json({ error: 'Flow is locked — unlock first' });
  if (req.body.nodes) flow.nodes = req.body.nodes;
  if (req.body.edges) flow.edges = req.body.edges;
  if (req.body.name) flow.name = req.body.name;
  if (req.body.description) flow.description = req.body.description;
  try {
    writeFileSync(BG_FLOWS_PATH, JSON.stringify({ flows: backgroundFlows }, null, 2));
  } catch {}
  res.json({ ok: true });
});

app.get('/api/flows/all', (_req, res) => {
  // Combined view: background + user flows
  const bg = backgroundFlows.map(f => ({
    id: f.id, name: f.name, type: 'background' as const, icon: f.icon,
    status: f.status, locked: f.locked, nodeCount: f.nodes.length,
  }));
  const user = savedFlows.map(f => ({
    id: f.id, name: f.name, type: 'user' as const, icon: '📐',
    status: 'stopped' as const, locked: false, nodeCount: f.nodes.length,
  }));
  res.json([...bg, ...user]);
});

// --- Flowgraph presets ---
app.get('/api/presets', (_req, res) => {
  res.json([
    {
      id: 'adsb-tracker', name: 'ADS-B Tracker', description: 'Track aircraft with Mode-S/ADS-B decoding',
      icon: '✈️', category: 'decoder',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 1090e6, rate: 2e6 } },
        { type: 'adsb_decoder', position: { x: 340, y: 200 }, params: {} },
        { type: 'fft', position: { x: 340, y: 80 }, params: { size: 4096 } },
        { type: 'waterfall', position: { x: 580, y: 80 }, params: {} },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 1, targetPort: 'iq-in-0' },
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 2, targetPort: 'iq-in-0' },
        { sourceNode: 2, sourcePort: 'fft-out-0', targetNode: 3, targetPort: 'fft-in-0' },
      ],
    },
    {
      id: 'satellite-monitor', name: 'Satellite Doppler Monitor', description: 'Track satellites with Doppler correction',
      icon: '🛰️', category: 'satellite',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 137.5e6, rate: 1e6 } },
        { type: 'sat_tracker', position: { x: 80, y: 380 }, params: {} },
        { type: 'doppler', position: { x: 340, y: 200 }, params: {} },
        { type: 'fm_demod', position: { x: 580, y: 200 }, params: { bandwidth: 50000 } },
        { type: 'apt_decoder', position: { x: 820, y: 200 }, params: {} },
        { type: 'fft', position: { x: 340, y: 80 }, params: { size: 4096 } },
        { type: 'waterfall', position: { x: 580, y: 80 }, params: {} },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 2, targetPort: 'iq-in-0' },
        { sourceNode: 1, sourcePort: 'control-out-0', targetNode: 2, targetPort: 'control-in-0' },
        { sourceNode: 2, sourcePort: 'iq-out-0', targetNode: 3, targetPort: 'iq-in-0' },
        { sourceNode: 3, sourcePort: 'audio-out-0', targetNode: 4, targetPort: 'audio-in-0' },
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 5, targetPort: 'iq-in-0' },
        { sourceNode: 5, sourcePort: 'fft-out-0', targetNode: 6, targetPort: 'fft-in-0' },
      ],
    },
    {
      id: 'spectrum-analyzer', name: 'Wideband Spectrum Analyzer', description: 'Full-width spectrum sweep with signal detection',
      icon: '📊', category: 'analysis',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 100e6, rate: 2.4e6 } },
        { type: 'fft', position: { x: 340, y: 120 }, params: { size: 8192 } },
        { type: 'waterfall', position: { x: 580, y: 80 }, params: {} },
        { type: 'spectrum', position: { x: 580, y: 250 }, params: {} },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 1, targetPort: 'iq-in-0' },
        { sourceNode: 1, sourcePort: 'fft-out-0', targetNode: 2, targetPort: 'fft-in-0' },
        { sourceNode: 1, sourcePort: 'fft-out-0', targetNode: 3, targetPort: 'fft-in-0' },
      ],
    },
    {
      id: 'fm-receiver', name: 'FM Broadcast Receiver', description: 'Receive and demodulate FM radio with audio output',
      icon: '📻', category: 'receiver',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 97.6e6, rate: 2.4e6 } },
        { type: 'fm_demod', position: { x: 340, y: 200 }, params: { bandwidth: 200000 } },
        { type: 'audio_out', position: { x: 580, y: 200 }, params: {} },
        { type: 'fft', position: { x: 340, y: 80 }, params: { size: 4096 } },
        { type: 'waterfall', position: { x: 580, y: 80 }, params: {} },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 1, targetPort: 'iq-in-0' },
        { sourceNode: 1, sourcePort: 'audio-out-0', targetNode: 2, targetPort: 'audio-in-0' },
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 3, targetPort: 'iq-in-0' },
        { sourceNode: 3, sourcePort: 'fft-out-0', targetNode: 4, targetPort: 'fft-in-0' },
      ],
    },
    {
      id: 'mqtt-bridge', name: 'MQTT Data Bridge', description: 'Stream decoded data to MQTT broker',
      icon: '🔗', category: 'output',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 144.8e6, rate: 250000 } },
        { type: 'fm_demod', position: { x: 340, y: 200 }, params: { bandwidth: 12500 } },
        { type: 'aprs_decoder', position: { x: 580, y: 200 }, params: {} },
        { type: 'mqtt_sink', position: { x: 820, y: 200 }, params: { topic: 'signalforge/aprs' } },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 1, targetPort: 'iq-in-0' },
        { sourceNode: 1, sourcePort: 'audio-out-0', targetNode: 2, targetPort: 'audio-in-0' },
        { sourceNode: 2, sourcePort: 'packets-out-0', targetNode: 3, targetPort: 'any-in-0' },
      ],
    },
    {
      id: 'pager-decoder', name: 'Pager Decoder (POCSAG/FLEX)', description: 'Decode pager messages from 153.350 MHz via SDR Multiplexer',
      icon: '📟', category: 'decoder',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 153.35e6, rate: 2.048e6, label: 'RTL-SDR' } },
        { type: 'downconverter', position: { x: 340, y: 200 }, params: { centerFreq: 153.35e6, bandwidth: 12500 } },
        { type: 'fm_demod', position: { x: 580, y: 200 }, params: { bandwidth: 12500, mode: 'NFM' } },
        { type: 'pocsag_decoder', position: { x: 820, y: 200 }, params: {} },
        { type: 'fft', position: { x: 340, y: 80 }, params: { size: 2048 } },
        { type: 'waterfall', position: { x: 580, y: 80 }, params: {} },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 1, targetPort: 'iq-in-0' },
        { sourceNode: 1, sourcePort: 'iq-out-0', targetNode: 2, targetPort: 'iq-in-0' },
        { sourceNode: 2, sourcePort: 'audio-out-0', targetNode: 3, targetPort: 'audio-in-0' },
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 4, targetPort: 'iq-in-0' },
        { sourceNode: 4, sourcePort: 'fft-out-0', targetNode: 5, targetPort: 'fft-in-0' },
      ],
    },
  ]);
});

// ============================================================================
// REST API — Multi-User
// ============================================================================
app.post('/api/users/join', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: 'nickname required' });
  const session = sessionManager.createSession(nickname);
  res.json(session);
});

app.get('/api/users', (_req, res) => {
  res.json(sessionManager.getOnlineUsers());
});

app.post('/api/users/tuning', (req, res) => {
  const { token, frequency, mode, description } = req.body;
  const session = sessionManager.getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  sessionManager.updateTuning(session.id, { frequency, mode, description });
  res.json({ ok: true });
});

app.get('/api/chat', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(sessionManager.getChatHistory(limit));
});

app.post('/api/chat', (req, res) => {
  const { token, text } = req.body;
  const session = sessionManager.getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  const msg = sessionManager.addChatMessage(session.id, text);
  res.json(msg);
});

app.get('/api/shared-observations', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(sessionManager.getObservations(limit));
});

app.post('/api/shared-observations', (req, res) => {
  const { token, frequency, mode, description, signalStrength, tags } = req.body;
  const session = sessionManager.getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  const obs = sessionManager.addObservation(session.id, { frequency, mode, description, signalStrength, tags });
  res.json(obs);
});

app.post('/api/flowgraphs/export', (req, res) => {
  const { name, description, nodes, connections, token } = req.body;
  const session = token ? sessionManager.getSession(token) : null;
  const exported = {
    id: `fg-${Date.now()}`, name, description,
    version: '0.5.0', author: session?.nickname || 'Anonymous',
    created: Date.now(), nodes, connections,
  };
  res.json(exported);
});

// ============================================================================
// REST API — Plugins
// ============================================================================
app.get('/api/plugins', (_req, res) => {
  res.json(pluginLoader.getPlugins());
});

app.get('/api/plugins/status', (_req, res) => {
  res.json(pluginLoader.getPluginStatus());
});

app.get('/api/plugins/nodes', (_req, res) => {
  res.json(pluginLoader.getPluginNodes());
});

app.post('/api/plugins/:id/enable', (req, res) => {
  const ok = pluginLoader.enablePlugin(req.params.id);
  res.json({ ok });
});

app.post('/api/plugins/:id/disable', (req, res) => {
  const ok = pluginLoader.disablePlugin(req.params.id);
  res.json({ ok });
});

// Dynamic filesystem plugins from data/plugins/
import { readdirSync } from 'fs';
const PLUGINS_DIR = join(process.cwd(), 'data', 'plugins');
const fsPlugins = new Map<string, { manifest: any; enabled: boolean }>();
function scanFilePlugins() {
  if (!existsSync(PLUGINS_DIR)) return;
  try {
    for (const dir of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const manifestPath = join(PLUGINS_DIR, dir.name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.id = manifest.id || dir.name;
        manifest.dirName = dir.name;
        fsPlugins.set(manifest.id, { manifest, enabled: true });
      } catch {}
    }
  } catch {}
}
scanFilePlugins();
app.get('/api/plugins/filesystem', (_req, res) => {
  res.json(Array.from(fsPlugins.values()).map(p => ({ ...p.manifest, enabled: p.enabled })));
});
app.post('/api/plugins/filesystem/:id/enable', (req, res) => {
  const p = fsPlugins.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plugin not found' });
  p.enabled = true;
  res.json({ ok: true });
});
app.post('/api/plugins/filesystem/:id/disable', (req, res) => {
  const p = fsPlugins.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plugin not found' });
  p.enabled = false;
  res.json({ ok: true });
});
// Serve plugin JS files for client-side dynamic import
app.use('/api/plugins/assets', express.static(PLUGINS_DIR));
// Serve scanner recordings as static files
app.use("/recordings", express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "recordings")));

// ============================================================================
// REST API — Edge Nodes
// ============================================================================
app.get('/api/edge/nodes', (_req, res) => {
  res.json(edgeNodeManager.getNodes());
});

app.get('/api/edge/nodes/:id', (req, res) => {
  const node = edgeNodeManager.getNode(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node);
});

app.get('/api/edge/nodes/:id/telemetry', (req, res) => {
  const node = edgeNodeManager.getNode(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const limit = parseInt(req.query.limit as string) || 60;
  res.json(edgeNodeManager.getNodeTelemetry(req.params.id, limit));
});

app.post('/api/edge/nodes/:id/command', async (req, res) => {
  if (req.query.async === 'true') {
    const result = await edgeNodeManager.sendCommandAsync(req.params.id, req.body);
    res.json(result);
  } else {
    const ok = edgeNodeManager.sendCommand(req.params.id, req.body);
    res.json({ ok });
  }
});

app.delete('/api/edge/nodes/:id', (req, res) => {
  edgeNodeManager.removeNode(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// REST API — Frequency Scanner
// ============================================================================
app.get('/api/scanner/state', (_req, res) => {
  res.json(frequencyScanner.getState());
});

app.post('/api/scanner/start', (req, res) => {
  frequencyScanner.startScan(req.body.configId);
  res.json(frequencyScanner.getState());
});

app.post('/api/scanner/stop', (_req, res) => {
  frequencyScanner.stopScan();
  res.json(frequencyScanner.getState());
});

app.get('/api/scanner/configs', (_req, res) => {
  res.json(frequencyScanner.getConfigs());
});

app.post('/api/scanner/configs', (req, res) => {
  res.json(frequencyScanner.addConfig(req.body));
});

app.get('/api/scanner/list', (_req, res) => {
  res.json(frequencyScanner.getScanList());
});

app.post('/api/scanner/list', (req, res) => {
  res.json(frequencyScanner.addToScanList(req.body));
});

app.delete('/api/scanner/list/:id', (req, res) => {
  frequencyScanner.removeFromScanList(req.params.id);
  res.json({ ok: true });
});

app.get('/api/scanner/activities', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(frequencyScanner.getActivities(limit));
});

// ============================================================================
// REST API — Airport Scanner
// ============================================================================
app.get('/api/scanner/airport/status', (_req, res) => {
  res.json(airportScanner.getStatus());
});

app.post('/api/scanner/airport/start', (_req, res) => {
  const result = airportScanner.start();
  res.json(result);
});

app.post('/api/scanner/airport/stop', (_req, res) => {
  airportScanner.stop();
  res.json({ success: true });
});

app.get('/api/scanner/airport/channels', (_req, res) => {
  res.json(airportScanner.getChannels());
});

app.patch('/api/scanner/airport/channels/:freq', (req, res) => {
  const freq = parseInt(req.params.freq);
  const updated = airportScanner.updateChannel(freq, req.body);
  if (!updated) return res.status(404).json({ error: 'Channel not found' });
  res.json(updated);
});

app.post('/api/scanner/airport/channels', (req, res) => {
  const ch = airportScanner.addChannel(req.body);
  res.json(ch);
});

app.delete('/api/scanner/airport/channels/:freq', (req, res) => {
  const freq = parseInt(req.params.freq);
  const removed = airportScanner.removeChannel(freq);
  if (!removed) return res.status(404).json({ error: 'Channel not found' });
  res.json({ success: true });
});

app.get('/api/scanner/airport/recordings', (_req, res) => {
  res.json(airportScanner.getRecordings());
});

app.get('/api/scanner/airport/recordings/:id/audio', (req, res) => {
  const path = airportScanner.getRecordingPath(req.params.id);
  if (!path) return res.status(404).json({ error: 'Recording not found' });
  res.sendFile(path);
});

app.delete('/api/scanner/airport/recordings/:id', (req, res) => {
  const removed = airportScanner.deleteRecording(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Recording not found' });
  res.json({ success: true });
});

app.get('/api/scanner/airport/discovered', (_req, res) => {
  res.json(airportScanner.getDiscovered());
});

// ============================================================================
// REST API — Signal Classifier
// ============================================================================
app.post('/api/classifier/classify', (req, res) => {
  const { frequency } = req.body;
  if (!frequency) return res.status(400).json({ error: 'frequency required' });
  res.json(signalClassifier.classify(frequency));
});

app.get('/api/classifier/results', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(signalClassifier.getResults(limit));
});

app.get('/api/classifier/config', (_req, res) => {
  res.json(signalClassifier.getConfig());
});

app.post('/api/classifier/config', (req, res) => {
  signalClassifier.updateConfig(req.body);
  res.json(signalClassifier.getConfig());
});

app.post('/api/classifier/analyze', (req, res) => {
  const { spectrum, centerFreq, sampleRate } = req.body;
  if (!spectrum || !centerFreq || !sampleRate) return res.status(400).json({ error: 'spectrum, centerFreq, sampleRate required' });
  const signals = signalClassifier.analyzeSpectrum({ spectrum, centerFreq, sampleRate });
  res.json({ signals, timestamp: Date.now() });
});

app.get('/api/classifier/identify', (req, res) => {
  const freq = parseFloat(req.query.freq as string);
  const bw = parseFloat(req.query.bw as string);
  if (isNaN(freq) || isNaN(bw)) return res.status(400).json({ error: 'freq and bw query params required' });
  res.json(signalClassifier.identifyByCharacteristics(freq, bw));
});

// ============================================================================
// REST API — Timeline
// ============================================================================
app.get('/api/timeline', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 200;
  const offset = parseInt(req.query.offset as string) || 0;
  const types = req.query.types ? (req.query.types as string).split(',') : undefined;
  const search = req.query.search as string | undefined;
  res.json(timelineService.getEvents({ types: types as any, search }, limit, offset));
});

app.get('/api/timeline/export/:format', (req, res) => {
  const { format } = req.params;
  if (format === 'html') {
    res.setHeader('Content-Type', 'text/html');
    res.send(timelineService.exportHTML());
  } else if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.send(timelineService.exportJSON());
  } else {
    res.status(400).json({ error: 'Supported: html, json' });
  }
});

// ============================================================================
// REST API — Telemetry
// ============================================================================
app.get('/api/telemetry/frames', (req, res) => {
  const noradId = req.query.noradId ? parseInt(req.query.noradId as string) : undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(telemetryService.getFrames(noradId, limit));
});

app.get('/api/telemetry/latest/:noradId', (req, res) => {
  res.json(telemetryService.getLatestValues(parseInt(req.params.noradId)));
});

app.get('/api/telemetry/series/:noradId/:key', (req, res) => {
  const series = telemetryService.getTimeSeries(parseInt(req.params.noradId), req.params.key);
  if (!series) return res.status(404).json({ error: 'No data' });
  res.json(series);
});

app.get('/api/telemetry/definitions', (_req, res) => {
  res.json(telemetryService.getDefinitions());
});

// ============================================================================
// REST API — Phase 6: SatNOGS
// ============================================================================
app.get('/api/satnogs/observations', async (req, res) => {
  const satellite = req.query.satellite ? parseInt(req.query.satellite as string) : undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(await satnogsService.getObservations({ satellite, limit }));
});

app.get('/api/satnogs/transmitters/:noradId', async (req, res) => {
  res.json(await satnogsService.getTransmitters(parseInt(req.params.noradId)));
});

app.get('/api/satnogs/stations', async (_req, res) => {
  res.json(await satnogsService.getStations());
});

app.post('/api/satnogs/submit', async (req, res) => {
  res.json(await satnogsService.submitObservation(req.body));
});

app.post('/api/satnogs/auto-configure/:noradId', async (req, res) => {
  const config = await satnogsService.autoConfigureFlowgraph(parseInt(req.params.noradId), req.body.satelliteName || 'Unknown');
  if (!config) return res.status(404).json({ error: 'No transmitters found' });
  res.json(config);
});

// ============================================================================
// REST API — Phase 6: Waterfall Recording
// ============================================================================
app.post('/api/waterfall/record/start', (req, res) => {
  res.json(waterfallRecorder.startRecording(req.body));
});

app.post('/api/waterfall/record/:id/stop', (req, res) => {
  const rec = waterfallRecorder.stopRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json(rec);
});

app.get('/api/waterfall/recordings', (_req, res) => {
  res.json(waterfallRecorder.getActiveRecordings());
});

app.get('/api/waterfall/gallery', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(waterfallRecorder.getGallery(limit));
});

app.post('/api/waterfall/recordings/:id/annotate', (req, res) => {
  const ann = waterfallRecorder.addAnnotation(req.params.id, req.body);
  if (!ann) return res.status(404).json({ error: 'Recording not found' });
  res.json(ann);
});

app.delete('/api/waterfall/recordings/:id/annotations/:annId', (req, res) => {
  waterfallRecorder.removeAnnotation(req.params.id, req.params.annId);
  res.json({ ok: true });
});

app.delete('/api/waterfall/recordings/:id', (req, res) => {
  waterfallRecorder.deleteRecording(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// REST API — Phase 6: Geo-Fencing
// ============================================================================
app.get('/api/geofence/zones', (_req, res) => {
  res.json(geofenceService.getZones());
});

app.post('/api/geofence/zones', (req, res) => {
  res.json(geofenceService.addZone(req.body));
});

app.put('/api/geofence/zones/:id', (req, res) => {
  const zone = geofenceService.updateZone(req.params.id, req.body);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  res.json(zone);
});

app.delete('/api/geofence/zones/:id', (req, res) => {
  geofenceService.removeZone(req.params.id);
  res.json({ ok: true });
});

app.get('/api/geofence/alerts', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(geofenceService.getAlerts(limit));
});

app.post('/api/geofence/alerts/:id/ack', (req, res) => {
  res.json({ ok: geofenceService.acknowledgeAlert(req.params.id) });
});

// ============================================================================
// REST API — Phase 6: Digital Voice
// ============================================================================
app.get('/api/voice/decoders', (_req, res) => {
  res.json(voiceDecoder.getDecoderStates());
});

app.post('/api/voice/decoders/:protocol/enable', (req, res) => {
  const state = voiceDecoder.enableDecoder(req.params.protocol as any, req.body.frequency);
  if (!state) return res.status(404).json({ error: 'Unknown protocol' });
  res.json(state);
});

app.post('/api/voice/decoders/:protocol/disable', (req, res) => {
  const state = voiceDecoder.disableDecoder(req.params.protocol as any);
  if (!state) return res.status(404).json({ error: 'Unknown protocol' });
  res.json(state);
});

app.get('/api/voice/frames', (req, res) => {
  const protocol = req.query.protocol as string | undefined;
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(voiceDecoder.getFrames(protocol as any, limit));
});

app.get('/api/voice/talkgroups', (_req, res) => {
  res.json(voiceDecoder.getTalkgroups());
});

// ============================================================================
// REST API — Phase 6: Propagation
// ============================================================================
app.get('/api/propagation/solar', async (_req, res) => {
  const data = propagationService.getSolarData();
  if (!data) {
    res.json(await propagationService.fetchSolarData());
  } else {
    res.json(data);
  }
});

app.get('/api/propagation/bands', (_req, res) => {
  res.json(propagationService.getBandConditions());
});

app.get('/api/propagation/predict', (req, res) => {
  const from = (req.query.from as string) || 'IO91';
  const to = (req.query.to as string) || 'FN31';
  res.json(propagationService.predict(from, to));
});

app.get('/api/propagation/greyline', (_req, res) => {
  res.json(propagationService.getGreyline());
});

// ============================================================================
// REST API — Phase 6: Logbook
// ============================================================================
app.get('/api/logbook', (req, res) => {
  const opts = {
    callsign: req.query.callsign as string | undefined,
    band: req.query.band as string | undefined,
    mode: req.query.mode as string | undefined,
    search: req.query.search as string | undefined,
    limit: parseInt(req.query.limit as string) || 100,
    offset: parseInt(req.query.offset as string) || 0,
  };
  res.json(logbookService.getEntries(opts));
});

app.post('/api/logbook', (req, res) => {
  res.json(logbookService.addEntry(req.body));
});

app.put('/api/logbook/:id', (req, res) => {
  const entry = logbookService.updateEntry(req.params.id, req.body);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(entry);
});

app.delete('/api/logbook/:id', (req, res) => {
  logbookService.deleteEntry(req.params.id);
  res.json({ ok: true });
});

app.get('/api/logbook/stats', (_req, res) => {
  res.json(logbookService.getStats());
});

app.get('/api/logbook/export/adif', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename=signalforge-logbook.adi');
  res.send(logbookService.exportADIF());
});

app.post('/api/logbook/import/adif', (req, res) => {
  const content = req.body.content;
  if (!content) return res.status(400).json({ error: 'content required' });
  const count = logbookService.importADIF(content);
  res.json({ imported: count });
});

// ============================================================================
// REST API — Phase 6: Analytics
// ============================================================================
app.get('/api/analytics/heatmap', (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24;
  res.json(analyticsService.getHeatmap(hours));
});

app.get('/api/analytics/frequencies', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  res.json(analyticsService.getBusiestFrequencies(limit));
});

app.get('/api/analytics/decoders', (_req, res) => {
  res.json(analyticsService.getDecoderStats());
});

app.get('/api/analytics/nodes', (_req, res) => {
  res.json(analyticsService.getEdgeNodeMetrics());
});

app.get('/api/analytics/observations', (_req, res) => {
  res.json(analyticsService.getObservationStats());
});

app.get('/api/analytics/report', (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24;
  res.json(analyticsService.getReport(hours));
});

// ============================================================================
// REST API — Phase 6: DX Cluster
// ============================================================================
app.get('/api/dxcluster/config', (_req, res) => {
  res.json(dxClusterService.getConfig());
});

app.post('/api/dxcluster/connect', (req, res) => {
  res.json(dxClusterService.connect(req.body.host, req.body.port, req.body.callsign));
});

app.post('/api/dxcluster/disconnect', (_req, res) => {
  res.json(dxClusterService.disconnect());
});

app.get('/api/dxcluster/spots', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(dxClusterService.getSpots(limit));
});

app.post('/api/dxcluster/filters', (req, res) => {
  res.json(dxClusterService.addFilter(req.body));
});

app.delete('/api/dxcluster/filters/:id', (req, res) => {
  dxClusterService.removeFilter(req.params.id);
  res.json({ ok: true });
});

app.get('/api/dxcluster/alerts', (_req, res) => {
  res.json(dxClusterService.getAlerts());
});

app.post('/api/dxcluster/alerts', (req, res) => {
  res.json(dxClusterService.addAlert(req.body));
});

app.delete('/api/dxcluster/alerts/:id', (req, res) => {
  dxClusterService.removeAlert(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// REST API — Phase 6: Audio Streaming
// ============================================================================
app.get('/api/audio/streams', (_req, res) => {
  res.json(audioStreamingService.getStreams());
});

app.post('/api/audio/streams', (req, res) => {
  res.json(audioStreamingService.createStream(req.body));
});

app.post('/api/audio/streams/:id/stop', (req, res) => {
  res.json({ ok: audioStreamingService.stopStream(req.params.id) });
});

app.post('/api/audio/streams/:id/join', (req, res) => {
  res.json({ ok: audioStreamingService.joinStream(req.params.id) });
});

app.post('/api/audio/streams/:id/leave', (req, res) => {
  res.json({ ok: audioStreamingService.leaveStream(req.params.id) });
});

app.get('/api/audio/config', (_req, res) => {
  res.json(audioStreamingService.getConfig());
});

app.post('/api/audio/config', (req, res) => {
  res.json(audioStreamingService.updateConfig(req.body));
});

app.get('/api/audio/rooms', (_req, res) => {
  res.json(audioStreamingService.getChatRooms());
});

app.post('/api/audio/rooms', (req, res) => {
  res.json(audioStreamingService.createChatRoom(req.body.name, req.body.maxParticipants));
});

app.post('/api/audio/rooms/:id/join', (req, res) => {
  res.json({ ok: audioStreamingService.joinChatRoom(req.params.id, req.body.userId, req.body.nickname) });
});

app.post('/api/audio/rooms/:id/leave', (req, res) => {
  res.json({ ok: audioStreamingService.leaveChatRoom(req.params.id, req.body.userId) });
});

// ============================================================================
// REST API — Phase 7: rtl_433 IoT
// ============================================================================
app.get('/api/rtl433/devices', (_req, res) => res.json(rtl433Service.getDevices()));
app.get('/api/rtl433/devices/:id', (req, res) => {
  const dev = rtl433Service.getDevice(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  res.json(dev);
});
app.get('/api/rtl433/status', (_req, res) => res.json(rtl433Service.getStatus()));
app.get('/api/rtl433/config', (_req, res) => res.json(rtl433Service.getConfig()));
app.post('/api/rtl433/config', (req, res) => res.json(rtl433Service.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: Pager
// ============================================================================
app.get('/api/pager/messages', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const freq = req.query.freq ? parseFloat(req.query.freq as string) : undefined;
  const capcode = req.query.capcode ? parseInt(req.query.capcode as string) : undefined;
  const search = req.query.search as string | undefined;
  const since = req.query.since ? parseInt(req.query.since as string) : undefined;
  res.json(pagerService.getMessagesFromDb({ limit, offset, freq, capcode, search, since }));
});
app.get('/api/pager/stats', (_req, res) => res.json(pagerService.getStats()));
app.get('/api/pager/stats/db', (_req, res) => res.json(pagerService.getDbStats()));
app.get('/api/pager/stats/hourly', (_req, res) => res.json(pagerService.getHourlyStats()));
app.get('/api/pager/filters', (_req, res) => res.json(pagerService.getFilters()));
app.post('/api/pager/filters', (req, res) => res.json(pagerService.addFilter(req.body)));
app.delete('/api/pager/filters/:id', (req, res) => { pagerService.removeFilter(req.params.id); res.json({ ok: true }); });
app.get('/api/pager/alerts', (req, res) => res.json(pagerService.getAlerts(parseInt(req.query.limit as string) || 100)));
app.post('/api/pager/alerts/:id/ack', (req, res) => res.json({ ok: pagerService.acknowledgeAlert(req.params.id) }));
app.get('/api/pager/config', (_req, res) => res.json(pagerService.getConfig()));
app.post('/api/pager/config', (req, res) => res.json(pagerService.updateConfig(req.body)));

// Capcode endpoints
app.get('/api/pager/capcodes', (_req, res) => res.json(pagerService.getCapcodes()));
app.patch('/api/pager/capcodes/:capcode', (req, res) => {
  pagerService.updateCapcode(parseInt(req.params.capcode), req.body);
  res.json({ ok: true });
});

// Keyword alert endpoints
app.get('/api/pager/keyword-alerts', (_req, res) => res.json(pagerService.getKeywordAlerts()));
app.post('/api/pager/keyword-alerts', (req, res) => {
  const { keyword, category, priority } = req.body;
  res.json(pagerService.addKeywordAlert(keyword, category || '', priority || 'medium'));
});
app.delete('/api/pager/keyword-alerts/:id', (req, res) => {
  pagerService.deleteKeywordAlert(parseInt(req.params.id));
  res.json({ ok: true });
});

// Discovered frequencies
app.get('/api/pager/discovered-frequencies', (_req, res) => res.json(pagerService.getDiscoveredFrequencies()));

// Pager message injection endpoint (for external decoder pipeline)
app.post("/api/pager/messages", (req, res) => {
  try {
    const { protocol, capcode, address, function: fn, content, baudRate } = req.body;
    pagerService.processMessage({ protocol: protocol || "POCSAG", capcode: capcode || address, address: address || capcode, function: fn || 0, content: content || "", baudRate: baudRate || 1200 });
    res.json({ ok: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// ============================================================================
// REST API — Phase 7: Sub-GHz
// ============================================================================
app.get('/api/subghz/signals', (req, res) => res.json(subghzService.getSignals(parseInt(req.query.limit as string) || 100)));
app.get('/api/subghz/sweeps', (req, res) => res.json(subghzService.getSweepResults(parseInt(req.query.limit as string) || 50)));
app.get('/api/subghz/identify', (req, res) => {
  const freq = parseFloat(req.query.freq as string);
  if (isNaN(freq)) return res.status(400).json({ error: 'freq required' });
  res.json(subghzService.identifyProtocol(freq));
});
app.get('/api/subghz/status', (_req, res) => res.json(subghzService.getStatus()));
app.get('/api/subghz/config', (_req, res) => res.json(subghzService.getConfig()));
app.post('/api/subghz/config', (req, res) => res.json(subghzService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: SSTV
// ============================================================================
app.get('/api/sstv/gallery', (req, res) => res.json(sstvService.getGallery(parseInt(req.query.limit as string) || 50)));
app.get('/api/sstv/gallery/:id', (req, res) => {
  const img = sstvService.getImage(req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  res.json(img);
});
app.get('/api/sstv/status', (_req, res) => res.json(sstvService.getStatus()));
app.get('/api/sstv/config', (_req, res) => res.json(sstvService.getConfig()));
app.post('/api/sstv/config', (req, res) => res.json(sstvService.updateConfig(req.body)));
app.post('/api/sstv/gallery/:id/notes', (req, res) => {
  const img = sstvService.addNote(req.params.id, req.body.notes);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  res.json(img);
});

// ============================================================================
// REST API — Phase 7: Meters
// ============================================================================
app.get('/api/meters/devices', (_req, res) => res.json(meterService.getMeters()));
app.get('/api/meters/devices/:id', (req, res) => {
  const m = meterService.getMeter(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meter not found' });
  res.json(m);
});
app.get('/api/meters/stats', (_req, res) => res.json(meterService.getStats()));
app.get('/api/meters/config', (_req, res) => res.json(meterService.getConfig()));
app.post('/api/meters/config', (req, res) => res.json(meterService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: WiFi
// ============================================================================
app.get('/api/wifi/aps', (_req, res) => res.json(wifiService.getAPs()));
app.get('/api/wifi/aps/:bssid', (req, res) => {
  const ap = wifiService.getAP(req.params.bssid);
  if (!ap) return res.status(404).json({ error: 'AP not found' });
  res.json(ap);
});
app.get('/api/wifi/deauth', (req, res) => res.json(wifiService.getDeauthEvents(parseInt(req.query.limit as string) || 100)));
app.get('/api/wifi/channels', (_req, res) => res.json(wifiService.getChannelUtilization()));
app.get('/api/wifi/status', (_req, res) => res.json(wifiService.getStatus()));
app.get('/api/wifi/config', (_req, res) => res.json(wifiService.getConfig()));
app.post('/api/wifi/config', (req, res) => res.json(wifiService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: Bluetooth
// ============================================================================
app.get('/api/bluetooth/devices', (_req, res) => res.json(bluetoothService.getDevices()));
app.get('/api/bluetooth/devices/:id', (req, res) => {
  const dev = bluetoothService.getDevice(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  res.json(dev);
});
app.get('/api/bluetooth/trackers', (_req, res) => res.json(bluetoothService.getTrackers()));
app.get('/api/bluetooth/alerts', (req, res) => res.json(bluetoothService.getAlerts(parseInt(req.query.limit as string) || 100)));
app.post('/api/bluetooth/alerts/:id/ack', (req, res) => res.json({ ok: bluetoothService.acknowledgeAlert(req.params.id) }));
app.post('/api/bluetooth/target', (req, res) => { bluetoothService.setTarget(req.body.mac, req.body.isTarget); res.json({ ok: true }); });
app.get('/api/bluetooth/status', (_req, res) => res.json(bluetoothService.getStatus()));
app.get('/api/bluetooth/config', (_req, res) => res.json(bluetoothService.getConfig()));
app.post('/api/bluetooth/config', (req, res) => res.json(bluetoothService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: TSCM
// ============================================================================
app.get('/api/tscm/baselines', (_req, res) => res.json(tscmService.getBaselines()));
app.post('/api/tscm/baseline', (req, res) => res.json(tscmService.recordBaseline(req.body.name || 'Baseline', req.body.location || 'Unknown')));
app.get('/api/tscm/sweeps', (req, res) => res.json(tscmService.getSweepResults(parseInt(req.query.limit as string) || 50)));
app.post('/api/tscm/sweep', (req, res) => res.json(tscmService.runSweep(req.body.baselineId, req.body.location)));
app.get('/api/tscm/anomalies', (req, res) => res.json(tscmService.getAnomalies(parseInt(req.query.limit as string) || 100)));
app.post('/api/tscm/anomalies/:id/ack', (req, res) => res.json({ ok: tscmService.acknowledgeAnomaly(req.params.id) }));
app.get('/api/tscm/knownbugs', (_req, res) => res.json(tscmService.getKnownBugs()));
app.get('/api/tscm/reports', (_req, res) => res.json(tscmService.getReports()));
app.post('/api/tscm/reports', (req, res) => {
  const report = tscmService.generateReport(req.body.sweepId, req.body.operator);
  if (!report) return res.status(404).json({ error: 'Sweep not found' });
  res.json(report);
});
app.get('/api/tscm/config', (_req, res) => res.json(tscmService.getConfig()));
app.post('/api/tscm/config', (req, res) => res.json(tscmService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: Meshtastic
// ============================================================================
app.get('/api/meshtastic/nodes', (_req, res) => res.json(meshtasticService.getNodes()));
app.get('/api/meshtastic/nodes/:id', (req, res) => {
  const node = meshtasticService.getNode(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node);
});
app.get('/api/meshtastic/messages', (req, res) => res.json(meshtasticService.getMessages(parseInt(req.query.limit as string) || 100)));
app.post('/api/meshtastic/send', (req, res) => res.json(meshtasticService.sendMessage(req.body.text, req.body.to, req.body.channel)));
app.get('/api/meshtastic/telemetry', (req, res) => res.json(meshtasticService.getTelemetry(req.query.nodeId as string, parseInt(req.query.limit as string) || 100)));
app.get('/api/meshtastic/status', (_req, res) => res.json(meshtasticService.getStatus()));
app.get('/api/meshtastic/config', (_req, res) => res.json(meshtasticService.getConfig()));
app.post('/api/meshtastic/config', (req, res) => res.json(meshtasticService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 7: Number Stations
// ============================================================================
app.get('/api/numberstations', (req, res) => {
  const q = req.query.q as string;
  res.json(q ? numberStationsService.searchStations(q) : numberStationsService.getStations());
});
app.get('/api/numberstations/onair', (_req, res) => res.json(numberStationsService.getNowOnAir()));
app.get('/api/numberstations/active', (_req, res) => res.json(numberStationsService.getActiveStations()));
app.get('/api/numberstations/:id', (req, res) => {
  const s = numberStationsService.getStation(req.params.id);
  if (!s) return res.status(404).json({ error: 'Station not found' });
  res.json(s);
});

// ============================================================================
// REST API — Phase 7: Field Mode
// ============================================================================
app.get('/api/fieldmode/status', (_req, res) => res.json(fieldModeService.getStatus()));
app.post('/api/fieldmode/enable', (_req, res) => { fieldModeService.enable(); res.json({ ok: true }); });
app.post('/api/fieldmode/disable', (_req, res) => { fieldModeService.disable(); res.json({ ok: true }); });
app.get('/api/fieldmode/assets', (_req, res) => res.json(fieldModeService.getCachedAssets()));
app.post('/api/fieldmode/refresh/:type', (req, res) => {
  const asset = fieldModeService.refreshAsset(req.params.type);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});
app.get('/api/fieldmode/checklists', (_req, res) => res.json(fieldModeService.getChecklists()));
app.post('/api/fieldmode/checklists', (req, res) => res.json(fieldModeService.createChecklist(req.body.name)));
app.put('/api/fieldmode/checklists/:clId/items/:itemId', (req, res) => {
  const cl = fieldModeService.updateChecklistItem(req.params.clId, req.params.itemId, req.body.checked);
  if (!cl) return res.status(404).json({ error: 'Checklist not found' });
  res.json(cl);
});
app.get('/api/fieldmode/archives', (_req, res) => res.json(fieldModeService.getArchives()));
app.post('/api/fieldmode/archives', (req, res) => res.json(fieldModeService.createArchive(req.body.name, req.body.includes || [])));

// ============================================================================
// REST API — Phase 7: VDL2
// ============================================================================
app.get('/api/vdl2/messages', (req, res) => res.json(vdl2Service.getMessages(parseInt(req.query.limit as string) || 100)));
app.get('/api/vdl2/status', (_req, res) => res.json(vdl2Service.getStatus()));
app.get('/api/vdl2/config', (_req, res) => res.json(vdl2Service.getConfig()));
app.post('/api/vdl2/config', (req, res) => res.json(vdl2Service.updateConfig(req.body)));

// ============================================================================
// REST API — Time Machine
// ============================================================================
app.post('/api/timemachine/load/:recordingId', (req, res) => {
  const state = timeMachineService.loadRecording(req.params.recordingId);
  if (!state) return res.status(404).json({ error: 'Recording not found or incomplete' });
  res.json(state);
});
app.post('/api/timemachine/play', (_req, res) => {
  const state = timeMachineService.play();
  if (!state) return res.status(400).json({ error: 'No recording loaded' });
  res.json(state);
});
app.post('/api/timemachine/pause', (_req, res) => {
  const state = timeMachineService.pause();
  if (!state) return res.status(400).json({ error: 'No recording loaded' });
  res.json(state);
});
app.post('/api/timemachine/stop', (_req, res) => {
  const state = timeMachineService.stop();
  res.json(state || { status: 'stopped' });
});
app.post('/api/timemachine/seek', (req, res) => {
  const position = parseFloat(req.query.position as string || req.body.position);
  if (isNaN(position)) return res.status(400).json({ error: 'position required (0-1)' });
  const state = timeMachineService.seek(position);
  if (!state) return res.status(400).json({ error: 'No recording loaded' });
  res.json(state);
});
app.get('/api/timemachine/state', (_req, res) => {
  res.json(timeMachineService.getState() || { status: 'idle' });
});

// ============================================================================
// REST API — Settings Persistence
// ============================================================================
app.get('/api/settings', (_req, res) => {
  res.json(settingsService.getAll());
});
app.put('/api/settings', (req, res) => {
  settingsService.setAll(req.body);
  res.json({ ok: true });
});
app.get('/api/settings/:key', (req, res) => {
  res.json({ key: req.params.key, value: settingsService.get(req.params.key) });
});
app.put('/api/settings/:key', (req, res) => {
  settingsService.set(req.params.key, req.body.value);
  res.json({ ok: true });
});

// ============================================================================
// REST API — Phase 8: AI Signal Narrator
// ============================================================================
// ============================================================================
// REST API — Subprocess Decoder Manager
// ============================================================================
app.get('/api/decoders', (_req, res) => res.json(decoderManager.getDecoders()));
app.get('/api/decoders/:name', (req, res) => {
  const d = decoderManager.getDecoder(req.params.name);
  if (!d) return res.status(404).json({ error: 'Decoder not found' });
  res.json(d);
});
app.post('/api/decoders/:name/start', (req, res) => {
  const ok = decoderManager.startDecoder(req.params.name);
  if (!ok) return res.status(400).json({ error: 'Failed to start decoder (binary not found or already running)' });
  res.json({ ok: true, status: decoderManager.getDecoder(req.params.name) });
});
app.post('/api/decoders/:name/stop', (req, res) => {
  const ok = decoderManager.stopDecoder(req.params.name);
  if (!ok) return res.status(404).json({ error: 'Decoder not found' });
  res.json({ ok: true });
});
app.get('/api/decoders/:name/output', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(decoderManager.getOutput(req.params.name, limit));
});

// Narrator style endpoint
app.get('/api/narrator/style', (_req, res) => res.json({ style: narratorService.getStyle(), provider: narratorService.getActiveProvider() }));
app.post('/api/narrator/style', (req, res) => {
  const { style } = req.body;
  if (style && ['technical', 'casual', 'dramatic'].includes(style)) {
    narratorService.setStyle(style);
  }
  res.json({ style: narratorService.getStyle() });
});

app.post('/api/narrator/narrate', (req, res) => res.json(narratorService.narrate(req.body)));
app.get('/api/narrator/narrations', (req, res) => res.json(narratorService.getNarrations(parseInt(req.query.limit as string) || 50)));
app.get('/api/narrator/current', (_req, res) => res.json({ narration: narratorService.getCurrentNarration(), timestamp: Date.now() }));
app.post('/api/narrator/ask', async (req, res) => { try { const result = await narratorService.ask(req.body.question || ''); res.json(result); } catch (e: any) { res.status(500).json({ error: e.message }); } });
app.get('/api/narrator/config', (_req, res) => res.json(narratorService.getConfig()));
app.post('/api/narrator/config', (req, res) => res.json(narratorService.updateConfig(req.body)));

// ============================================================================
// REST API — Phase 8: Community Hub
// ============================================================================
app.get('/api/community/flowgraphs', (req, res) => res.json(communityService.getFlowgraphs(req.query.category as any, req.query.search as string)));
app.get('/api/community/flowgraphs/:id', (req, res) => {
  const fg = communityService.getFlowgraph(req.params.id);
  fg ? res.json(fg) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/community/flowgraphs', (req, res) => res.json(communityService.shareFlowgraph(req.body)));
app.post('/api/community/flowgraphs/:id/rate', (req, res) => res.json({ ok: communityService.rateFlowgraph(req.params.id, req.body.rating) }));
app.post('/api/community/flowgraphs/:id/comment', (req, res) => res.json(communityService.commentOnFlowgraph(req.params.id, req.body.author, req.body.text)));
app.get('/api/community/plugins', (req, res) => res.json(communityService.getPlugins(req.query.category as any)));

// Community Hub — shared bookmarks, feed, signal reports
const communityBookmarks: any[] = [];
const communityReports: any[] = [];
const communityFeed: any[] = [];
function addFeedItem(type: string, data: any) {
  communityFeed.unshift({ id: `feed-${Date.now()}`, type, data, timestamp: Date.now() });
  if (communityFeed.length > 200) communityFeed.length = 200;
}
app.get('/api/community/bookmarks', (_req, res) => res.json(communityBookmarks));
app.post('/api/community/bookmarks', (req, res) => {
  const bm = { id: `bm-${Date.now()}`, ...req.body, sharedAt: Date.now() };
  communityBookmarks.unshift(bm);
  addFeedItem('bookmark', { nickname: req.body.nickname || 'Anonymous', frequency: req.body.frequency, label: req.body.label });
  res.json(bm);
});
app.get('/api/community/feed', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(communityFeed.slice(0, limit));
});
app.post('/api/community/reports', (req, res) => {
  const report = { id: `rpt-${Date.now()}`, ...req.body, timestamp: Date.now() };
  communityReports.unshift(report);
  addFeedItem('signal_report', { nickname: req.body.nickname || 'Anonymous', signal: req.body.signal, frequency: req.body.frequency, location: req.body.location });
  res.json(report);
});
app.get('/api/community/reports', (_req, res) => res.json(communityReports));

// ============================================================================
// REST API — Community Hub (SQLite-backed)
// ============================================================================
app.get('/api/community/db/flowgraphs', (req, res) => {
  res.json(communityDBService.getFlowgraphs(req.query.category as string, req.query.search as string));
});
app.get('/api/community/db/flowgraphs/:id', (req, res) => {
  const fg = communityDBService.getFlowgraph(req.params.id);
  fg ? res.json(fg) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/community/db/flowgraphs', (req, res) => {
  res.json(communityDBService.shareFlowgraph(req.body));
});
app.post('/api/community/db/flowgraphs/:id/import', (req, res) => {
  const result = communityDBService.importFlowgraph(req.params.id);
  result ? res.json(result) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/community/db/flowgraphs/:id/rate', (req, res) => {
  res.json({ ok: communityDBService.rateFlowgraph(req.params.id, req.body.rating) });
});
app.post('/api/community/observations', (req, res) => {
  res.json(communityDBService.postObservation(req.body));
});
app.get('/api/community/observations', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(communityDBService.getObservations(limit));
});
app.post('/api/community/observations/:id/like', (req, res) => {
  res.json({ ok: communityDBService.likeObservation(req.params.id, req.body.userId || 'anonymous') });
});
app.post('/api/community/observations/:id/bookmark', (req, res) => {
  res.json({ ok: communityDBService.bookmarkObservation(req.params.id, req.body.userId || 'anonymous') });
});

// ============================================================================
// REST API — Training Academy (file-based tutorials)
// ============================================================================
app.get('/api/training/tutorials', (req, res) => {
  res.json(trainingService.getTutorials(req.query.category as string, req.query.difficulty as string));
});
app.get('/api/training/tutorials/:id', (req, res) => {
  const tut = trainingService.getTutorial(req.params.id);
  tut ? res.json(tut) : res.status(404).json({ error: 'Tutorial not found' });
});
app.post('/api/training/progress', (req, res) => {
  const { userId, tutorialId, completed, quizScore } = req.body;
  trainingService.saveProgress(userId || 'default', tutorialId, completed, quizScore);
  res.json({ ok: true });
});
app.get('/api/training/progress', (req, res) => {
  res.json(trainingService.getProgress(req.query.userId as string || 'default'));
});

// ============================================================================
// REST API — Filesystem Plugins (enhanced)
// ============================================================================
app.get('/api/plugins/fs', (_req, res) => res.json(fsPluginLoader.getAll()));
app.get('/api/plugins/fs/:id', (req, res) => {
  const p = fsPluginLoader.getPlugin(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Plugin not found' });
});
app.put('/api/plugins/fs/:id/config', (req, res) => {
  res.json({ ok: fsPluginLoader.updateConfig(req.params.id, req.body) });
});
app.post('/api/plugins/fs/:id/enable', async (req, res) => {
  res.json({ ok: await fsPluginLoader.enablePlugin(req.params.id) });
});
app.post('/api/plugins/fs/:id/disable', async (req, res) => {
  res.json({ ok: await fsPluginLoader.disablePlugin(req.params.id) });
});

// ============================================================================
// REST API — Phase 8: Academy / Training
// ============================================================================
app.get('/api/academy/tutorials', (req, res) => res.json(academyService.getTutorials(req.query.difficulty as any)));
app.get('/api/academy/tutorials/:id', (req, res) => {
  const tut = academyService.getTutorial(req.params.id);
  tut ? res.json(tut) : res.status(404).json({ error: 'Not found' });
});
app.get('/api/academy/quiz', (req, res) => res.json(academyService.getQuizQuestions(req.query.difficulty as any, parseInt(req.query.limit as string) || 10)));
app.post('/api/academy/quiz/answer', (req, res) => res.json(academyService.submitQuizAnswer(req.body.questionId, req.body.answerIndex)));
app.post('/api/academy/tutorials/:id/complete', (req, res) => { academyService.completeTutorial(req.params.id); res.json({ ok: true }); });
app.get('/api/academy/progress', (_req, res) => res.json(academyService.getProgress()));

// Module-based lesson content (new curriculum)
app.get('/api/academy/modules', (_req, res) => res.json(getModules()));
app.get('/api/academy/modules/:moduleId/lessons', (req, res) => res.json(getLessonsByModule(parseInt(req.params.moduleId))));
app.get('/api/academy/lessons', (_req, res) => res.json(getLessons()));
app.get('/api/academy/lessons/:id', (req, res) => {
  const lesson = getLesson(req.params.id);
  lesson ? res.json(lesson) : res.status(404).json({ error: 'Lesson not found' });
});
const lessonProgress = new Map<string, Set<string>>(); // sessionId -> completed lesson IDs
app.post('/api/academy/progress', (req, res) => {
  const { sessionId = 'default', lessonId, completed } = req.body;
  if (!lessonProgress.has(sessionId)) lessonProgress.set(sessionId, new Set());
  if (completed) lessonProgress.get(sessionId)!.add(lessonId);
  res.json({ ok: true, completed: Array.from(lessonProgress.get(sessionId)!) });
});

// ============================================================================
// REST API — Phase 8: Signal History / Time Machine
// ============================================================================
app.post('/api/history/record', (req, res) => res.json(historyService.record(req.body)));
app.post('/api/history/query', (req, res) => res.json(historyService.query(req.body)));
app.get('/api/history/stats', (_req, res) => res.json(historyService.getStats()));
app.get('/api/history/config', (_req, res) => res.json(historyService.getConfig()));
app.post('/api/history/config', (req, res) => res.json(historyService.updateConfig(req.body)));

// ============================================================================
// REST API — Persistent History (SQLite-backed)
// ============================================================================
app.get('/api/history/adsb', (req, res) => {
  const since = parseInt(req.query.since as string) || 0;
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(persistenceService.getADSBHistory(since, limit));
});
app.get('/api/history/ais', (req, res) => {
  const since = parseInt(req.query.since as string) || 0;
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(persistenceService.getAISHistory(since, limit));
});
app.get('/api/history/aprs', (req, res) => {
  const since = parseInt(req.query.since as string) || 0;
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(persistenceService.getAPRSHistory(since, limit));
});
app.get('/api/history/events', (req, res) => {
  const type = req.query.type as string | undefined;
  const since = parseInt(req.query.since as string) || 0;
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(persistenceService.getEvents(type, since, limit));
});
app.get('/api/stats', (_req, res) => {
  res.json(persistenceService.getStats());
});

// ============================================================================
// REST API — Phase 8: Integration Hub
// ============================================================================
app.get('/api/integrations', (_req, res) => res.json(integrationHubService.getAll()));
app.get('/api/integrations/:id', (req, res) => {
  const integ = integrationHubService.get(req.params.id as IntegrationType);
  integ ? res.json(integ) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/integrations/:id/configure', (req, res) => res.json(integrationHubService.configure(req.params.id as IntegrationType, req.body)));
app.post('/api/integrations/:id/test', async (req, res) => res.json(await integrationHubService.test(req.params.id as IntegrationType)));
app.post('/api/integrations/:id/enable', (req, res) => res.json({ ok: integrationHubService.enable(req.params.id as IntegrationType) }));
app.post('/api/integrations/:id/disable', (req, res) => res.json({ ok: integrationHubService.disable(req.params.id as IntegrationType) }));
app.get('/metrics', (_req, res) => { res.set('Content-Type', 'text/plain'); res.send(integrationHubService.getPrometheusMetrics()); });

// ============================================================================
// REST API — Phase 8: Equipment Manager
// ============================================================================
app.get('/api/equipment/database', (_req, res) => res.json(equipmentService.getHardwareDatabase()));
app.get('/api/equipment/database/:id', (req, res) => {
  const hw = equipmentService.getHardware(req.params.id as any);
  hw ? res.json(hw) : res.status(404).json({ error: 'Not found' });
});
app.get('/api/equipment/mine', (_req, res) => res.json(equipmentService.getUserEquipment()));
app.post('/api/equipment/mine', (req, res) => res.json(equipmentService.addEquipment(req.body)));
app.delete('/api/equipment/mine/:id', (req, res) => res.json({ ok: equipmentService.removeEquipment(req.params.id) }));
app.get('/api/equipment/compatibility', (_req, res) => res.json(equipmentService.getCompatibility()));
app.get('/api/equipment/compatible/:decoder', (req, res) => res.json(equipmentService.getCompatibleHardware(req.params.decoder)));
app.post('/api/equipment/shopping-list', (req, res) => res.json(equipmentService.getShoppingList(req.body.capabilities || [])));
app.get('/api/equipment/scan', (_req, res) => res.json(equipmentService.scan()));
app.get('/api/equipment/status', (_req, res) => {
  const scan = equipmentService.getLastScan() || equipmentService.scan();
  res.json({ detected: scan.hardware, services: scan.services, registered: equipmentService.getUserEquipment(), timestamp: scan.timestamp });
});

// ============================================================================
// REST API — Aaronia Spectran V6
// ============================================================================
app.get('/api/aaronia/status', (_req, res) => res.json(aaroniaService.getStatus()));
app.get('/api/aaronia/models', (_req, res) => res.json(aaroniaService.getModels()));
app.get('/api/aaronia/tscm-profiles', (_req, res) => res.json(aaroniaService.getTSCMProfiles()));
app.post('/api/aaronia/connect', async (req, res) => {
  try {
    const device = await aaroniaService.connect(req.body.host || '127.0.0.1', req.body.port || 54664);
    res.json(device);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/aaronia/disconnect', (_req, res) => {
  aaroniaService.disconnect();
  res.json({ ok: true });
});
app.post('/api/aaronia/sweep', async (req, res) => {
  try {
    const result = await aaroniaService.startSweep(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/aaronia/sweep/stop', (_req, res) => {
  aaroniaService.stopSweep();
  res.json({ ok: true });
});
app.post('/api/aaronia/tscm/:profile', (req, res) => {
  try {
    const result = aaroniaService.runTSCMProfile(req.params.profile);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});
app.get('/api/aaronia/discover', async (_req, res) => {
  const devices = await aaroniaService.discover();
  res.json(devices);
});

// Forward Aaronia sweep events over WebSocket
aaroniaService.on('sweep_complete', (result) => {
  broadcast({ type: 'aaronia_sweep', result });
});
aaroniaService.on('connected', (device) => {
  broadcast({ type: 'aaronia_connected', device });
});

// ============================================================================
// REST API — WebSDR (real radio via KiwiSDR / WebSDR.org proxy)
// ============================================================================
app.get('/api/websdr/receivers', (_req, res) => res.json(webSDRService.listReceivers()));
app.get('/api/websdr/status', (_req, res) => res.json(webSDRService.getStatus()));

app.post('/api/websdr/connect', async (req, res) => {
  const { url, frequency = 7074, mode = 'am' } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const ok = await webSDRService.connect(url, frequency, mode);
    res.json({ ok, status: webSDRService.getStatus() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/websdr/tune', (req, res) => {
  const { frequency, mode = 'am', lowCut, highCut } = req.body;
  if (!frequency) return res.status(400).json({ error: 'frequency required' });
  const ok = webSDRService.tune(frequency, mode, lowCut, highCut);
  res.json({ ok, status: webSDRService.getStatus() });
});

app.post('/api/websdr/disconnect', (_req, res) => {
  webSDRService.disconnect();
  res.json({ ok: true });
});

// WebSDR audio → broadcast to WS clients as binary
// Time Machine IQ → WebSocket
timeMachineService.on('iq_data', (data: any) => {
  broadcastBinary(data.samples);
  broadcast({ type: 'timemachine_iq', sampleRate: data.sampleRate, centerFrequency: data.centerFrequency, position: data.position });
});
timeMachineService.on('state', (state: any) => {
  broadcast({ type: 'timemachine_state', state });
});

webSDRService.on('audio', (audioData: Buffer) => {
  // Tag the binary so clients know it's WebSDR audio
  const header = Buffer.from([0x57, 0x53, 0x44]); // 'WSD'
  const tagged = Buffer.concat([header, audioData]);
  broadcastBinary(tagged);
});

webSDRService.on('connected', (info) => broadcast({ type: 'websdr_connected', ...info }));
webSDRService.on('disconnected', () => broadcast({ type: 'websdr_disconnected' }));
webSDRService.on('tuned', (info) => broadcast({ type: 'websdr_tuned', ...info }));
webSDRService.on('error', (info) => broadcast({ type: 'websdr_error', ...info }));

// ============================================================================
// REST API — Themes (serve theme list; actual theming is client-side)
// ============================================================================
app.get('/api/themes', (_req, res) => {
  const { THEMES } = require('@signalforge/shared');
  res.json(THEMES);
});

// ============================================================================
// PWA — Service worker and manifest
// ============================================================================
app.get('/manifest.json', (_req, res) => {
  res.json({
    name: 'SignalForge',
    short_name: 'SignalForge',
    description: 'Universal Radio Platform — SDR control, satellite tracking, signal analysis',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0f',
    theme_color: '#00e5ff',
    orientation: 'any',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
});

// ============================================================================
// Helper: Calculate azimuth/elevation from observer to satellite
// ============================================================================
function calculateAzEl(observer: { latitude: number; longitude: number; altitude: number }, satellite: { latitude: number; longitude: number; altitude: number }) {
  const obsLat = observer.latitude * Math.PI / 180;
  const obsLon = observer.longitude * Math.PI / 180;
  const satLat = satellite.latitude * Math.PI / 180;
  const satLon = satellite.longitude * Math.PI / 180;

  const dLon = satLon - obsLon;
  const y = Math.sin(dLon) * Math.cos(satLat);
  const x = Math.cos(obsLat) * Math.sin(satLat) - Math.sin(obsLat) * Math.cos(satLat) * Math.cos(dLon);
  let azimuth = Math.atan2(y, x) * 180 / Math.PI;
  if (azimuth < 0) azimuth += 360;

  // Simple elevation approximation
  const R = 6371;
  const obsR = R + observer.altitude / 1000;
  const satR = R + satellite.altitude;
  const cosAngle = Math.sin(obsLat) * Math.sin(satLat) + Math.cos(obsLat) * Math.cos(satLat) * Math.cos(dLon);
  const range = Math.sqrt(obsR * obsR + satR * satR - 2 * obsR * satR * cosAngle);
  const elevation = Math.asin((satR * cosAngle - obsR) / range) * 180 / Math.PI;

  return { azimuth, elevation };
}

// ============================================================================
// WebSocket handling
// ============================================================================

// Track WebSocket -> user session mapping
const wsUserMap = new Map<WebSocket, string>();

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const isEdge = url.searchParams.get('edge') === 'true';
  const edgeNodeId = url.searchParams.get('nodeId');

  if (isEdge && edgeNodeId) {
    console.log(`🖥️ Edge node connected: ${edgeNodeId}`);
    // Edge node WebSocket path
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'edge_register') {
          edgeNodeManager.registerNode(edgeNodeId, msg.info, ws);
        } else if (msg.type === 'edge_heartbeat') {
          edgeNodeManager.handleHeartbeat(msg.heartbeat);
        } else if (msg.type === 'edge_telemetry') {
          edgeNodeManager.handleTelemetry(msg.telemetry);
        } else if (msg.type === 'edge_command_result') {
          edgeNodeManager.handleCommandResult({ commandId: msg.commandId, success: msg.success, result: msg.result });
        } else if (msg.type === 'edge_iq_data') {
          // Forward IQ data from edge to all clients
          broadcast({ type: 'edge_iq_meta', nodeId: edgeNodeId, ...msg.meta });
        }
      } catch { /* ignore binary */ }
    });
    return;
  }

  console.log('⚡ Client connected');

  // Send initial state (safe — client may disconnect mid-burst)
  safeSend(ws, JSON.stringify({ type: 'location', observer: locationService.getObserver() }));
  safeSend(ws, JSON.stringify({ type: 'adsb', aircraft: adsbDecoder.getAircraft() }));
  safeSend(ws, JSON.stringify({ type: 'ais', vessels: aisDecoder.getVessels() }));
  safeSend(ws, JSON.stringify({ type: 'aprs', stations: aprsDecoder.getStations() }));
  safeSend(ws, JSON.stringify({ type: 'users_update', users: sessionManager.getOnlineUsers() }));
  safeSend(ws, JSON.stringify({ type: 'edge_nodes', nodes: edgeNodeManager.getNodes() }));
  safeSend(ws, JSON.stringify({ type: 'plugins_update', plugins: pluginLoader.getPluginStatus() }));
  safeSend(ws, JSON.stringify({ type: 'scanner_state', state: frequencyScanner.getState() }));

  // Send rotator state if connected
  if (rotatorClient?.isConnected) {
    ws.send(JSON.stringify({ type: 'rotator_state', state: rotatorClient.getState() }));
  }

  // Send doppler state
  if (dopplerService.isTracking && dopplerService.currentCorrection) {
    ws.send(JSON.stringify({ type: 'doppler', correction: dopplerService.currentCorrection }));
  }

  // Demo IQ stream disabled — multiplexer handles all SDR data
  let streamInterval: ReturnType<typeof setInterval> | null = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleCommand(ws, msg);
    } catch {
      // Binary data — ignore
    }
  });

  ws.on('close', () => {
    console.log('⚡ Client disconnected');
    if (streamInterval) clearInterval(streamInterval);
    // Clean up user session
    const userId = wsUserMap.get(ws);
    if (userId) {
      sessionManager.removeSession(userId);
      wsUserMap.delete(ws);
    }
  });
});

function handleCommand(ws: WebSocket, msg: Record<string, unknown>) {
  switch (msg.type) {
    case 'list_devices':
      ws.send(JSON.stringify({ type: 'devices', devices: sdrBridge.getDevices() }));
      break;
    case 'start':
      ws.send(JSON.stringify({ type: 'status', deviceId: 'demo', streaming: true }));
      break;
    case 'stop':
      ws.send(JSON.stringify({ type: 'status', deviceId: 'demo', streaming: false }));
      break;
    case 'set_frequency':
      for (const [, c] of rtlTcpConnections) c.setFrequency(msg.frequency as number);
      for (const [, c] of soapyConnections) c.setFrequency(msg.frequency as number);
      break;
    case 'set_gain':
      for (const [, c] of rtlTcpConnections) c.setGain(msg.gain as number);
      break;
    case 'set_sample_rate':
      for (const [, c] of rtlTcpConnections) c.setSampleRate(msg.sampleRate as number);
      break;
    case 'rotator_command':
      if (rotatorClient?.isConnected) {
        rotatorClient.handleCommand(msg.command as any);
      }
      break;
    case 'subscribe':
      ws.send(JSON.stringify({ type: 'subscribed', channels: msg.channels }));
      break;
    // Multi-user WS commands
    case 'user_join': {
      const session = sessionManager.createSession(msg.nickname as string);
      wsUserMap.set(ws, session.id);
      ws.send(JSON.stringify({ type: 'session', session }));
      break;
    }
    case 'user_heartbeat': {
      const uid = wsUserMap.get(ws);
      if (uid) sessionManager.heartbeat(uid);
      break;
    }
    case 'user_tuning': {
      const uid2 = wsUserMap.get(ws);
      if (uid2) sessionManager.updateTuning(uid2, msg.tuning as any);
      break;
    }
    case 'user_view': {
      const uid3 = wsUserMap.get(ws);
      if (uid3) sessionManager.updateView(uid3, msg.view as string);
      break;
    }
    case 'chat_send': {
      const uid4 = wsUserMap.get(ws);
      if (uid4) sessionManager.addChatMessage(uid4, msg.text as string);
      break;
    }
    case 'add_observation': {
      const uid5 = wsUserMap.get(ws);
      if (uid5) sessionManager.addObservation(uid5, msg.observation as any);
      break;
    }
    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown command: ${msg.type}` }));
  }
}

// Load satellite TLEs on startup
satelliteService.loadTLEs().then(() => {
  addActivity({ type: 'system', icon: '🛰️', title: 'TLE Data Loaded', detail: 'Active satellites catalogue updated', timestamp: Date.now() });
});

// ============================================================================
// Graceful Shutdown
// ============================================================================
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n⚡ ${signal} received — graceful shutdown`);

  // Stop accepting new connections
  server.close();

  // Stop subprocess decoders
  decoderManager.stopAll();

  // Stop services
  persistenceService.stop();
  geofenceService.stop();
  propagationService.stop();
  voiceDecoder.stopDemo();
  frequencyScanner.stopScan();
  spectrumAnalyzer.stopSweep();
  rtl433Service.stopDemo();
  pagerService.stopDemo();
  subghzService.stopDemo();
  sstvService.stopDemo();
  meterService.stopDemo();
  wifiService.stopDemo();
  bluetoothService.stopDemo();
  tscmService.stopDemo();
  meshtasticService.stopDemo();
  vdl2Service.stopDemo();

  // Disconnect SDR
  for (const [, c] of rtlTcpConnections) c.disconnect();
  for (const [, c] of soapyConnections) c.disconnect();
  if (rotatorClient?.isConnected) rotatorClient.disconnect();
  mqttClient.disconnect();

  // Close all websockets
  wss.clients.forEach(ws => ws.close());

  console.log('⚡ Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Structured logging helper
function logInfo(component: string, message: string, data?: Record<string, unknown>) {
  const entry = { level: 'info', timestamp: new Date().toISOString(), component, message, ...data };
  console.log(JSON.stringify(entry));
}


// ── SDR Multiplexer event wiring ──
// CyberEther methodology: accumulate at data rate, flush at display rate (30fps)
// Server is the "compute" side — accumulate FFT frames into a batch buffer
// Timer flushes at fixed interval, decoupling data rate from network rate
let _lastFftMeta = 0;
let _fftBatch: Buffer[] = [];
const FFT_FLUSH_MS = 8; // ~120fps ceiling — let display vsync throttle

// Pre-allocate reusable header buffer
const _fftHeader = Buffer.alloc(4);
let _lastFlush = 0;

// Event-driven flush: accumulate, flush when enough time passed
// No setInterval jitter — fires exactly when data arrives after deadline
function flushFftBatch() {
  if (_fftBatch.length === 0) return;
  _fftHeader.writeUInt32LE(_fftBatch.length);
  const combined = Buffer.concat([_fftHeader, ..._fftBatch]);
  broadcastSignal(combined);
  _fftBatch = [];
  _lastFlush = Date.now();
}

sdrMultiplexer.on('fft_data', (data) => {
  _fftBatch.push(Buffer.from(data.magnitudes.buffer, data.magnitudes.byteOffset, data.magnitudes.byteLength));
  // Flush if >= 16ms since last flush (event-driven, no timer jitter)
  if (Date.now() - _lastFlush >= FFT_FLUSH_MS) flushFftBatch();
  
  const now = Date.now();
  if (now - _lastFftMeta > 1000) {
    _lastFftMeta = now;
    broadcast({ type: 'fft_meta', centerFrequency: data.centerFrequency, sampleRate: data.sampleRate, fftSize: data.fftSize });
  }
});
// iq_meta broadcast disabled — redundant with fft_meta, was causing 190+ JSON msgs/sec
// sdrMultiplexer.on('iq_meta', (meta) => broadcast(meta));
sdrMultiplexer.on('pager_message', (msg) => {
  pagerService.processMessage(msg);
});

// Feed FFT data to pager frequency discovery
sdrMultiplexer.on('fft_data', (data) => {
  pagerService.processFFT(data);
});

// Pager keyword alerts -> WebSocket
pagerService.on('keyword_alert', (alert) => {
  broadcast({ type: 'pager_alert', alert });
});

// Auto-start multiplexer with multi-frequency pager array
setTimeout(() => {
  sdrMultiplexer.autoStart().then(ok => {
    if (ok) console.log("📡 SDR Multiplexer auto-started — 3 pager receivers active");
    else console.log("📡 SDR Multiplexer: no device or auto-start failed");
  }).catch(err => console.error("📡 SDR Multiplexer auto-start error:", err));
}, 3000); // Delay to let server bind first

// Load filesystem plugins
const serviceMap = new Map<string, any>([
  ['adsb', adsbDecoder], ['ais', aisDecoder], ['aprs', aprsDecoder],
  ['sdr', sdrMultiplexer], ['mqtt', mqttClient], ['location', locationService],
  ['pager', pagerService], ['satellite', satelliteService],
]);
fsPluginLoader = new FilesystemPluginLoader(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins'),
  db,
  serviceMap,
  (data: any) => { try { broadcast(data); } catch {} },
);
fsPluginLoader.scanAndLoad().then(() => {
  fsPluginLoader.registerRoutes(app);
}).catch(err => console.error('Plugin loading error:', err));

// Serve production client build (bypasses Vite dev server entirely)
const __sfDir = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__sfDir, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(join(clientDist, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ⚡ ╔═══════════════════════════════════════╗
  ⚡ ║         S I G N A L F O R G E         ║
  ⚡ ║    Universal Radio Platform v0.10      ║
  ⚡ ╠═══════════════════════════════════════╣
  ⚡ ║  HTTP:  http://0.0.0.0:${PORT}            ║
  ⚡ ║  WS:    ws://0.0.0.0:${PORT}/ws           ║
  ⚡ ║  Docs:  http://0.0.0.0:${PORT}/api/docs   ║
  ⚡ ║  Decoders: ADS-B AIS ACARS APRS      ║
  ⚡ ║  SDR:   RTL-TCP + SoapySDR           ║
  ⚡ ║  Rotator: Hamlib rotctld             ║
  ⚡ ║  MQTT:  Publish/Subscribe            ║
  ⚡ ╚═══════════════════════════════════════╝
  `);
});

// Legacy auto-connect disabled — multiplexer handles SDR connection now
// Raw IQ broadcast was conflicting with multiplexer's FFT broadcast
