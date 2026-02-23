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
import type { DashboardStats, ActivityFeedItem } from '@signalforge/shared';

const PORT = parseInt(process.env.PORT || '3401');
const app = express();
app.use(cors());
app.use(express.json());

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

const locationService = new LocationService();
locationService.start();

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
  res.json({
    name: 'SignalForge',
    version: '0.4.0',
    uptime: process.uptime(),
    status: 'operational',
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

wss.on('connection', (ws: WebSocket) => {
  console.log('⚡ Client connected');

  // Send initial state
  ws.send(JSON.stringify({ type: 'location', observer: locationService.getObserver() }));
  ws.send(JSON.stringify({ type: 'adsb', aircraft: adsbDecoder.getAircraft() }));
  ws.send(JSON.stringify({ type: 'ais', vessels: aisDecoder.getVessels() }));
  ws.send(JSON.stringify({ type: 'aprs', stations: aprsDecoder.getStations() }));

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
    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown command: ${msg.type}` }));
  }
}

// Load satellite TLEs on startup
satelliteService.loadTLEs().then(() => {
  addActivity({ type: 'system', icon: '🛰️', title: 'TLE Data Loaded', detail: 'Active satellites catalogue updated', timestamp: Date.now() });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ⚡ ╔═══════════════════════════════════════╗
  ⚡ ║         S I G N A L F O R G E         ║
  ⚡ ║     Universal Radio Platform v0.4     ║
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
