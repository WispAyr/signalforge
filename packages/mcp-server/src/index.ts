#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import WebSocket from 'ws';

/**
 * SignalForge MCP Server
 * 
 * Exposes SignalForge's entire API as 30+ MCP tools for AI agents.
 * 
 * Usage:
 *   npx @signalforge/mcp-server
 *   SIGNALFORGE_URL=http://host:3401 npx @signalforge/mcp-server
 * 
 * AI agents can:
 * - Connect/disconnect SDR hardware, tune frequencies
 * - Start/stop decoders (ADS-B, AIS, ACARS, POCSAG, FLEX, SSTV, VDL2, rtl_433...)
 * - Track satellites, predict passes, schedule observations
 * - Manage flowgraphs (load, save, connect nodes)
 * - Scan WiFi/Bluetooth, detect trackers
 * - Send/receive Meshtastic messages
 * - Run TSCM counter-surveillance sweeps
 * - Query IoT devices, utility meters
 * - Get propagation data, band conditions
 * - Search logbook, add entries
 * - Capture waterfall snapshots
 * - Stream audio
 * - Monitor system health
 */

const API_BASE = process.env.SIGNALFORGE_URL || 'http://localhost:3401';
const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws';

const server = new Server(
  { name: 'signalforge', version: '0.10.0' },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ──────────────────────────────────────────────

interface ToolDef {
  description: string;
  inputSchema: Record<string, any>;
}

const TOOLS: Record<string, ToolDef> = {
  // SDR Control
  sdr_connect: {
    description: 'Connect to SDR hardware (RTL-SDR, Airspy, HackRF, SDRplay)',
    inputSchema: {
      type: 'object',
      properties: {
        sdr_type: { type: 'string', enum: ['rtl_sdr', 'airspy', 'hackrf', 'sdrplay'], description: 'SDR hardware type' },
        serial: { type: 'string', description: 'Device serial number (optional)' },
      },
    },
  },
  sdr_disconnect: {
    description: 'Disconnect from SDR hardware',
    inputSchema: { type: 'object', properties: {} },
  },
  sdr_tune: {
    description: 'Tune SDR to a specific frequency',
    inputSchema: {
      type: 'object',
      properties: {
        frequency: { type: 'number', description: 'Frequency in Hz' },
        sample_rate: { type: 'number', description: 'Sample rate in Hz' },
        gain: { type: 'number', description: 'Gain in dB' },
        mode: { type: 'string', enum: ['nfm', 'wfm', 'am', 'usb', 'lsb', 'cw'], description: 'Demodulation mode' },
      },
      required: ['frequency'],
    },
  },
  sdr_status: {
    description: 'Get current SDR hardware status (connected, frequency, sample rate, gain)',
    inputSchema: { type: 'object', properties: {} },
  },

  // Satellite Tracking
  satellites_list: {
    description: 'List tracked satellites with positions',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['all', 'weather', 'noaa', 'goes', 'amateur', 'leo', 'geo'], description: 'Filter by category' },
      },
    },
  },
  satellites_passes: {
    description: 'Get upcoming satellite passes for your location',
    inputSchema: {
      type: 'object',
      properties: {
        satellite: { type: 'string', description: 'Satellite NORAD ID or name' },
        days: { type: 'number', description: 'Number of days to predict (default 3)' },
      },
      required: ['satellite'],
    },
  },
  satellites_track: {
    description: 'Start tracking a satellite (auto-tune, doppler correction)',
    inputSchema: {
      type: 'object',
      properties: {
        satellite: { type: 'string', description: 'Satellite NORAD ID or name' },
        doppler: { type: 'boolean', description: 'Enable Doppler correction' },
      },
      required: ['satellite'],
    },
  },

  // Decoders
  decoder_start: {
    description: 'Start a signal decoder',
    inputSchema: {
      type: 'object',
      properties: {
        decoder: { type: 'string', enum: ['adsb', 'ais', 'acars', 'aprs', 'pocsag', 'flex', 'sstv', 'vdl2', 'rtl433', 'meters', 'noaa', 'goes', 'dmr', 'dstar', 'c4fm'], description: 'Decoder type' },
        frequency: { type: 'number', description: 'Frequency in Hz' },
        config: { type: 'object', description: 'Decoder-specific config' },
      },
      required: ['decoder'],
    },
  },
  decoder_stop: {
    description: 'Stop a signal decoder',
    inputSchema: {
      type: 'object',
      properties: { decoder: { type: 'string', description: 'Decoder to stop' } },
      required: ['decoder'],
    },
  },
  decoder_status: {
    description: 'Get status and message counts for all active decoders',
    inputSchema: { type: 'object', properties: {} },
  },

  // Map & Tracking
  map_entities: {
    description: 'Get tracked entities on the map (aircraft, ships, APRS stations, satellites)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['all', 'aircraft', 'ships', 'satellites', 'stations'], description: 'Entity type filter' },
      },
    },
  },

  // Frequency Scanning
  scanner_start: {
    description: 'Start frequency scanning in a range',
    inputSchema: {
      type: 'object',
      properties: {
        start_freq: { type: 'number', description: 'Start frequency in Hz' },
        end_freq: { type: 'number', description: 'End frequency in Hz' },
        step: { type: 'number', description: 'Step size in Hz' },
        threshold: { type: 'number', description: 'Signal threshold in dB' },
      },
      required: ['start_freq', 'end_freq'],
    },
  },
  scanner_stop: {
    description: 'Stop frequency scanning',
    inputSchema: { type: 'object', properties: {} },
  },

  // Flowgraph
  flowgraph_load: {
    description: 'Load a signal processing flowgraph',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Flowgraph name or JSON config' } },
      required: ['name'],
    },
  },
  flowgraph_save: {
    description: 'Save current flowgraph configuration',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name to save as' } },
      required: ['name'],
    },
  },

  // Recordings
  recordings_list: {
    description: 'List signal recordings',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results' } },
    },
  },
  recordings_start: {
    description: 'Start recording from current frequency',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Recording name' },
        duration: { type: 'number', description: 'Duration in seconds (0=indefinite)' },
      },
      required: ['name'],
    },
  },
  recordings_stop: {
    description: 'Stop current recording',
    inputSchema: { type: 'object', properties: {} },
  },

  // Logbook
  logbook_add: {
    description: 'Add an entry to the radio logbook',
    inputSchema: {
      type: 'object',
      properties: {
        callsign: { type: 'string' },
        frequency: { type: 'number', description: 'Frequency in Hz' },
        mode: { type: 'string', description: 'Mode (SSB, CW, FM, etc.)' },
        signal_report: { type: 'string', description: 'RST report' },
        notes: { type: 'string' },
      },
      required: ['callsign', 'frequency', 'mode'],
    },
  },
  logbook_search: {
    description: 'Search the logbook by callsign, date, band, or mode',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        from: { type: 'string', description: 'Start date ISO' },
        to: { type: 'string', description: 'End date ISO' },
      },
    },
  },

  // Signal Identification
  signals_identify: {
    description: 'Identify what signal is on a given frequency',
    inputSchema: {
      type: 'object',
      properties: { frequency: { type: 'number', description: 'Frequency in Hz' } },
      required: ['frequency'],
    },
  },

  // Alerts
  alerts_list: {
    description: 'List active alerts (geofence, signal, decoder)',
    inputSchema: { type: 'object', properties: {} },
  },
  alerts_create: {
    description: 'Create a new alert trigger',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['geo', 'signal', 'message'] },
        condition: { type: 'object', description: 'Alert condition' },
        action: { type: 'string', description: 'Action when triggered' },
      },
      required: ['type', 'condition'],
    },
  },

  // Propagation
  propagation_conditions: {
    description: 'Get current HF band conditions, solar data (SFI, K-index), and MUF predictions',
    inputSchema: { type: 'object', properties: {} },
  },

  // Edge Nodes
  edge_nodes_list: {
    description: 'List connected edge nodes (remote SDR locations)',
    inputSchema: { type: 'object', properties: {} },
  },

  // Waterfall
  waterfall_snapshot: {
    description: 'Capture current waterfall/spectrogram as image',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['png', 'jpg'] },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
  },

  // Audio
  audio_stream_start: {
    description: 'Start streaming demodulated audio',
    inputSchema: {
      type: 'object',
      properties: {
        frequency: { type: 'number' },
        mode: { type: 'string', enum: ['nfm', 'wfm', 'am', 'usb', 'lsb'] },
      },
      required: ['frequency'],
    },
  },
  audio_stream_stop: {
    description: 'Stop audio streaming',
    inputSchema: { type: 'object', properties: {} },
  },

  // IoT Devices (rtl_433)
  iot_devices: {
    description: 'List discovered 433MHz IoT devices (weather stations, TPMS, doorbells)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['all', 'weather', 'tpms', 'doorbell', 'sensor'] },
      },
    },
  },

  // WiFi Scanner
  wifi_scan: {
    description: 'Scan WiFi networks (APs, clients, channel usage)',
    inputSchema: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Scan duration in seconds' },
      },
    },
  },

  // Bluetooth Scanner
  bluetooth_scan: {
    description: 'Scan for Bluetooth devices (BLE, Classic, AirTag/tracker detection)',
    inputSchema: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Scan duration in seconds' },
        detect_trackers: { type: 'boolean', description: 'Enable AirTag/tracker detection' },
      },
    },
  },

  // Meshtastic
  meshtastic_nodes: {
    description: 'List Meshtastic LoRa mesh network nodes',
    inputSchema: { type: 'object', properties: {} },
  },
  meshtastic_send: {
    description: 'Send a message via Meshtastic mesh network',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text' },
        to: { type: 'string', description: 'Destination node ID (optional, broadcast if omitted)' },
      },
      required: ['text'],
    },
  },

  // TSCM Counter-Surveillance
  tscm_sweep: {
    description: 'Run a TSCM counter-surveillance RF sweep to detect bugs/transmitters',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Location name for the sweep' },
        baseline_id: { type: 'string', description: 'Baseline recording ID to compare against' },
      },
    },
  },

  // Observation Scheduling
  observation_schedule: {
    description: 'Schedule an automated satellite observation',
    inputSchema: {
      type: 'object',
      properties: {
        satellite: { type: 'string', description: 'Satellite name or NORAD ID' },
        start_time: { type: 'string', description: 'ISO timestamp' },
        end_time: { type: 'string', description: 'ISO timestamp' },
        decoder: { type: 'string', description: 'Decoder to use' },
      },
      required: ['satellite', 'start_time', 'end_time'],
    },
  },

  // System Health
  system_health: {
    description: 'Get overall SignalForge system health (all components, memory, uptime)',
    inputSchema: { type: 'object', properties: {} },
  },

  // Aaronia Spectran
  aaronia_connect: {
    description: 'Connect to an Aaronia Spectran V6 spectrum analyzer via RTSA-Suite PRO HTTP API',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Aaronia RTSA-Suite PRO host (default: 127.0.0.1)' },
        port: { type: 'number', description: 'HTTP API port (default: 54664)' },
      },
    },
  },
  aaronia_sweep: {
    description: 'Run a spectrum sweep on Aaronia Spectran V6. Supports TSCM profiles: quick-room, thorough-sweep, gsm-focus, wifi-camera, emc-pre-compliance, near-field-probe',
    inputSchema: {
      type: 'object',
      properties: {
        start_frequency: { type: 'number', description: 'Start frequency in Hz' },
        stop_frequency: { type: 'number', description: 'Stop frequency in Hz' },
        rbw: { type: 'number', description: 'Resolution bandwidth in Hz' },
        detector: { type: 'string', enum: ['peak', 'rms', 'average', 'sample'], description: 'Detector type' },
        profile: { type: 'string', description: 'TSCM profile name (overrides other params)' },
      },
    },
  },
  aaronia_status: {
    description: 'Get Aaronia Spectran V6 connection status, current sweep info, and device details',
    inputSchema: { type: 'object', properties: {} },
  },
};

// ── Request Handlers ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    const msg = error.response?.data?.error || error.message || String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Tool Implementations ──────────────────────────────────────────

async function api(method: 'get' | 'post' | 'put' | 'delete', path: string, data?: any) {
  const resp = await axios({ method, url: `${API_BASE}${path}`, data, timeout: 30000 });
  return resp.data;
}

async function handleTool(name: string, args: any) {
  switch (name) {
    // SDR
    case 'sdr_connect':
      return api('post', '/api/sdr/connect', args);
    case 'sdr_disconnect':
      return api('post', '/api/sdr/disconnect');
    case 'sdr_tune':
      return api('post', '/api/sdr/tune', args);
    case 'sdr_status':
      return api('get', '/api/sdr/status');

    // Satellites
    case 'satellites_list':
      return api('get', `/api/satellites${args.category ? `?category=${args.category}` : ''}`);
    case 'satellites_passes':
      return api('get', `/api/satellites/${encodeURIComponent(args.satellite)}/passes?days=${args.days || 3}`);
    case 'satellites_track':
      return api('post', `/api/satellites/${encodeURIComponent(args.satellite)}/track`, args);

    // Decoders
    case 'decoder_start':
      return api('post', `/api/decoders/${args.decoder}/start`, args.config || {});
    case 'decoder_stop':
      return api('post', `/api/decoders/${args.decoder}/stop`);
    case 'decoder_status':
      return api('get', '/api/analytics/decoders');

    // Map
    case 'map_entities': {
      const t = args.type || 'all';
      if (t === 'aircraft') return api('get', '/api/adsb/aircraft');
      if (t === 'ships') return api('get', '/api/ais/ships');
      if (t === 'satellites') return api('get', '/api/satellites');
      if (t === 'stations') return api('get', '/api/aprs/stations');
      const [aircraft, ships] = await Promise.all([
        api('get', '/api/adsb/aircraft').catch(() => []),
        api('get', '/api/ais/ships').catch(() => []),
      ]);
      return { aircraft, ships };
    }

    // Scanner
    case 'scanner_start':
      return api('post', '/api/scanner/start', args);
    case 'scanner_stop':
      return api('post', '/api/scanner/stop');

    // Flowgraph
    case 'flowgraph_load':
      return api('post', '/api/flowgraph/load', args);
    case 'flowgraph_save':
      return api('post', '/api/flowgraph/save', args);

    // Recordings
    case 'recordings_list':
      return api('get', `/api/waterfall/recordings?limit=${args.limit || 50}`);
    case 'recordings_start':
      return api('post', '/api/waterfall/record/start', args);
    case 'recordings_stop':
      return api('post', '/api/waterfall/record/stop');

    // Logbook
    case 'logbook_add':
      return api('post', '/api/logbook', args);
    case 'logbook_search':
      return api('get', `/api/logbook?q=${encodeURIComponent(args.query || '')}`);

    // Signals
    case 'signals_identify':
      return api('get', `/api/signals/identify?frequency=${args.frequency}`);

    // Alerts
    case 'alerts_list':
      return api('get', '/api/geofence/alerts');
    case 'alerts_create':
      return api('post', '/api/geofence/zones', args);

    // Propagation
    case 'propagation_conditions': {
      const [solar, bands] = await Promise.all([
        api('get', '/api/propagation/solar'),
        api('get', '/api/propagation/bands'),
      ]);
      return { solar, bands };
    }

    // Edge Nodes
    case 'edge_nodes_list':
      return api('get', '/api/edge/nodes');

    // Waterfall
    case 'waterfall_snapshot':
      return api('get', '/api/waterfall/gallery?limit=1');

    // Audio
    case 'audio_stream_start':
      return api('post', '/api/audio/streams', args);
    case 'audio_stream_stop':
      return api('post', '/api/audio/streams/current/stop');

    // IoT (rtl_433)
    case 'iot_devices':
      return api('get', `/api/rtl433/devices${args.type ? `?type=${args.type}` : ''}`);

    // WiFi
    case 'wifi_scan':
      return api('post', '/api/wifi/scan', args);

    // Bluetooth
    case 'bluetooth_scan':
      return api('post', '/api/bluetooth/scan', args);

    // Meshtastic
    case 'meshtastic_nodes':
      return api('get', '/api/meshtastic/nodes');
    case 'meshtastic_send':
      return api('post', '/api/meshtastic/send', args);

    // TSCM
    case 'tscm_sweep':
      return api('post', '/api/tscm/sweep', args);

    // Observation
    case 'observation_schedule':
      return api('post', '/api/scheduler/observations', args);

    // System
    case 'system_health':
      return api('get', '/api/health');

    // Aaronia Spectran
    case 'aaronia_connect':
      return api('post', '/api/aaronia/connect', { host: args.host, port: args.port });
    case 'aaronia_sweep':
      if (args.profile) {
        return api('post', `/api/aaronia/tscm/${args.profile}`);
      }
      return api('post', '/api/aaronia/sweep', {
        startFrequency: args.start_frequency,
        stopFrequency: args.stop_frequency,
        rbw: args.rbw,
        detector: args.detector,
      });
    case 'aaronia_status':
      return api('get', '/api/aaronia/status');

    default:
      return { error: 'unknown_tool', tool: name };
  }
}

// ── WebSocket (real-time feed) ────────────────────────────────────

let ws: WebSocket | null = null;

function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => console.error('[signalforge-mcp] WebSocket connected'));
    ws.on('error', () => {});
    ws.on('close', () => setTimeout(connectWebSocket, 10000));
  } catch {
    setTimeout(connectWebSocket, 10000);
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[signalforge-mcp] Server running — ${Object.keys(TOOLS).length} tools available`);
  console.error(`[signalforge-mcp] API: ${API_BASE}`);
  connectWebSocket();
}

main().catch((err) => {
  console.error('[signalforge-mcp] Fatal:', err);
  process.exit(1);
});
