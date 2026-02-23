import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { SDRBridge } from './sdr/bridge.js';
import { SatelliteService } from './satellite/service.js';

const PORT = parseInt(process.env.PORT || '3401');
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Services
const sdrBridge = new SDRBridge();
const satelliteService = new SatelliteService();

// REST endpoints
app.get('/api/health', (_req, res) => {
  res.json({
    name: 'SignalForge',
    version: '0.1.0',
    uptime: process.uptime(),
    status: 'operational',
  });
});

app.get('/api/devices', (_req, res) => {
  res.json(sdrBridge.getDevices());
});

app.get('/api/satellites', async (_req, res) => {
  const satellites = await satelliteService.getSatellites();
  res.json(satellites);
});

app.get('/api/satellites/passes', async (req, res) => {
  const lat = parseFloat(req.query.lat as string) || 51.5074;
  const lon = parseFloat(req.query.lon as string) || -0.1278;
  const alt = parseFloat(req.query.alt as string) || 0;
  const hours = parseFloat(req.query.hours as string) || 24;

  const passes = await satelliteService.predictPasses(
    { name: 'Observer', latitude: lat, longitude: lon, altitude: alt },
    hours
  );
  res.json(passes);
});

// WebSocket handling
wss.on('connection', (ws: WebSocket) => {
  console.log('⚡ Client connected');

  // Start demo IQ stream
  const streamInterval = sdrBridge.startDemoStream((frame) => {
    if (ws.readyState === WebSocket.OPEN) {
      // Send binary IQ data
      const header = new ArrayBuffer(16);
      const view = new DataView(header);
      view.setUint32(0, frame.sequence, true);
      view.setFloat32(4, frame.sampleRate, true);
      view.setFloat32(8, frame.centerFrequency, true);
      view.setFloat64(8, frame.timestamp, true);

      ws.send(frame.samples.buffer, { binary: true });
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleCommand(ws, msg);
    } catch {
      // Binary data or invalid JSON — ignore
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
    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown command: ${msg.type}` }));
  }
}

server.listen(PORT, () => {
  console.log(`
  ⚡ ╔═══════════════════════════════════════╗
  ⚡ ║         S I G N A L F O R G E         ║
  ⚡ ║     Universal Radio Platform v0.1     ║
  ⚡ ╠═══════════════════════════════════════╣
  ⚡ ║  HTTP:  http://localhost:${PORT}          ║
  ⚡ ║  WS:    ws://localhost:${PORT}/ws         ║
  ⚡ ╚═══════════════════════════════════════╝
  `);
});
