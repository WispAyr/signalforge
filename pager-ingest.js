// Watches pager-messages.jsonl and sends to SignalForge via WebSocket
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');

const JSONL_FILE = path.join(__dirname, 'pager-messages.jsonl');
const WS_URL = 'ws://localhost:3401/ws';

// Ensure file exists
if (!fs.existsSync(JSONL_FILE)) fs.writeFileSync(JSONL_FILE, '');

let ws = null;
let reconnectTimer = null;

function connect() {
  ws = new WebSocket(WS_URL);
  ws.on('open', () => console.log('[ingest] Connected to SignalForge WS'));
  ws.on('close', () => {
    console.log('[ingest] WS disconnected, reconnecting...');
    reconnectTimer = setTimeout(connect, 3000);
  });
  ws.on('error', (e) => console.error('[ingest] WS error:', e.message));
}

connect();

// Tail the JSONL file
let fileSize = fs.statSync(JSONL_FILE).size;

fs.watchFile(JSONL_FILE, { interval: 500 }, () => {
  const newSize = fs.statSync(JSONL_FILE).size;
  if (newSize <= fileSize) { fileSize = newSize; return; }
  
  const stream = fs.createReadStream(JSONL_FILE, { start: fileSize, encoding: 'utf8' });
  let buffer = '';
  stream.on('data', (chunk) => buffer += chunk);
  stream.on('end', () => {
    fileSize = newSize;
    const lines = buffer.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        console.log(`[ingest] ${msg.protocol} Addr:${msg.capcode} "${msg.content.slice(0,50)}"`);
        
        // Send via WebSocket as a command to process the message
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pager_inject', ...msg }));
        }
      } catch (e) {
        console.error('[ingest] Parse error:', e.message);
      }
    }
  });
});

console.log(`[ingest] Watching ${JSONL_FILE} for new messages...`);
