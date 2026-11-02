// End-to-end test: an AI assistant connects to the running app over MCP, reads jobs, moves an
// application and edits the profile, and the app's window updates live. Then "Allow changes"
// is switched off in Settings and the write tools disappear.
//
// Runs the real app with a temporary profile (MCP on, a fixed token) and no job sources.
// Run: npm run test:e2e

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const TOKEN = 'e2e-token-0123456789';
const JOB_ID = 'remotive:e2e-mcp';
const at = new Date(Date.now() - 86400e3).toISOString();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'knet-e2e-'));
fs.writeFileSync(path.join(userData, 'knet-data.json'), JSON.stringify({
  profile: { email: 'e2e@example.com', name: 'E2E', titles: ['Frontend Developer'], skills: ['react'], years: 5, locations: ['Worldwide'] },
  settings: {
    notifications: false, threshold: 0, maxAgeDays: 30, intervalMinutes: 1440,
    sources: { posted: false, remotive: false, remoteok: false, arbeitnow: false, jobicy: false, getonbrd: false, companies: false },
    companies: [],
    mcp: { enabled: true, allowWrites: true, port: 0, token: TOKEN },
  },
  jobs: {
    [JOB_ID]: {
      id: JOB_ID, source: 'remotive', title: 'React Engineer (E2E MCP test)', company: 'Agent Co', location: 'Worldwide',
      remote: true, type: 'full-time', tags: ['react'], description: 'Build UIs with React.', url: 'https://example.com/jobs/mcp',
      postedAt: at, firstSeen: at, status: 'applied', application: { stage: 'applied', history: [{ stage: 'applied', at }], notes: '' },
    },
  },
  synced: true, seededFeeds: [],
}));
// No internet: job sources answer "not found"; the MCP client still reaches the app on 127.0.0.1.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, opts) : new Response('not found', { status: 404 }));
app.setPath('userData', userData);
app.commandLine.appendSwitch('user-data-dir', userData);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(200)) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`Timed out waiting for: ${what}`);
}
const results = [];
const check = (ok, label, detail = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` (${detail})` : ''}`);
};
const json = (r) => JSON.parse(r.content[0].text);

require('../src/main/main.js');

app.whenReady().then(async () => {
  let failed = false;
  let client;
  try {
    console.log('E2E: an AI assistant uses OkNetwork over MCP');
    const win = await until('the app window', () => BrowserWindow.getAllWindows()[0]);
    const js = (code) => win.webContents.executeJavaScript(code);
    await until('the app to load', () => js('Array.isArray(state.jobs) && state.jobs.length > 0'));

    const cfg = await until('mcp.json', () => {
      try { return JSON.parse(fs.readFileSync(path.join(userData, 'mcp.json'), 'utf8')); } catch { return null; }
    });
    check(cfg.token === TOKEN && cfg.port > 0, 'the app wrote the port and token for the bridge', `port ${cfg.port}`);

    client = new Client({ name: 'e2e-assistant', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    check(tools.length === 13, 'an assistant connects and sees all 13 tools', tools.join(', '));

    const found = json(await client.callTool({ name: 'search_jobs', arguments: { query: 'react' } }));
    check(found.jobs[0]?.id === JOB_ID, 'search_jobs finds the job');

    await client.callTool({ name: 'set_application_stage', arguments: { job_id: JOB_ID, stage: 'interview' } });
    await until('the board to update', () => js(`state.jobs.find((j) => j.id === ${JSON.stringify(JOB_ID)})?.application.stage === 'interview'`));
    check(true, 'moving the application updates the app\'s board live');

    // Outreach: a drafted message shows on the job in the app.
    await client.callTool({ name: 'record_outreach', arguments: { job_id: JOB_ID, status: 'drafted', channel: 'message', subject: 'React Engineer: E2E', message: 'Hello Agent Co, I build React UIs.' } });
    await until('the draft to show', () => js(`(() => { selectJob(${JSON.stringify(JOB_ID)}); return document.querySelector('#jobDetail .outreach-msg')?.textContent === 'Hello Agent Co, I build React UIs.'; })()`));
    check(true, 'a drafted message shows on the job in the app');

    await client.callTool({ name: 'update_profile', arguments: { add_skills: ['TypeScript'] } });
    await until('the profile to update', () => js(`state.profile.skills.includes('TypeScript')`));
    check(true, 'a profile change shows up in the app');

    // Settings: status and activity log, then switch "Allow changes" off.
    await js(`document.querySelector('.nav[data-view="settings"]').click()`);
    const ui = await until('the Settings section', () => js(`(() => {
      const s = document.querySelector('#mcpStatus').textContent;
      return s.startsWith('On') && { status: s, activity: document.querySelectorAll('#mcpActivity li:not(.muted)').length, snippet: document.querySelector('#mcpSnippet').textContent };
    })()`));
    check(ui.status.includes(`127.0.0.1:${cfg.port}`), 'Settings shows the server is on', ui.status);
    check(ui.activity >= 3, 'the activity log lists the assistant\'s calls', `${ui.activity} entries`);
    check(ui.snippet.includes(TOKEN) && ui.snippet.startsWith('claude mcp add'), 'the Claude Code setup line is shown');

    if (process.env.E2E_SCREENSHOT) {
      await js(`document.querySelector('#mcpLog').open = true; document.querySelector('#mcpBox').scrollIntoView()`);
      await wait(300);
      fs.writeFileSync(process.env.E2E_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      console.log(`  screenshot: ${process.env.E2E_SCREENSHOT}`);
    }

    await js(`document.querySelector('#mcpWrites').click()`);
    await until('writes to turn off', async () => !(await client.listTools()).tools.some((t) => t.name === 'set_job_status'));
    check(true, 'switching off "Allow changes" removes the write tools');
    const denied = await client.callTool({ name: 'set_job_status', arguments: { job_id: JOB_ID, status: 'hidden' } });
    check(denied.isError === true, 'and a write is refused');
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed = true;
  }
  await client?.close().catch(() => {});
  failed = failed || results.some((r) => !r.ok);
  console.log(failed ? 'E2E FAILED' : `E2E passed (${results.length} checks)`);
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
