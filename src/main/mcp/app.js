// Glue between the app and the MCP server: start/stop it from Settings, keep the token,
// write <userData>/mcp.json for the stdio bridge, keep the activity log, and build the setup
// snippets shown in Settings → AI assistants. See docs/mcp.md.

const fs = require('fs');
const path = require('path');
const { startMcpServer, newToken, DEFAULT_PORT } = require('./server');

const LOG_SIZE = 50;

// How to start `oknetwork --mcp` on this machine (for Claude Desktop's config).
function bridgeCommand({ packaged, execPath, appPath, env = process.env }) {
  if (!packaged) return { command: execPath, args: [appPath, '--mcp'] }; // npm start (development)
  if (env.SNAP) return { command: '/snap/bin/oknetwork', args: ['--mcp'] };
  if (env.APPIMAGE) return { command: env.APPIMAGE, args: ['--mcp'] };
  return { command: execPath, args: ['--mcp'] };
}

function snippets({ port, token, bridge }) {
  const url = `http://127.0.0.1:${port}/mcp`;
  const headers = { Authorization: `Bearer ${token}` };
  const json = (o) => JSON.stringify(o, null, 2);
  return {
    url,
    claudeCode: `claude mcp add --transport http --scope user oknetwork ${url} --header "Authorization: Bearer ${token}"`,
    claudeDesktop: json({ mcpServers: { oknetwork: { command: bridge.command, args: bridge.args } } }),
    cursor: json({ mcpServers: { oknetwork: { url, headers } } }),
    vscode: json({ servers: { oknetwork: { type: 'http', url, headers } } }),
    // Oh My Pi (omp): ~/.omp/agent/mcp.json; HTTP servers need "type": "http" (its mcp-schema.json).
    ohMyPi: json({ mcpServers: { oknetwork: { type: 'http', url, headers } } }),
  };
}

// deps: { store, userData, version, bridge, ctx (see tools.js minus client), onActivity(entry) }
function createMcp({ store, userData, version, bridge, ctx, onActivity = () => {} }) {
  const configFile = path.join(userData, 'mcp.json');
  const activity = [];
  let server = null;
  let error = null;

  const settings = () => {
    const s = store.data.settings;
    s.mcp = { enabled: false, allowWrites: false, port: DEFAULT_PORT, token: '', ...s.mcp };
    return s.mcp;
  };

  function writeConfig(port, token) {
    fs.writeFileSync(configFile, JSON.stringify({ port, token }), { mode: 0o600 });
  }
  function removeConfig() {
    try { fs.unlinkSync(configFile); } catch { /* not there */ }
  }

  async function start() {
    const s = settings();
    if (!s.enabled || server) return;
    if (!s.token) { s.token = newToken(); store.save(); }
    try {
      server = await startMcpServer({
        token: s.token, port: s.port, version, ctx,
        allowWrites: () => settings().allowWrites,
        onCall: (entry) => {
          activity.unshift(entry);
          activity.length = Math.min(activity.length, LOG_SIZE);
          onActivity(entry);
        },
      });
      error = null;
      writeConfig(server.port, s.token);
    } catch (e) {
      server = null;
      error = e.message;
      console.error('MCP server did not start:', e.message);
    }
  }

  async function stop() {
    const s = server;
    server = null;
    removeConfig();
    if (s) await s.close();
  }

  function status() {
    const s = settings();
    const port = server?.port || s.port;
    return {
      enabled: s.enabled,
      allowWrites: s.allowWrites,
      running: !!server,
      port,
      error,
      sessions: server?.sessions() || 0,
      activity,
      setup: s.token ? snippets({ port, token: s.token, bridge }) : null,
    };
  }

  // Settings → AI assistants switches.
  async function set({ enabled, allowWrites }) {
    const s = settings();
    if (typeof allowWrites === 'boolean') {
      s.allowWrites = allowWrites;
      server?.setAllowWrites(allowWrites);
    }
    if (typeof enabled === 'boolean' && enabled !== s.enabled) {
      s.enabled = enabled;
      store.save();
      await (enabled ? start() : stop());
    } else {
      store.save();
    }
    return status();
  }

  // New token: disconnects every assistant (they need the new setup).
  async function resetToken() {
    const s = settings();
    s.token = newToken();
    store.save();
    if (server) { await stop(); await start(); }
    return status();
  }

  return { start, stop, status, set, resetToken };
}

module.exports = { createMcp, bridgeCommand, snippets };
