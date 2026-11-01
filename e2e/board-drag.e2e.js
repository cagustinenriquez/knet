// End-to-end test: on the Applications board, dragging a card to another column changes the
// application's stage, and the change is saved.
//
// Runs the real app with a temporary profile holding one applied job and no job sources
// (no network). The drag is done with the same drag events the browser fires for a mouse drag.
//
// Run: npm run test:e2e

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const JOB_ID = 'remotive:e2e-drag';
const appliedAt = new Date(Date.now() - 3 * 86400e3).toISOString();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'knet-e2e-'));
const dataFile = path.join(userData, 'knet-data.json');
fs.writeFileSync(dataFile, JSON.stringify({
  profile: { email: 'e2e@example.com', name: 'E2E', titles: ['Frontend Developer'], skills: ['react'], years: 5, locations: ['Worldwide'] },
  settings: {
    notifications: false, threshold: 0, maxAgeDays: 30, intervalMinutes: 1440,
    sources: { posted: false, remotive: false, remoteok: false, arbeitnow: false, jobicy: false, getonbrd: false, companies: false },
    companies: [],
  },
  jobs: {
    [JOB_ID]: {
      id: JOB_ID, source: 'remotive', title: 'Frontend Engineer (E2E drag test)', company: 'Drag Co',
      location: 'Worldwide', remote: true, type: 'full-time', tags: ['react'], description: 'Fake job.',
      url: 'https://example.com/jobs/drag', postedAt: appliedAt, firstSeen: appliedAt,
      status: 'applied', application: { stage: 'applied', history: [{ stage: 'applied', at: appliedAt }], notes: '' },
    },
  },
  synced: true, seededFeeds: [],
}));
globalThis.fetch = async () => new Response('not found', { status: 404 });
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
const savedStage = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).jobs[JOB_ID]?.application?.stage;

require('../src/main/main.js');

app.whenReady().then(async () => {
  let failed = false;
  try {
    console.log('E2E: drag an application card to another stage');
    const win = await until('the app window', () => BrowserWindow.getAllWindows()[0]);
    const js = (code) => win.webContents.executeJavaScript(code);
    await until('the app to load', () => js('Array.isArray(state.jobs) && state.jobs.length > 0'));
    await js(`document.querySelector('.nav[data-view="applications"]').click()`);

    // Drags the card onto the element matched by `target` (a CSS selector, or a column title).
    const drag = (target) => js(`(() => {
      const card = document.querySelector('#board .app-card');
      const cols = [...document.querySelectorAll('#board .column')];
      const t = ${JSON.stringify(target)};
      const dest = cols.find((c) => c.querySelector('.column-head').firstChild.textContent === t)
        || [...document.querySelectorAll('#board .close-target')].find((x) => x.textContent === t);
      if (!card || !dest) return false;
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(card, 'dragstart');
      fire(dest, 'dragenter');
      fire(dest, 'dragover');
      fire(dest, 'drop');
      fire(card, 'dragend');
      return true;
    })()`);
    const columnOf = () => js(`document.querySelector('#board .app-card')?.closest('.column')?.querySelector('.column-head').firstChild.textContent`);

    check(await columnOf() === 'Applied', 'the card starts in Applied');

    check(await drag('Interview'), 'dragged the card to Interview');
    await until('the card to move', async () => (await columnOf()) === 'Interview');
    check(true, 'the card is now in the Interview column');
    await until('the stage to be saved', () => savedStage() === 'interview');
    check(true, 'the new stage is saved');

    // Closed holds three stages: dropping on "No response" picks that one.
    check(await drag('No response'), 'dragged the card to Closed → No response');
    await until('the card to move', async () => (await columnOf()) === 'Closed');
    await until('the stage to be saved', () => savedStage() === 'ghosted');
    check(true, 'the card is in Closed with stage "No response"');

    const history = JSON.parse(fs.readFileSync(dataFile, 'utf8')).jobs[JOB_ID].application.history.map((h) => h.stage);
    check(history.join(',') === 'applied,interview,ghosted', 'the timeline records each move', history.join(' → '));

    if (process.env.E2E_SCREENSHOT) {
      fs.writeFileSync(process.env.E2E_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      console.log(`  screenshot: ${process.env.E2E_SCREENSHOT}`);
    }
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed = true;
  }
  failed = failed || results.some((r) => !r.ok);
  console.log(failed ? 'E2E FAILED' : `E2E passed (${results.length} checks)`);
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
