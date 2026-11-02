// End-to-end test: edit the email and cover letter templates (with a variable inserted from the
// chips), save them, then open a job and download its filled-in cover letter as .txt and PDF.
//
// Runs the real app with a temporary profile and no job sources. The save dialog is replaced
// with one that answers a file path in the temporary folder.
// Run: npm run test:e2e

const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');
const { app, BrowserWindow } = electron;

const JOB_ID = 'remotive:e2e-tpl';
const at = new Date(Date.now() - 86400e3).toISOString();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'knet-e2e-'));
const dataFile = path.join(userData, 'knet-data.json');
fs.writeFileSync(dataFile, JSON.stringify({
  profile: { email: 'ana@example.com', name: 'Ana Test', titles: ['Frontend Developer'], skills: ['react', 'typescript'], years: 6, locations: ['Worldwide'] },
  settings: {
    notifications: false, threshold: 0, maxAgeDays: 30, intervalMinutes: 1440,
    sources: { posted: false, remotive: false, remoteok: false, arbeitnow: false, jobicy: false, getonbrd: false, companies: false },
    companies: [],
  },
  templates: { fields: [{ key: 'portfolio', value: 'https://ana.dev' }] },
  jobs: {
    [JOB_ID]: {
      id: JOB_ID, source: 'remotive', title: 'Senior React Engineer', company: 'Template Co', location: 'Worldwide',
      remote: true, type: 'full-time', tags: ['React', 'TypeScript'], description: 'We use React and TypeScript. Questions: jobs@template.example',
      url: 'https://example.com/jobs/tpl', postedAt: at, firstSeen: at, status: 'new',
    },
  },
  synced: true, seededFeeds: [],
}));
globalThis.fetch = async () => new Response('not found', { status: 404 });
// Save dialog → a file in the temporary folder.
const saved = [];
electron.dialog.showSaveDialog = async (_win, opts) => {
  const filePath = path.join(userData, path.basename(opts.defaultPath));
  saved.push(filePath);
  return { canceled: false, filePath };
};
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
const shot = async (win, name) => {
  if (!process.env.E2E_SCREENSHOT_DIR) return;
  await wait(300);
  fs.writeFileSync(path.join(process.env.E2E_SCREENSHOT_DIR, name), (await win.webContents.capturePage()).toPNG());
};

require('../src/main/main.js');

app.whenReady().then(async () => {
  let failed = false;
  try {
    console.log('E2E: email and cover letter templates');
    const win = await until('the app window', () => BrowserWindow.getAllWindows()[0]);
    const js = (code) => win.webContents.executeJavaScript(code);
    await until('the app to load', () => js('Array.isArray(state.jobs) && state.jobs.length > 0'));

    // Templates view: write a subject, put the cursor at the end of the message, click {{top_skill}}.
    await js(`document.querySelector('.nav[data-view="templates"]').click()`);
    const preview = await js(`(() => {
      const f = document.querySelector('#tplForm');
      f.subject.value = 'Application: {{role}} at {{company}}';
      f.subject.dispatchEvent(new Event('input'));
      f.emailBody.focus();
      f.emailBody.value = 'Hello {{company}}! I love {{matched_skills}}. Portfolio: {{portfolio}}. Best skill: ';
      f.emailBody.selectionStart = f.emailBody.selectionEnd = f.emailBody.value.length;
      f.emailBody.dispatchEvent(new Event('input'));
      [...document.querySelectorAll('#tplVars .tag')].find((t) => t.textContent === '{{top_skill}}').click();
      return { body: f.emailBody.value, preview: document.querySelector('#tplPreview').textContent };
    })()`);
    check(preview.body.endsWith('Best skill: {{top_skill}}'), 'clicking a variable inserts it at the cursor');
    check(preview.preview.includes('Application: Senior React Engineer at Template Co') && preview.preview.includes('Portfolio: https://ana.dev'),
      'the preview fills in the job and your fields', preview.preview.slice(0, 80));
    await shot(win, 'templates.png');

    await js(`document.querySelector('#tplForm').requestSubmit()`);
    await until('the templates to be saved', () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).templates?.email?.subject === 'Application: {{role}} at {{company}}');
    check(true, 'the templates are saved');

    // The job: "Email & cover letter" filled in.
    await js(`showView('matches'); selectJob(${JSON.stringify(JOB_ID)}); document.querySelector('#jobDetail .kit').open = true;`);
    const kit = await until('the job\'s email', () => js(`(() => {
      const k = document.querySelector('#jobDetail .kit');
      return k && { subject: k.querySelector('input').value, body: k.querySelector('textarea').value,
        mailto: [...k.querySelectorAll('button')].some((b) => b.textContent.includes('jobs@template.example')) };
    })()`));
    check(kit.subject === 'Application: Senior React Engineer at Template Co', 'the job\'s email subject is filled in', kit.subject);
    check(/Hello Template Co! I love React and TypeScript\. Portfolio: https:\/\/ana\.dev\. Best skill: React/.test(kit.body), 'the email uses the job\'s matched skills', kit.body);
    check(kit.mailto, 'the posting\'s email address gets an "Email …" button');
    await shot(win, 'kit.png');

    // Cover letter: download as .txt and PDF.
    await js(`[...document.querySelectorAll('#jobDetail .kit .tabs button')].find((b) => b.textContent === 'Cover letter').click()`);
    await js(`[...document.querySelectorAll('#jobDetail .kit button')].find((b) => b.textContent === 'Download .txt').click()`);
    await js(`[...document.querySelectorAll('#jobDetail .kit button')].find((b) => b.textContent === 'Download PDF').click()`);
    await until('both files', () => saved.length === 2 && saved.every((f) => fs.existsSync(f) && fs.statSync(f).size > 0));
    const txt = fs.readFileSync(saved[0], 'utf8');
    check(path.basename(saved[0]) === 'Cover letter - Template Co - Senior React Engineer.txt', 'the .txt gets a clear file name', path.basename(saved[0]));
    check(txt.includes('Dear Template Co hiring team') && txt.includes('https://ana.dev') && txt.includes('Ana Test'), 'the .txt has the filled-in letter');
    check(fs.readFileSync(saved[1]).subarray(0, 5).toString() === '%PDF-', 'the PDF is a real PDF', `${fs.statSync(saved[1]).size} bytes`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed = true;
  }
  failed = failed || results.some((r) => !r.ok);
  console.log(failed ? 'E2E FAILED' : `E2E passed (${results.length} checks)`);
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
