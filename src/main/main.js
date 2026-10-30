// Electron entry point: window, tray, background job checks and notifications.

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { SOURCES, fetchAll } = require('./sources');
const { scoreJob } = require('./matcher');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

let store;
let win = null;
let tray = null;
let timer = null;
let syncing = false;
let quitting = false;

// ---------- window & tray ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: 'knet',
    icon: ICON,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
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
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 }));
  } catch (e) {
    console.warn('Tray not available:', e.message);
    tray = null;
    return;
  }
  tray.setToolTip('knet — job alerts');
  tray.on('click', showWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const newCount = Object.values(store.data.jobs).filter(
    (j) => j.status === 'new' && j.score >= store.data.settings.threshold,
  ).length;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open knet${newCount ? ` (${newCount} new)` : ''}`, click: showWindow },
    { label: syncing ? 'Checking…' : 'Check for jobs now', enabled: !syncing, click: () => sync() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
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

function profileIsEmpty() {
  const p = store.data.profile;
  return !p.skills.length && !p.titles.length;
}

async function sync() {
  if (syncing) return;
  syncing = true;
  send('sync-status', { syncing: true });
  updateTrayMenu();
  try {
    const { settings, profile } = store.data;
    const { jobs, errors } = await fetchAll(settings.sources);
    const now = new Date().toISOString();
    const fresh = [];
    // Same company + title = same job (often cross-posted to several boards).
    const dupKey = (j) => `${j.company}|${j.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');
    const known = new Set(Object.values(store.data.jobs).map(dupKey));

    for (const j of jobs) {
      const existing = store.data.jobs[j.id];
      const m = scoreJob(profile, j);
      if (existing) {
        Object.assign(existing, j, { score: m.score, match: m });
      } else if (!known.has(dupKey(j))) {
        known.add(dupKey(j));
        store.data.jobs[j.id] = { ...j, score: m.score, match: m, firstSeen: now, status: 'new' };
        fresh.push(store.data.jobs[j.id]);
      }
    }

    // The very first sync loads hundreds of existing postings. Show them in the
    // app, but only notify about jobs that appear after that.
    const cutoff = Date.now() - settings.maxAgeDays * 86400000;
    const alerts = store.data.synced && !profileIsEmpty()
      ? fresh
        .filter((j) => j.score >= settings.threshold && new Date(j.postedAt).getTime() >= cutoff)
        .sort((a, b) => b.score - a.score)
      : [];

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
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { label: s.label, homepage: s.homepage }])),
  }));

  ipcMain.handle('get-jobs', () =>
    Object.values(store.data.jobs)
      .sort((a, b) => b.score - a.score || b.postedAt.localeCompare(a.postedAt)));

  ipcMain.handle('save-profile', (_e, profile) => {
    store.data.profile = { ...store.data.profile, ...profile };
    rescoreAll();
    store.save();
    updateTrayMenu();
    return true;
  });

  ipcMain.handle('save-settings', (_e, settings) => {
    store.data.settings = { ...store.data.settings, ...settings };
    store.save();
    schedule();
    updateTrayMenu();
    return true;
  });

  ipcMain.handle('set-status', (_e, id, status) => {
    if (!store.data.jobs[id] || !['new', 'seen', 'saved', 'applied', 'dismissed'].includes(status)) return false;
    store.data.jobs[id].status = status;
    store.save();
    updateTrayMenu();
    return true;
  });

  ipcMain.handle('sync-now', () => sync());
  ipcMain.handle('open-url', (_e, url) => openExternal(url));
  ipcMain.handle('test-notification', () => {
    new Notification({ title: 'knet notifications work', body: 'You will see alerts like this for new matches.', icon: ICON }).show();
  });
}

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.setAppUserModelId('com.knet.app'); // needed for notifications on Windows

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
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
