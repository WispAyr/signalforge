/**
 * SignalForge MCP Server
 * Exposes SignalForge SDR control as MCP tools over HTTP
 * 
 * Run standalone: node dist/mcp/index.js
 * Or via PM2 as signalforge-mcp
 */
import express from 'express';
import cors from 'cors';

const SIGNALFORGE_URL = process.env.SIGNALFORGE_URL || 'http://127.0.0.1:3401';
const MCP_PORT = parseInt(process.env.MCP_PORT || '5100');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Helper ──────────────────────────────────────────────────────────────────

async function sfetch(path: string, opts: RequestInit = {}): Promise<any> {
  const url = `${SIGNALFORGE_URL}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers as any },
      ...opts,
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (err: any) {
    return { error: `Failed to reach SignalForge: ${err.message}` };
  }
}

// ─── MCP Protocol ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'scan_profile',
    description: 'Activate a frequency scanning profile (e.g. uk-fire, uk-pager, uk-marine, airband, pmr446). Retunes SDR and creates all receivers.',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string', description: 'Profile ID to activate' },
        stream: { type: 'boolean', description: 'Whether to enable audio streaming' },
      },
      required: ['profile_id'],
    },
  },
  {
    name: 'tune',
    description: 'Retune the SDR to a specific center frequency',
    inputSchema: {
      type: 'object',
      properties: {
        centerFreq: { type: 'number', description: 'Center frequency in Hz' },
        sampleRate: { type: 'number', description: 'Sample rate (default 2048000)' },
        gain: { type: 'number', description: 'Gain in dB (default 40)' },
      },
      required: ['centerFreq'],
    },
  },
  {
    name: 'add_receiver',
    description: 'Add a virtual receiver at a specific frequency',
    inputSchema: {
      type: 'object',
      properties: {
        freq: { type: 'number', description: 'Frequency in Hz' },
        mode: { type: 'string', description: 'Demod mode: NFM, WFM, AM, USB, LSB' },
        label: { type: 'string', description: 'Display label' },
        decoder: { type: 'string', description: 'Decoder: none, multimon-ng' },
        bw: { type: 'number', description: 'Bandwidth in Hz (default 12500)' },
      },
      required: ['freq', 'mode'],
    },
  },
  {
    name: 'remove_receiver',
    description: 'Remove a virtual receiver by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'remove_all_receivers',
    description: 'Remove all virtual receivers',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_receivers',
    description: 'List all active virtual receivers',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_status',
    description: 'Get SDR multiplexer status including connection state, frequency, and active profile',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_profiles',
    description: 'List all available frequency scanning profiles',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pause_scanning',
    description: 'Pause the current background flow (keeps config, removes receivers)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resume_scanning',
    description: 'Resume the previously paused background flow',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'deactivate_profile',
    description: 'Deactivate current profile and resume previous background flow',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_audio_url',
    description: 'Get the audio stream URL for a receiver',
    inputSchema: {
      type: 'object',
      properties: { receiver_id: { type: 'string' } },
      required: ['receiver_id'],
    },
  },
];

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'scan_profile':
      return await sfetch(`/api/sdr/profiles/${args.profile_id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ stream: args.stream }),
      });

    case 'tune':
      return await sfetch('/api/sdr/multiplexer/tune', {
        method: 'POST',
        body: JSON.stringify({
          centerFreq: args.centerFreq,
          sampleRate: args.sampleRate || 2048000,
          gain: args.gain || 40,
        }),
      });

    case 'add_receiver':
      return await sfetch('/api/sdr/multiplexer/receiver', {
        method: 'POST',
        body: JSON.stringify({
          centerFreq: args.freq,
          bandwidth: args.bw || 12500,
          mode: args.mode,
          label: args.label || `${(args.freq / 1e6).toFixed(4)} MHz`,
          decoder: args.decoder || 'none',
          outputRate: 22050,
        }),
      });

    case 'remove_receiver':
      return await sfetch(`/api/sdr/multiplexer/receiver/${args.id}`, { method: 'DELETE' });

    case 'remove_all_receivers': {
      const status = await sfetch('/api/sdr/multiplexer/status');
      if (status.receivers) {
        for (const rx of status.receivers) {
          await sfetch(`/api/sdr/multiplexer/receiver/${rx.id}`, { method: 'DELETE' });
        }
      }
      return { ok: true, removed: status.receivers?.length || 0 };
    }

    case 'list_receivers': {
      const status = await sfetch('/api/sdr/multiplexer/status');
      return status.receivers || [];
    }

    case 'get_status': {
      const status = await sfetch('/api/sdr/multiplexer/status');
      const active = await sfetch('/api/sdr/profiles/active');
      return { ...status, activeProfile: active?.profileId || null };
    }

    case 'list_profiles':
      return await sfetch('/api/sdr/profiles');

    case 'pause_scanning':
      return await sfetch('/api/background-flows/pager-decoder/pause', { method: 'POST' });

    case 'resume_scanning':
      return await sfetch('/api/background-flows/pager-decoder/resume', { method: 'POST' });

    case 'deactivate_profile':
      return await sfetch('/api/sdr/profiles/deactivate', { method: 'POST' });

    case 'get_audio_url':
      return {
        streamUrl: `${SIGNALFORGE_URL}/api/sdr/receiver/${args.receiver_id}/audio`,
        playerUrl: `${SIGNALFORGE_URL}/api/sdr/listen/${args.receiver_id}`,
      };

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP JSON-RPC Endpoint ───────────────────────────────────────────────────

app.post('/mcp', async (req, res) => {
  const { method, params, id } = req.body;

  switch (method) {
    case 'initialize':
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'signalforge-mcp', version: '1.0.0' },
        },
      });

    case 'tools/list':
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await handleTool(name, args || {});
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (err: any) {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        });
      }
    }

    case 'resources/list':
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            { uri: 'signalforge://status', name: 'SDR Status', mimeType: 'application/json' },
            { uri: 'signalforge://profiles', name: 'Frequency Profiles', mimeType: 'application/json' },
          ],
        },
      });

    case 'resources/read': {
      const uri = params?.uri;
      let content: any;
      if (uri === 'signalforge://status') {
        content = await sfetch('/api/sdr/multiplexer/status');
      } else if (uri === 'signalforge://profiles') {
        content = await sfetch('/api/sdr/profiles');
      } else {
        return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${uri}` } });
      }
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(content, null, 2) }],
        },
      });
    }

    default:
      return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
});

// ─── Health & Info ───────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'signalforge-mcp', port: MCP_PORT });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'SignalForge MCP Server',
    version: '1.0.0',
    tools: TOOLS.map(t => t.name),
    endpoint: '/mcp',
    signalforge: SIGNALFORGE_URL,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(MCP_PORT, '0.0.0.0', () => {
  console.log(`🔌 SignalForge MCP server on http://0.0.0.0:${MCP_PORT}`);
  console.log(`   SignalForge API: ${SIGNALFORGE_URL}`);
  console.log(`   MCP endpoint: http://0.0.0.0:${MCP_PORT}/mcp`);
});
