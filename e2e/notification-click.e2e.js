// End-to-end test: a new matching job arrives → a desktop notification is shown → the
// user clicks it → the app window comes up with that job open.
//
// Runs the real app (main process + UI) with:
//   - a temporary profile folder (your own data is never touched),
//   - a fake job board: network requests are answered locally with one fake listing,
//   - a recording Notification class. The OS can't be scripted to click a real
//     notification, so the test fires the same "click" event the OS would.
//     E2E_SHOW=1   also shows a real notification on screen while it runs.
//     E2E_MANUAL=1 shows a real notification and waits up to 60s for *you* to click it.
//
// Run: npm run test:e2e        (automatic)
//      npm run test:e2e:manual (click the notification yourself)

const Module = require('module');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE_JOB = {
  id: 987654,
  title: 'Senior React Developer (E2E test listing)',
  company_name: 'Fake Company Inc',
  candidate_required_location: 'Worldwide',
  tags: ['react', 'typescript', 'node'],
  description: '<p>This is a fake listing created by the end-to-end test.</p><p>Build UIs with React and TypeScript.</p>',
  url: 'https://example.com/jobs/e2e-react',
  publication_date: new Date().toISOString(),
  job_type: 'full_time',
  salary: '',
};
const JOB_ID = `remotive:${FAKE_JOB.id}`;

// ---------- fakes, installed before the app loads ----------

// 1. Network: the Remotive API returns the fake job; everything else is "not found".
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://remotive.com/api/')) {
    return new Response(JSON.stringify({ jobs: [FAKE_JOB] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

// 2. Notifications: record them (and optionally show a real one too).
const shown = [];
let RealNotification;
class RecordingNotification extends EventEmitter {
  static isSupported() { return true; }
  constructor(opts) { super(); this.opts = opts; }
  show() {
    shown.push(this);
    if ((process.env.E2E_SHOW || process.env.E2E_MANUAL) && RealNotification?.isSupported()) {
      const real = new RealNotification(this.opts);
      real.on('click', () => this.emit('click')); // a real click works too
      real.show();
      this.real = real;
    }
  }
}
const load = Module._load;
Module._load = function (request, ...rest) {
  const mod = load.call(this, request, ...rest);
  if (request !== 'electron') return mod;
  RealNotification = mod.Notification;
  return new Proxy(mod, { get: (t, k) => (k === 'Notification' ? RecordingNotification : t[k]) });
};

// 3. A temporary profile: registered, with skills that match the fake job, Remotive as the
//    only source, and Remotive marked as already loaded (first loads don't alert).
const { app, BrowserWindow } = require('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'knet-e2e-'));
fs.writeFileSync(path.join(userData, 'knet-data.json'), JSON.stringify({
  profile: { email: 'e2e@example.com', name: 'E2E', titles: ['Frontend Developer', 'React Developer'], skills: ['react', 'typescript'], years: 6, locations: ['Worldwide'] },
  settings: {
    notifications: true, threshold: 0, maxAgeDays: 3, intervalMinutes: 1440,
    sources: { posted: false, remotive: true, remoteok: false, arbeitnow: false, jobicy: false, getonbrd: false, companies: false },
    companies: [],
  },
  jobs: {}, synced: true, seededFeeds: ['remotive'],
}));
app.setPath('userData', userData);
app.commandLine.appendSwitch('user-data-dir', userData); // so the app keeps this folder

// ---------- the test ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 30000) {
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

require('../src/main/main.js');

app.whenReady().then(async () => {
  let failed = false;
  try {
    console.log('E2E: notification click opens the listing');
    const win = await until('the app window', () => BrowserWindow.getAllWindows()[0]);
    const js = (code) => win.webContents.executeJavaScript(code);

    // A new matching job arrives during the first check → one notification.
    const n = await until('a notification', () => shown.find((x) => x.opts.title.includes(FAKE_JOB.title)));
    check(true, 'notification shown', `"${n.opts.title}" / "${n.opts.body}"`);
    check(/^\d+% match: /.test(n.opts.title), 'title shows the match score');
    check(n.opts.body.includes(FAKE_JOB.company_name), 'body names the company');

    // The user is elsewhere: the window is hidden (the app keeps running in the tray).
    win.hide();
    await wait(300);
    check(!win.isVisible(), 'window hidden before the click');

    // The user clicks the notification.
    if (process.env.E2E_MANUAL) {
      console.log('  → Click the "OkNetwork" notification at the top of your screen (waiting up to 60s)...');
      await until('you to click the notification', () => win.isVisible(), 60000);
    } else {
      n.emit('click');
      await until('the window to come back', () => win.isVisible());
    }
    check(win.isVisible(), 'clicking the notification shows the window');

    // The listing opens with its description.
    await until('the job to be selected', () => js(`state.selectedId === ${JSON.stringify(JOB_ID)}`));
    const view = await js(`({
      matchesVisible: !document.querySelector('#view-matches').hidden,
      title: document.querySelector('#jobDetail h2')?.textContent,
      description: document.querySelector('#jobDetail .desc')?.textContent || '',
    })`);
    check(view.matchesVisible, 'the Matches view is open');
    check(view.title === FAKE_JOB.title, 'the job details show the listing title', view.title);
    check(view.description.includes('fake listing created by the end-to-end test'), 'the description is shown');

    if (process.env.E2E_SCREENSHOT) {
      fs.writeFileSync(process.env.E2E_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      console.log(`  screenshot: ${process.env.E2E_SCREENSHOT}`);
    }
    if (process.env.E2E_SHOW) await wait(4000); // leave the real notification visible a moment
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed = true;
  }
  failed = failed || results.some((r) => !r.ok);
  console.log(failed ? 'E2E FAILED' : `E2E passed (${results.length} checks)`);
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
