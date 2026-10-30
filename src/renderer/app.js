// UI logic. Talks to the main process only through window.knet (see preload.js).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Build DOM nodes without innerHTML so job text from the internet can't inject markup.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const state = {
  profile: null,
  settings: null,
  sources: {},
  jobs: [],
  status: 'inbox',
  query: '',
  minScore: Number(safeGet('minScore') ?? 40),
  selectedId: null,
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

// ---------- helpers ----------

function scoreClass(s) { return s >= 70 ? 'good' : s >= 45 ? 'ok' : 'low'; }

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const STATUS_FILTERS = {
  inbox: (j) => j.status === 'new' || j.status === 'seen',
  saved: (j) => j.status === 'saved',
  applied: (j) => j.status === 'applied',
  dismissed: (j) => j.status === 'dismissed',
  all: (j) => j.status !== 'dismissed',
};

function visibleJobs() {
  const q = state.query.toLowerCase();
  return state.jobs.filter((j) =>
    STATUS_FILTERS[state.status](j) &&
    (state.status !== 'inbox' || j.score >= state.minScore) &&
    (!q || `${j.title} ${j.company} ${j.tags.join(' ')} ${j.location}`.toLowerCase().includes(q)));
}

// ---------- matches view ----------

function renderList() {
  const list = $('#jobList');
  const jobs = visibleJobs();
  list.replaceChildren();
  if (!jobs.length) {
    list.append(h('li', { class: 'muted empty' },
      state.jobs.length ? 'No jobs here. Try lowering "Min match" or another tab.' : 'Fetching jobs…'));
  }
  for (const j of jobs.slice(0, 300)) {
    const skills = j.match?.matchedSkills || [];
    list.append(h('li', {
      class: `job${j.id === state.selectedId ? ' selected' : ''}${j.status === 'new' ? ' unread' : ''}`,
      'data-id': j.id,
      onclick: () => selectJob(j.id),
    },
    h('div', { class: `score ${scoreClass(j.score)}` }, j.score),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'title' }, j.title),
      h('div', { class: 'meta' }, `${j.company} · ${j.location || 'Remote'} · ${ago(j.postedAt)}`),
      skills.length ? h('div', { class: 'tags' }, skills.slice(0, 5).map((s) => h('span', { class: 'tag hit' }, s))) : null)));
  }

  const newCount = state.jobs.filter((j) => j.status === 'new' && j.score >= state.settings.threshold).length;
  $('#newBadge').hidden = !newCount;
  $('#newBadge').textContent = newCount;
}

async function selectJob(id) {
  state.selectedId = id;
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  if (job.status === 'new') {
    job.status = 'seen';
    window.knet.setStatus(id, 'seen');
  }
  renderList();
  renderDetail(job);
}

function renderDetail(j) {
  const d = $('#jobDetail');
  const m = j.match || {};
  const src = state.sources[j.source];
  const statusBtn = (status, label) => h('button', {
    class: `btn${j.status === status ? ' on' : ''}`,
    onclick: async () => {
      const next = j.status === status ? 'seen' : status;
      await window.knet.setStatus(j.id, next);
      j.status = next;
      renderList();
      renderDetail(j);
    },
  }, j.status === status ? `✓ ${label}` : label);

  const LABELS = { skills: 'Tech skills', title: 'Role', experience: 'Experience', soft: 'Soft skills', location: 'Location' };
  const MAX = { skills: 45, title: 25, experience: 15, soft: 10, location: 5 };

  d.replaceChildren(
    h('div', { style: 'display:flex;gap:14px;align-items:flex-start' },
      h('div', { class: `score ${scoreClass(j.score)}`, style: 'width:56px;height:56px;font-size:16px;flex:none' }, j.score),
      h('div', {},
        h('h2', {}, j.title),
        h('div', { class: 'sub' }, [j.company, j.location, j.type, j.salary, `posted ${ago(j.postedAt)}`].filter(Boolean).join(' · ')))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => window.knet.openUrl(j.url) }, 'Open posting ↗'),
      statusBtn('saved', 'Save'),
      statusBtn('applied', 'Applied'),
      statusBtn('dismissed', 'Not interested')),

    h('h3', {}, 'Why it matches'),
    m.excluded
      ? h('p', {}, `Hidden: ${m.reasons?.[0]}`)
      : h('div', { class: 'bars' }, Object.keys(LABELS).flatMap((k) => [
        h('span', {}, LABELS[k]),
        h('div', { class: 'bar' }, h('i', { style: `width:${((m.breakdown?.[k] || 0) / MAX[k]) * 100}%` })),
        h('span', { class: 'muted' }, `${m.breakdown?.[k] || 0}/${MAX[k]}`),
      ])),
    m.reasons?.length ? h('ul', {}, m.reasons.map((r) => h('li', {}, r))) : null,

    (m.matchedSkills?.length || m.missingSkills?.length) ? h('div', {},
      h('h3', {}, 'Your skills in this posting'),
      h('div', { class: 'tags' },
        (m.matchedSkills || []).map((s) => h('span', { class: 'tag hit' }, `✓ ${s}`)),
        (m.missingSkills || []).map((s) => h('span', { class: 'tag miss' }, s)))) : null,

    j.tags.length ? h('div', {}, h('h3', {}, 'Tags'), h('div', { class: 'tags' }, j.tags.slice(0, 20).map((t) => h('span', { class: 'tag' }, t)))) : null,
    h('h3', {}, 'Description'),
    h('div', { class: 'desc' }, j.description || 'No description provided.'),
    h('p', { class: 'credit muted' }, 'Source: ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.knet.openUrl(src?.homepage || j.url); } }, src?.label || j.source)),
  );
  d.scrollTop = 0;
}

async function loadJobs() {
  state.jobs = await window.knet.getJobs();
  renderList();
  const sel = state.jobs.find((j) => j.id === state.selectedId);
  if (sel) renderDetail(sel);
}

// ---------- chip inputs (profile lists) ----------

function chipInput(container, values) {
  const items = [...values];
  const input = h('input', { placeholder: 'Type and press Enter' });
  const add = (raw) => {
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => {
      if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) items.push(v);
    });
    draw();
  };
  function draw() {
    container.replaceChildren(
      ...items.map((v, i) => h('span', { class: 'chip' }, v,
        h('button', { type: 'button', title: 'Remove', onclick: () => { items.splice(i, 1); draw(); } }, '×'))),
      input);
    input.value = '';
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); input.focus(); }
    else if (e.key === 'Backspace' && !input.value && items.length) { items.pop(); draw(); input.focus(); }
  });
  input.addEventListener('blur', () => input.value.trim() && add(input.value));
  container.addEventListener('click', (e) => e.target === container && input.focus());
  draw();
  return () => { if (input.value.trim()) add(input.value); return [...items]; };
}

let chipGetters = {};

function renderProfile() {
  const f = $('#profileForm');
  const p = state.profile;
  f.name.value = p.name || '';
  f.years.value = p.years ?? 0;
  f.remoteOnly.checked = !!p.remoteOnly;
  chipGetters = {};
  for (const c of $$('.chips', f)) chipGetters[c.dataset.field] = chipInput(c, p[c.dataset.field] || []);
  $('#onboarding').hidden = !!(p.skills.length || p.titles.length);
}

async function saveProfile(e) {
  e.preventDefault();
  const f = $('#profileForm');
  const profile = {
    name: f.name.value.trim(),
    years: Number(f.years.value) || 0,
    remoteOnly: f.remoteOnly.checked,
  };
  for (const [k, get] of Object.entries(chipGetters)) profile[k] = get();
  await window.knet.saveProfile(profile);
  state.profile = { ...state.profile, ...profile };
  $('#onboarding').hidden = !!(profile.skills.length || profile.titles.length);
  flash('#profileSaved', 'Saved. Scores updated.');
  await loadJobs();
}

// ---------- settings ----------

function renderSettings() {
  const f = $('#settingsForm');
  const s = state.settings;
  f.notifications.checked = s.notifications;
  f.threshold.value = s.threshold;
  f.intervalMinutes.value = s.intervalMinutes;
  f.maxAgeDays.value = s.maxAgeDays;
  $('#sourceList').replaceChildren(...Object.entries(state.sources).map(([k, src]) =>
    h('label', {}, h('input', { type: 'checkbox', name: `src-${k}`, checked: s.sources[k] !== false }), src.label)));
}

async function saveSettings(e) {
  e.preventDefault();
  const f = $('#settingsForm');
  const settings = {
    notifications: f.notifications.checked,
    threshold: Math.min(100, Math.max(0, Number(f.threshold.value) || 0)),
    intervalMinutes: Math.max(5, Number(f.intervalMinutes.value) || 30),
    maxAgeDays: Math.max(1, Number(f.maxAgeDays.value) || 3),
    sources: Object.fromEntries(Object.keys(state.sources).map((k) => [k, f[`src-${k}`].checked])),
  };
  await window.knet.saveSettings(settings);
  state.settings = { ...state.settings, ...settings };
  flash('#settingsSaved', 'Saved.');
  renderList();
}

function flash(sel, msg) {
  const el = $(sel);
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

// ---------- sync status ----------

function renderSync({ syncing, lastSync }) {
  $('#syncBtn').disabled = syncing;
  $('#syncBtn').textContent = syncing ? 'Checking…' : 'Check now';
  const info = $('#syncInfo');
  if (syncing) { info.textContent = 'Fetching new jobs…'; return; }
  if (!lastSync) { info.textContent = ''; return; }
  info.replaceChildren(
    `Last check ${ago(lastSync.at)}`, h('br'),
    `${lastSync.added ?? 0} new postings`,
    ...(lastSync.errors || []).map((e) => [h('br'), h('span', { style: 'color:var(--danger)' }, e)]).flat());
}

// ---------- wiring ----------

function showView(name) {
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

async function init() {
  const s = await window.knet.getState();
  Object.assign(state, { profile: s.profile, settings: s.settings, sources: s.sources });

  $$('.nav').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showView(a.dataset.goto); }));

  $$('#statusTabs button').forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.status;
    $$('#statusTabs button').forEach((x) => x.classList.toggle('active', x === b));
    renderList();
  }));
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  const range = $('#minScore');
  range.value = state.minScore;
  $('#minScoreVal').textContent = state.minScore;
  range.addEventListener('input', () => {
    state.minScore = Number(range.value);
    $('#minScoreVal').textContent = range.value;
    safeSet('minScore', range.value);
    renderList();
  });

  $('#syncBtn').addEventListener('click', () => window.knet.syncNow());
  $('#profileForm').addEventListener('submit', saveProfile);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#testNotif').addEventListener('click', () => window.knet.testNotification());

  window.knet.on('sync-status', renderSync);
  window.knet.on('jobs-updated', loadJobs);
  window.knet.on('focus-job', async (id) => {
    showView('matches');
    await loadJobs();
    selectJob(id);
  });

  renderProfile();
  renderSettings();
  renderSync({ syncing: s.syncing, lastSync: s.lastSync });
  setInterval(() => renderSync({ syncing: $('#syncBtn').disabled, lastSync: state.lastSync }), 60000);
  window.knet.on('sync-status', (x) => { if (x.lastSync) state.lastSync = x.lastSync; });
  state.lastSync = s.lastSync;
  await loadJobs();
  if (!state.profile.skills.length && !state.profile.titles.length) showView('profile');
}

init();
