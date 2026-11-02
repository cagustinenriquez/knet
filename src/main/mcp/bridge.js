// `oknetwork --mcp`: a stdio MCP server for assistants that start local programs (Claude Desktop).
// It doesn't open a window or touch the data: it passes each message from stdin to the running
// app's MCP server (HTTP on 127.0.0.1, see server.js) and writes the replies to stdout.
//
// - The port and token come from <userData>/mcp.json, written by the app when MCP is on.
// - If the app isn't running, the bridge starts it in the tray and waits for it.
// - If the app restarts (the session is gone), the bridge reconnects on its own by replaying
//   the client's initialize request.
// No Electron here: `launchApp` is passed in. Messages are newline-delimited JSON (MCP stdio).

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

const LAUNCH_WAIT_MS = 20000;

const OFF_MESSAGE = 'OkNetwork\'s AI assistants connection is off. Open OkNetwork → Settings → AI assistants and turn it on.';

function readConfig(dir) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    return c.port && c.token ? c : null;
  } catch {
    return null;
  }
}

// POST one JSON-RPC message. Resolves { status, sessionId, messages[] }.
function post(cfg, message, sessionId, protocolVersion) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(message);
    const req = http.request({
      host: '127.0.0.1', port: cfg.port, path: '/mcp', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${cfg.token}`,
        'Content-Length': Buffer.byteLength(body),
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...(protocolVersion ? { 'Mcp-Protocol-Version': protocolVersion } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let messages = [];
        if (text.trim()) {
          if (String(res.headers['content-type']).includes('text/event-stream')) {
            messages = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
          } else {
            try { messages = [].concat(JSON.parse(text)); } catch { /* not JSON */ }
          }
        }
        resolve({ status: res.statusCode, sessionId: res.headers['mcp-session-id'], messages });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Options: userData (folder with mcp.json), launchApp() (start OkNetwork in the tray),
// input/output streams (default stdin/stdout), log(msg) (default stderr).
function runBridge({ userData, launchApp, input = process.stdin, output = process.stdout, log = (m) => process.stderr.write(`[oknetwork-mcp] ${m}\n`) }) {
  let sessionId = null;
  let protocolVersion = null;
  let initMessage = null; // replayed to reconnect after the app restarts
  let launchedAt = 0;

  const write = (m) => output.write(`${JSON.stringify(m)}\n`);
  const fail = (m, text) => { if (m.id !== undefined && m.method) write({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: text } }); };

  // Send with recovery: start the app if it's not running, reconnect if the session expired.
  async function send(m) {
    for (let attempt = 0; ; attempt++) {
      const cfg = readConfig(userData);
      if (!cfg && !launchApp) throw new Error(OFF_MESSAGE);
      try {
        if (!cfg) throw Object.assign(new Error('no config'), { code: 'ECONNREFUSED' });
        const r = await post(cfg, m, m.method === 'initialize' ? null : sessionId, protocolVersion);
        if (r.status === 404 && sessionId && initMessage && attempt === 0) {
          log('Session expired (OkNetwork restarted?), reconnecting.');
          await reconnect(cfg);
          continue;
        }
        if (r.status === 401) throw new Error('The token changed. Restart this MCP server in your assistant (OkNetwork → Settings → AI assistants → Reset token was used).');
        return r;
      } catch (e) {
        if (e.code !== 'ECONNREFUSED') throw e;
        // App not running (or MCP off). Start it once, then wait for its server.
        if (!launchedAt) {
          launchedAt = Date.now();
          log('OkNetwork isn\'t running; starting it in the tray.');
          launchApp();
        }
        if (Date.now() - launchedAt >= LAUNCH_WAIT_MS) throw new Error(readConfig(userData) ? 'OkNetwork isn\'t responding. Is it running?' : OFF_MESSAGE);
        await wait(500);
      }
    }
  }

  async function reconnect(cfg) {
    const r = await post(cfg, initMessage, null, null);
    if (r.status !== 200 || !r.sessionId) throw new Error('Could not reconnect to OkNetwork.');
    sessionId = r.sessionId;
    await post(cfg, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId, protocolVersion);
  }

  async function handle(m) {
    if (m.method === 'initialize') initMessage = m;
    try {
      const r = await send(m);
      if (m.method === 'initialize' && r.sessionId) {
        sessionId = r.sessionId;
        protocolVersion = r.messages[0]?.result?.protocolVersion || null;
      }
      if (r.status >= 400 && !r.messages.length) return fail(m, `OkNetwork answered HTTP ${r.status}.`);
      r.messages.forEach(write);
    } catch (e) {
      log(e.message);
      fail(m, e.message);
    }
  }

  // Handle messages one at a time, in order.
  let queue = Promise.resolve();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { log('Ignoring a line that isn\'t JSON.'); return; }
    queue = queue.then(() => handle(m));
  });
  return new Promise((resolve) => rl.on('close', () => queue.then(resolve)));
}

module.exports = { runBridge, readConfig, OFF_MESSAGE };
