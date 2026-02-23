import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { SDRBridge } from './sdr/bridge.js';
import { RtlTcpClient } from './sdr/rtltcp.js';
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
import type { DashboardStats, ActivityFeedItem } from '@signalforge/shared';

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
const wss = new WebSocketServer({ server, path: '/ws' });

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
const soapyConnections = new Map<string, SoapyClient>();
let rotatorClient: RotatorClient | null = null;

const sessionManager = new SessionManager();
const pluginLoader = new PluginLoader();
const edgeNodeManager = new EdgeNodeManager();
const frequencyScanner = new FrequencyScanner();
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

const locationService = new LocationService();
locationService.start();

// Start demo telemetry
telemetryService.startDemoTelemetry();

// Start Phase 6 services
geofenceService.start();
propagationService.start();
voiceDecoder.startDemo();

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

frequencyScanner.on('scan_update', (state) => broadcast({ type: 'scanner_state', state }));
frequencyScanner.on('signal_detected', (activity) => {
  broadcast({ type: 'scan_hit', activity });
  timelineService.addEvent({ type: 'scan_hit', title: `Signal on ${(activity.frequency / 1e6).toFixed(3)} MHz`, description: `${activity.signalStrength.toFixed(0)} dBm`, timestamp: Date.now(), frequency: activity.frequency, icon: '📻', color: '#ffab00' });
});

signalClassifier.on('classification', (result) => {
  broadcast({ type: 'classification', result });
  timelineService.addEvent({ type: 'classification', title: `${result.classification.toUpperCase()} signal classified`, description: `${(result.frequency / 1e6).toFixed(3)} MHz — ${(result.confidence * 100).toFixed(0)}% confidence`, timestamp: Date.now(), frequency: result.frequency, icon: '🧠', color: '#748ffc' });
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

// Feed decoder data into analytics
adsbDecoder.on('message', (msg) => analyticsService.recordDecoderMessage('ADS-B'));
acarsDecoder.on('message', () => analyticsService.recordDecoderMessage('ACARS'));
aisDecoder.on('message', () => analyticsService.recordDecoderMessage('AIS'));
aprsDecoder.on('message', () => analyticsService.recordDecoderMessage('APRS'));

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
  broadcast({ type: 'ais', vessels: aisDecoder.getVessels() });
  if (mqttClient.getConfig().connected && msg.shipName) {
    mqttClient.publish('signalforge/ais', JSON.stringify(msg));
  }
});

aprsDecoder.on('message', (pkt) => {
  addActivity({ type: 'aprs', icon: '📍', title: pkt.source, detail: pkt.comment || pkt.dataType, timestamp: pkt.timestamp });
  broadcast({ type: 'aprs', stations: aprsDecoder.getStations() });
  if (mqttClient.getConfig().connected) {
    mqttClient.publish('signalforge/aprs', JSON.stringify(pkt));
  }
});

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// Binary broadcast for IQ data
function broadcastBinary(data: Buffer | ArrayBuffer) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: true });
  });
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
  ];
  const allUp = components.every(c => c.status === 'up');
  const anyDown = components.some(c => c.status === 'down');
  res.json({
    status: anyDown ? 'degraded' : allUp ? 'healthy' : 'degraded',
    name: 'SignalForge',
    version: '0.6.0',
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
  const rtl = connectionId ? rtlTcpConnections.get(connectionId) : rtlTcpConnections.values().next().value;
  if (rtl) { rtl.setGain(gain); return res.json({ ok: true }); }
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

// --- Recordings ---
app.get('/api/recordings', (_req, res) => res.json(signalDb.getRecordings()));

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

app.post('/api/edge/nodes/:id/command', (req, res) => {
  const ok = edgeNodeManager.sendCommand(req.params.id, req.body);
  res.json({ ok });
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
        } else if (msg.type === 'edge_iq_data') {
          // Forward IQ data from edge to all clients
          broadcast({ type: 'edge_iq_meta', nodeId: edgeNodeId, ...msg.meta });
        }
      } catch { /* ignore binary */ }
    });
    return;
  }

  console.log('⚡ Client connected');

  // Send initial state
  ws.send(JSON.stringify({ type: 'location', observer: locationService.getObserver() }));
  ws.send(JSON.stringify({ type: 'adsb', aircraft: adsbDecoder.getAircraft() }));
  ws.send(JSON.stringify({ type: 'ais', vessels: aisDecoder.getVessels() }));
  ws.send(JSON.stringify({ type: 'aprs', stations: aprsDecoder.getStations() }));
  ws.send(JSON.stringify({ type: 'users_update', users: sessionManager.getOnlineUsers() }));
  ws.send(JSON.stringify({ type: 'edge_nodes', nodes: edgeNodeManager.getNodes() }));
  ws.send(JSON.stringify({ type: 'plugins_update', plugins: pluginLoader.getPluginStatus() }));
  ws.send(JSON.stringify({ type: 'scanner_state', state: frequencyScanner.getState() }));

  // Send rotator state if connected
  if (rotatorClient?.isConnected) {
    ws.send(JSON.stringify({ type: 'rotator_state', state: rotatorClient.getState() }));
  }

  // Send doppler state
  if (dopplerService.isTracking && dopplerService.currentCorrection) {
    ws.send(JSON.stringify({ type: 'doppler', correction: dopplerService.currentCorrection }));
  }

  // Start demo IQ stream (if no real SDR connected)
  let streamInterval: ReturnType<typeof setInterval> | null = null;
  if (rtlTcpConnections.size === 0 && soapyConnections.size === 0) {
    streamInterval = sdrBridge.startDemoStream((frame) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame.samples.buffer, { binary: true });
      }
    });
  }

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

  // Stop services
  geofenceService.stop();
  propagationService.stop();
  voiceDecoder.stopDemo();
  frequencyScanner.stopScan();
  spectrumAnalyzer.stopSweep();

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ⚡ ╔═══════════════════════════════════════╗
  ⚡ ║         S I G N A L F O R G E         ║
  ⚡ ║     Universal Radio Platform v0.6     ║
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
