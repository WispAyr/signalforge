import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { SDRBridge } from './sdr/bridge.js';
import { SatelliteService } from './satellite/service.js';
import { ADSBDecoder } from './decoders/adsb.js';
import { ACARSDecoder } from './decoders/acars.js';
import { AISDecoder } from './decoders/ais.js';
import { APRSDecoder } from './decoders/aprs.js';
import type { DashboardStats, ActivityFeedItem } from '@signalforge/shared';

const PORT = parseInt(process.env.PORT || '3401');
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Services
const sdrBridge = new SDRBridge();
const satelliteService = new SatelliteService();
const adsbDecoder = new ADSBDecoder();
const acarsDecoder = new ACARSDecoder();
const aisDecoder = new AISDecoder();
const aprsDecoder = new APRSDecoder();

// Start decoders
adsbDecoder.start();
acarsDecoder.start();
aisDecoder.start();
aprsDecoder.start();

// Activity feed
const activityFeed: ActivityFeedItem[] = [];
const MAX_ACTIVITY = 100;

function addActivity(item: Omit<ActivityFeedItem, 'id'>) {
  const entry: ActivityFeedItem = { ...item, id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
  activityFeed.unshift(entry);
  if (activityFeed.length > MAX_ACTIVITY) activityFeed.pop();
  // Broadcast to WS clients
  broadcast({ type: 'activity', item: entry });
}

adsbDecoder.on('message', (msg) => {
  if (msg.callsign) {
    addActivity({ type: 'aircraft', icon: '✈️', title: `${msg.callsign}`, detail: `FL${Math.round((msg.altitude || 0) / 100)} ${msg.speed || 0}kts`, timestamp: msg.timestamp });
  }
  broadcast({ type: 'adsb', aircraft: adsbDecoder.getAircraft() });
});

acarsDecoder.on('message', (msg) => {
  addActivity({ type: 'acars', icon: '📡', title: `ACARS ${msg.flightNumber || ''}`, detail: msg.messageText.slice(0, 60), timestamp: msg.timestamp });
  broadcast({ type: 'acars_message', message: msg });
});

aisDecoder.on('message', (msg) => {
  if (msg.shipName) {
    addActivity({ type: 'vessel', icon: '🚢', title: msg.shipName, detail: `${msg.sog?.toFixed(1) || 0} kts → ${msg.destination || '?'}`, timestamp: msg.timestamp });
  }
  broadcast({ type: 'ais', vessels: aisDecoder.getVessels() });
});

aprsDecoder.on('message', (pkt) => {
  addActivity({ type: 'aprs', icon: '📍', title: pkt.source, detail: pkt.comment || pkt.dataType, timestamp: pkt.timestamp });
  broadcast({ type: 'aprs', stations: aprsDecoder.getStations() });
});

// Broadcast to all WS clients
function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ============================================================================
// REST endpoints
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({
    name: 'SignalForge',
    version: '0.2.0',
    uptime: process.uptime(),
    status: 'operational',
  });
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
    if (search) {
      satellites = satellites.filter(s => s.name.toLowerCase().includes(search));
    }
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
  const lat = parseFloat(req.query.lat as string) || 55.4583;
  const lon = parseFloat(req.query.lon as string) || -4.6298;
  const alt = parseFloat(req.query.alt as string) || 20;
  const hours = parseFloat(req.query.hours as string) || 24;

  try {
    const passes = await satelliteService.predictPassesForSat(catalogNumber, { name: 'Observer', latitude: lat, longitude: lon, altitude: alt }, hours);
    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/satellites/passes', async (req, res) => {
  const lat = parseFloat(req.query.lat as string) || 55.4583;
  const lon = parseFloat(req.query.lon as string) || -4.6298;
  const alt = parseFloat(req.query.alt as string) || 20;
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
app.get('/api/aircraft', (_req, res) => {
  res.json(adsbDecoder.getAircraft());
});

app.get('/api/acars', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(acarsDecoder.getMessages(limit));
});

app.get('/api/vessels', (_req, res) => {
  res.json(aisDecoder.getVessels());
});

app.get('/api/aprs', (_req, res) => {
  res.json(aprsDecoder.getStations());
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
      id: 'satellite-monitor', name: 'Satellite Monitor', description: 'Track and decode satellite signals',
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
      id: 'aprs-station', name: 'APRS Station', description: 'APRS packet decoding for RAYNET emergency comms',
      icon: '📍', category: 'decoder',
      nodes: [
        { type: 'sdr_source', position: { x: 80, y: 200 }, params: { freq: 144.8e6, rate: 250000 } },
        { type: 'fm_demod', position: { x: 340, y: 200 }, params: { bandwidth: 12500 } },
        { type: 'aprs_decoder', position: { x: 580, y: 200 }, params: {} },
        { type: 'fft', position: { x: 340, y: 80 }, params: { size: 2048 } },
        { type: 'spectrum', position: { x: 580, y: 80 }, params: {} },
      ],
      connections: [
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 1, targetPort: 'iq-in-0' },
        { sourceNode: 1, sourcePort: 'audio-out-0', targetNode: 2, targetPort: 'audio-in-0' },
        { sourceNode: 0, sourcePort: 'iq-out-0', targetNode: 3, targetPort: 'iq-in-0' },
        { sourceNode: 3, sourcePort: 'fft-out-0', targetNode: 4, targetPort: 'fft-in-0' },
      ],
    },
    {
      id: 'spectrum-analyzer', name: 'Spectrum Analyzer', description: 'Wideband spectrum analysis and monitoring',
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
  ]);
});

// ============================================================================
// WebSocket handling
// ============================================================================

wss.on('connection', (ws: WebSocket) => {
  console.log('⚡ Client connected');

  // Send initial state
  ws.send(JSON.stringify({ type: 'adsb', aircraft: adsbDecoder.getAircraft() }));
  ws.send(JSON.stringify({ type: 'ais', vessels: aisDecoder.getVessels() }));
  ws.send(JSON.stringify({ type: 'aprs', stations: aprsDecoder.getStations() }));

  // Start demo IQ stream
  const streamInterval = sdrBridge.startDemoStream((frame) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frame.samples.buffer, { binary: true });
    }
  });

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
    clearInterval(streamInterval);
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
    case 'subscribe':
      // Client subscribes to specific data streams
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
  ⚡ ║     Universal Radio Platform v0.2     ║
  ⚡ ╠═══════════════════════════════════════╣
  ⚡ ║  HTTP:  http://0.0.0.0:${PORT}            ║
  ⚡ ║  WS:    ws://0.0.0.0:${PORT}/ws           ║
  ⚡ ║  Decoders: ADS-B AIS ACARS APRS      ║
  ⚡ ╚═══════════════════════════════════════╝
  `);
});
