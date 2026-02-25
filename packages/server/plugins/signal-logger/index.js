// Signal Logger Plugin — logs decoded signals to CSV files
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

let logDir = '';
let config = {};
let subscriptions = [];

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function appendCSV(filename, headers, values) {
  const filepath = join(logDir, `${filename}-${dateStr()}.csv`);
  const exists = existsSync(filepath);
  if (!exists) {
    appendFileSync(filepath, headers.join(',') + '\n');
  }
  appendFileSync(filepath, values.map(csvEscape).join(',') + '\n');
}

export default {
  activate(ctx) {
    config = ctx.getConfig();
    logDir = config.logDir || 'data/signal-logs';
    ensureDir(logDir);

    ctx.log(`Logging signals to ${logDir}`);

    // Track stats
    const stats = { adsb: 0, ais: 0, aprs: 0, pager: 0, startTime: Date.now() };

    // Register WebSocket handlers to intercept decoder events
    if (config.logAdsb !== false) {
      ctx.registerWebSocket('adsb_log', (data) => {
        if (!data.callsign) return;
        appendCSV('adsb',
          ['timestamp', 'icao', 'callsign', 'lat', 'lon', 'altitude', 'speed', 'heading', 'squawk'],
          [timestamp(), data.icao, data.callsign, data.latitude, data.longitude, data.altitude, data.speed, data.heading, data.squawk]
        );
        stats.adsb++;
      });
    }

    if (config.logAis !== false) {
      ctx.registerWebSocket('ais_log', (data) => {
        appendCSV('ais',
          ['timestamp', 'mmsi', 'name', 'lat', 'lon', 'speed', 'course', 'destination', 'ship_type'],
          [timestamp(), data.mmsi, data.shipName, data.latitude, data.longitude, data.sog, data.cog, data.destination, data.shipType]
        );
        stats.ais++;
      });
    }

    if (config.logAprs !== false) {
      ctx.registerWebSocket('aprs_log', (data) => {
        appendCSV('aprs',
          ['timestamp', 'callsign', 'lat', 'lon', 'symbol', 'comment', 'path'],
          [timestamp(), data.source, data.latitude, data.longitude, data.symbol, data.comment, data.path]
        );
        stats.aprs++;
      });
    }

    if (config.logPager !== false) {
      ctx.registerWebSocket('pager_log', (data) => {
        appendCSV('pager',
          ['timestamp', 'protocol', 'capcode', 'content', 'baud_rate', 'frequency'],
          [timestamp(), data.protocol, data.capcode, data.content, data.baudRate, data.frequency]
        );
        stats.pager++;
      });
    }

    // Stats endpoint
    ctx.registerRoute('get', '/stats', (_req, res) => {
      res.json({
        ...stats,
        total: stats.adsb + stats.ais + stats.aprs + stats.pager,
        uptime: Date.now() - stats.startTime,
        logDir,
      });
    });

    // List log files
    ctx.registerRoute('get', '/files', (_req, res) => {
      try {
        const { readdirSync, statSync } = require('fs');
        const files = readdirSync(logDir)
          .filter(f => f.endsWith('.csv'))
          .map(f => {
            const st = statSync(join(logDir, f));
            return { name: f, size: st.size, modified: st.mtime };
          })
          .sort((a, b) => b.modified - a.modified);
        res.json(files);
      } catch {
        res.json([]);
      }
    });

    ctx.log('Signal logger active');
  },

  deactivate() {
    // Nothing to clean up — file handles are opened/closed per write
  },
};
