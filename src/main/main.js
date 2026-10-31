// Electron entry point: window, tray, background job checks and notifications.

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage, clipboard } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { SOURCES, fetchAll, dupKey } = require('./sources');
const { PLATFORMS, checkSource, http } = require('./ats');
const { fetchApproved, syncApproved, suggestUrl } = require('./shared');
const { postFormUrl, applyLink, reportFormUrl, validHidden, HIDDEN_URL } = require('./posts');
const { auditPost } = require('./audit');
const { scoreJob } = require('./matcher');
const { profileError, normalizeEmail, isRegistered } = require('./profile');
const { STAGES, onStatusChange, setStage, setNotes } = require('./applications');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
// macOS menu bar: a black "template" icon that macOS tints (the @2x file is picked up automatically).
const TRAY_MAC = path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png');
const IS_MAC = process.platform === 'darwin';

let store;
let win = null;
let tray = null;
let timer = null;
let syncing = false;
let quitting = false;

// ---------- window & tray ----------

// Window background before the page paints, per theme (matches --bg in styles.css).
const THEME_BG = { light: '#f4f5f8', dark: '#0c0e12', dracula: '#21222c', pink: '#fdf3f7', pride: '#f5f3fb' };

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: 'OkNetwork',
    icon: ICON,
    backgroundColor: THEME_BG[store.data.settings.theme] || THEME_BG.light,
    autoHideMenuBar: true,
    // macOS: no title bar; the window buttons sit inset over the sidebar.
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Closing the window keeps the app running in the tray so alerts keep coming.
  win.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

function createTray() {
  try {
    if (IS_MAC) {
      const img = nativeImage.createFromPath(TRAY_MAC);
      img.setTemplateImage(true);
      tray = new Tray(img);
    } else {
      tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 }));
    }
  } catch (e) {
    console.warn('Tray not available:', e.message);
    tray = null;
    return;
  }
  tray.setToolTip('OkNetwork — job alerts');
  tray.on('click', showWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const newCount = Object.values(store.data.jobs).filter(
    (j) => j.status === 'new' && j.score >= store.data.settings.threshold,
  ).length;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open OkNetwork${newCount ? ` (${newCount} new)` : ''}`, click: showWindow },
    { label: syncing ? 'Checking…' : 'Check for jobs now', enabled: !syncing, click: () => sync() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:[^\s]+$/i.test(url)) shell.openExternal(url);
}

const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);

// ---------- matching & syncing ----------

function rescoreAll() {
  for (const job of Object.values(store.data.jobs)) {
    const m = scoreJob(store.data.profile, job);
    job.score = m.score;
    job.match = m;
  }
}

// Which feed a job came from: "remotive" for a job board, "greenhouse:wizeline" for a company board.
function feedKey(job) {
  const parts = job.id.split(':');
  return parts.length >= 3 ? `${parts[0]}:${parts[1]}` : parts[0];
}

function profileIsEmpty() {
  const p = store.data.profile;
  return !isRegistered(p) || (!p.skills.length && !p.titles.length); // no alerts before registration
}

async function sync() {
  if (syncing) return;
  syncing = true;
  send('sync-status', { syncing: true });
  updateTrayMenu();
  try {
    const { settings, profile } = store.data;
    // Pick up sources other users suggested and an admin approved.
    let sharedError = null;
    try {
      const { added, revoked } = syncApproved(settings, await fetchApproved(http));
      if (revoked.length) {
        // Drop a revoked source's jobs, except ones the user saved or applied to.
        const gone = new Set(revoked);
        for (const [id, j] of Object.entries(store.data.jobs)) {
          if (gone.has(feedKey(j)) && !['saved', 'applied'].includes(j.status)) delete store.data.jobs[id];
        }
      }
      if (added || revoked.length) send('settings-updated', settings);
    } catch (e) {
      // Offline, or no shared list published yet (404): keep what we have, change nothing.
      if (e.message !== 'HTTP 404') sharedError = `Shared sources: ${e.message}`;
    }
    // Jobs hidden for everyone after reports (jobs/hidden.json). Offline / 404: keep the last list.
    try {
      store.data.hiddenJobs = validHidden(await http(`${HIDDEN_URL}?t=${Date.now()}`));
    } catch { /* keep previous */ }
    const hidden = new Set(store.data.hiddenJobs || []);
    for (const [id, j] of Object.entries(store.data.jobs)) {
      if (hidden.has(id) && !['saved', 'applied'].includes(j.status)) delete store.data.jobs[id];
    }

    // Jobs we already have a description for don't need their detail pages fetched again.
    const known = new Set(Object.keys(store.data.jobs).filter((id) => store.data.jobs[id].description));
    const { jobs, errors } = await fetchAll(settings, known);
    if (sharedError) errors.push(sharedError);

    // Posted jobs disappear from the feed when their issue is closed or they expire.
    // If the feed was read fine, drop the ones that are gone (unless saved/applied).
    const postedOk = settings.sources.posted !== false && !errors.some((e) => e.startsWith(`${SOURCES.posted.label}:`));
    if (postedOk) {
      const live = new Set(jobs.filter((j) => j.source === 'posted').map((j) => j.id));
      for (const [id, j] of Object.entries(store.data.jobs)) {
        if (j.source === 'posted' && !live.has(id) && !['saved', 'applied'].includes(j.status)) delete store.data.jobs[id];
      }
    }
    const now = new Date().toISOString();
    const fresh = [];
    const alertable = [];
    const seenKeys = new Set(Object.values(store.data.jobs).map(dupKey));
    // A feed's first load brings in all its existing postings. Those aren't "new", so
    // only alert for feeds (a job board, or one company's board) we've loaded before.
    const seeded = new Set(store.data.seededFeeds ||
      (store.data.synced ? Object.values(store.data.jobs).map(feedKey) : []));

    for (const j of jobs) {
      if (hidden.has(j.id)) continue;
      const existing = store.data.jobs[j.id];
      if (existing) {
        // Some platforms send descriptions a few at a time; alert once one arrives.
        const gotDescription = !existing.description && j.description;
        if (!j.description) j.description = existing.description; // detail pages are fetched once
        if (existing.postedAt < j.postedAt) j.postedAt = existing.postedAt; // posting dates never move forward
        Object.assign(existing, j);
        existing.match = scoreJob(profile, existing);
        existing.score = existing.match.score;
        if (gotDescription && existing.status === 'new' && !existing.alerted) alertable.push(existing);
      } else if (!seenKeys.has(dupKey(j))) {
        seenKeys.add(dupKey(j));
        const match = scoreJob(profile, j);
        store.data.jobs[j.id] = { ...j, score: match.score, match, firstSeen: now, status: 'new' };
        fresh.push(store.data.jobs[j.id]);
        if (seeded.has(feedKey(j))) alertable.push(store.data.jobs[j.id]);
      }
    }
    jobs.forEach((j) => seeded.add(feedKey(j)));
    // Mark the posted-jobs feed as loaded even while it's empty, so the very first post alerts.
    if (postedOk) seeded.add('posted');
    store.data.seededFeeds = [...seeded];

    const cutoff = Date.now() - settings.maxAgeDays * 86400000;
    const alerts = profileIsEmpty() ? [] : alertable
      .filter((j) => !j.alerted && j.score >= settings.threshold && new Date(j.postedAt).getTime() >= cutoff)
      .sort((a, b) => b.score - a.score);
    alerts.forEach((j) => { j.alerted = true; });

    store.data.synced = true;
    store.data.lastSync = { at: now, added: fresh.length, fetched: jobs.length, matches: alerts.length, errors };
    store.save();

    if (settings.notifications) notify(alerts);
  } catch (e) {
    store.data.lastSync = { at: new Date().toISOString(), added: 0, errors: [e.message] };
  } finally {
    syncing = false;
    send('sync-status', { syncing: false, lastSync: store.data.lastSync });
    send('jobs-updated');
    updateTrayMenu();
  }
}

function notify(alerts) {
  if (!alerts.length || !Notification.isSupported()) return;
  // One notification per job for the top 3, then a summary, so a busy morning doesn't spam you.
  for (const j of alerts.slice(0, 3)) {
    const skills = j.match.matchedSkills.slice(0, 4).join(', ');
    const n = new Notification({
      title: `${j.score}% match: ${j.title}`,
      body: `${j.company}${skills ? ` · ${skills}` : ''}`,
      icon: ICON,
    });
    n.on('click', () => { showWindow(); send('focus-job', j.id); });
    n.show();
  }
  if (alerts.length > 3) {
    const n = new Notification({
      title: `${alerts.length - 3} more matching jobs`,
      body: 'Open knet to see them all.',
      icon: ICON,
    });
    n.on('click', showWindow);
    n.show();
  }
}

function schedule() {
  clearInterval(timer);
  const minutes = Math.max(5, Number(store.data.settings.intervalMinutes) || 30);
  timer = setInterval(sync, minutes * 60000);
}

// ---------- IPC (called from the UI via preload.js) ----------

function registerIpc() {
  ipcMain.handle('get-state', () => ({
    profile: store.data.profile,
    settings: store.data.settings,
    lastSync: store.data.lastSync,
    syncing,
    sources: {
      ...Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { label: s.label, homepage: s.homepage }])),
      companies: { label: 'Company career pages (list below)' },
    },
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, p]) => [k, p.label])),
    boardUrls: Object.fromEntries(store.data.settings.companies
      .filter((c) => PLATFORMS[c.platform]).map((c) => [`${c.platform}:${c.slug}`, PLATFORMS[c.platform].boardUrl(c.slug)])),
  }));

  ipcMain.handle('get-jobs', () =>
    Object.values(store.data.jobs)
      .sort((a, b) => b.score - a.score || b.postedAt.localeCompare(a.postedAt)));

  ipcMain.handle('save-profile', (_e, profile) => {
    const next = { ...store.data.profile, ...profile };
    const error = profileError(next);
    if (error) return { ok: false, error };
    next.email = normalizeEmail(next.email);
    store.data.profile = next;
    rescoreAll();
    store.save();
    updateTrayMenu();
    return { ok: true, profile: next };
  });

  ipcMain.handle('save-settings', (_e, settings) => {
    if ('theme' in settings && !THEME_BG[settings.theme]) delete settings.theme;
    store.data.settings = { ...store.data.settings, ...settings };
    if (settings.theme) win?.setBackgroundColor(THEME_BG[settings.theme]);
    store.save();
    schedule();
    updateTrayMenu();
    return true;
  });

  ipcMain.handle('set-status', (_e, id, status) => {
    if (!store.data.jobs[id] || !['new', 'seen', 'saved', 'applied', 'dismissed'].includes(status)) return false;
    store.data.jobs[id].status = status;
    onStatusChange(store.data.jobs[id], status);
    store.save();
    updateTrayMenu();
    return store.data.jobs[id];
  });

  ipcMain.handle('set-stage', (_e, id, stage) => {
    const job = store.data.jobs[id];
    if (!job || !STAGES.includes(stage)) return null;
    setStage(job, stage);
    store.save();
    return job;
  });

  ipcMain.handle('set-notes', (_e, id, notes) => {
    const job = store.data.jobs[id];
    if (!job) return null;
    setNotes(job, notes);
    store.save();
    return job;
  });

  ipcMain.handle('sync-now', () => sync());
  ipcMain.handle('open-url', (_e, url) => openExternal(url));

  // Paste a careers page URL → find its hiring platform and count its open jobs.
  ipcMain.handle('detect-company', (_e, url) => checkSource(url));

  // "Post a job": check the draft locally, then open the GitHub form pre-filled.
  const draftPost = (p = {}) => ({
    title: String(p.title || '').trim(), company: String(p.company || '').trim(), location: String(p.location || '').trim(),
    workplace: String(p.workplace || ''), type: String(p.type || ''), level: String(p.level || ''),
    salary: String(p.salary || '').trim(), tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 15) : [],
    apply: applyLink(p.apply), description: String(p.description || '').trim(),
  });
  // Report a job posted on knet: opens the pre-filled report form on GitHub.
  // Report any job: opens the pre-filled report form on GitHub, and takes the job out of
  // this user's inbox right away (it's in "Dismissed" if they change their mind).
  ipcMain.handle('report-post', (_e, id) => {
    const j = store.data.jobs[id];
    if (!j) return null;
    openExternal(reportFormUrl(j));
    if (!['saved', 'applied'].includes(j.status)) j.status = 'dismissed';
    j.reported = new Date().toISOString();
    store.save();
    updateTrayMenu();
    return j;
  });
  ipcMain.handle('check-post', (_e, p) => auditPost(draftPost(p)));
  ipcMain.handle('open-post-form', (_e, p) => {
    const post = draftPost(p);
    let url = postFormUrl(post);
    let copied = false;
    if (url.length > 7000) { // GitHub rejects very long URLs
      url = postFormUrl(post, { withDescription: false });
      clipboard.writeText(post.description);
      copied = true;
    }
    openExternal(url);
    return { copied };
  });

  // Open a pre-filled GitHub issue so an admin can review the source for everyone.
  ipcMain.handle('suggest-source', (_e, key) => {
    const c = store.data.settings.companies.find((x) => `${x.platform}:${x.slug}` === key);
    if (!c || !PLATFORMS[c.platform]) return false;
    const url = c.url || (c.platform === 'rss' ? `https://${c.slug}` : PLATFORMS[c.platform].boardUrl(c.slug));
    openExternal(suggestUrl({ url, name: c.name }));
    c.suggested = new Date().toISOString();
    store.save();
    return true;
  });
  ipcMain.handle('test-notification', () => {
    new Notification({ title: 'OkNetwork notifications work', body: 'You will see alerts like this for new matches.', icon: ICON }).show();
  });
}

// ---------- app lifecycle ----------

// The snap's bundled graphics libraries can't load many host GPU drivers (Mesa errors,
// GPU process crash loop). The UI is simple, so render in software inside a snap.
// (The harmless "MESA-LOADER: failed to open …" warnings are hidden by LIBGL_DEBUG=quiet,
// set in the snap config in package.json: Mesa loads before this code runs.)
if (process.env.SNAP) {
  app.disableHardwareAcceleration();
  // The tray icon image is written to $TMPDIR and read by the desktop shell. A snap's /tmp is
  // private, so the shell can't read it and shows "⋯". The snap config sets TMPDIR to the
  // snap's runtime dir (readable by the shell); this is a fallback if that didn't apply.
  if (process.env.XDG_RUNTIME_DIR && !String(process.env.TMPDIR || '').startsWith(process.env.XDG_RUNTIME_DIR)) {
    process.env.TMPDIR = process.env.XDG_RUNTIME_DIR;
  }
}

// The app's display name is "OkNetwork", but keep data where it has always been
// (~/.config/knet on Linux) so renaming doesn't strand anyone's profile.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'knet'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.setAppUserModelId('com.oknetwork.knet'); // needed for notifications on Windows (matches build.appId)

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    rescoreAll(); // matching rules may have changed since the last run
    // Jobs marked "applied" before stages existed start at the Applied stage.
    Object.values(store.data.jobs).forEach((j) => j.status === 'applied' && onStatusChange(j, 'applied'));
    registerIpc();
    createWindow();
    createTray();
    schedule();
    sync();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('activate', showWindow);
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
