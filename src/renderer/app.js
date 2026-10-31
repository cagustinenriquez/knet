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
  platforms: {},
  boardUrls: {},
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

// Score as a progress ring (see .score in styles.css).
function scoreRing(score, size = '') {
  const p = Math.max(0, Math.min(100, Number(score) || 0));
  return h('div', { class: `score ${scoreClass(p)} ${size}`.trim(), style: `--p:${p}`, title: `${p}% match` }, h('span', {}, p));
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const STAGES = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer',
  rejected: 'Rejected', ghosted: 'No response', withdrawn: 'Withdrew',
};
const CLOSED = ['rejected', 'ghosted', 'withdrawn'];

function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
    scoreRing(j.score),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'title' }, j.source === 'posted' ? h('span', { class: 'pill posted', title: 'Posted directly on knet' }, 'posted') : null, ' ', j.title),
      h('div', { class: 'meta' }, `${j.company} · ${j.location || 'Remote'} · ${ago(j.postedAt)}`),
      j.status === 'applied' && j.application ? h('div', { class: 'meta' }, `Stage: ${STAGES[j.application.stage]}`) : null,
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
  const fromCompany = j.id.split(':').length >= 3;
  const src = j.source === 'posted'
    ? { label: 'Posted on knet (see the post on GitHub)', homepage: j.issueUrl || state.sources.posted?.homepage }
    : fromCompany
      ? { label: `${j.company} careers (${state.platforms[j.source] || j.source})`, homepage: j.url }
      : state.sources[j.source];
  const statusBtn = (status, label) => h('button', {
    class: `btn${j.status === status ? ' on' : ''}`,
    onclick: async () => {
      const next = j.status === status ? 'seen' : status;
      const updated = await window.knet.setStatus(j.id, next);
      if (updated) Object.assign(j, updated);
      j.status = next;
      renderList();
      renderBoard();
      renderDetail(j);
    },
  }, j.status === status ? `✓ ${label}` : label);

  const LABELS = { skills: 'Tech skills', title: 'Role', experience: 'Experience', soft: 'Soft skills', location: 'Location' };
  const MAX = { skills: 45, title: 25, experience: 15, soft: 10, location: 5 };

  // Wrapped in h() so conditional sections that are null are skipped (replaceChildren would print "null").
  d.replaceChildren(h('div', {},
    h('div', { style: 'display:flex;gap:14px;align-items:flex-start' },
      scoreRing(j.score, 'big'),
      h('div', {},
        h('h2', {}, j.title),
        h('div', { class: 'sub' }, [j.company, j.location, j.type, j.salary, `posted ${ago(j.postedAt)}`].filter(Boolean).join(' · ')))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => window.knet.openUrl(j.url) }, j.url.startsWith('mailto:') ? 'Apply by email ↗' : 'Open posting ↗'),
      statusBtn('saved', 'Save'),
      statusBtn('applied', 'Applied'),
      statusBtn('dismissed', 'Not interested')),
    j.status === 'applied' && j.application ? applicationSection(j) : null,

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
  ));
  d.scrollTop = 0;
}

// ---------- applications ----------

async function changeStage(j, stage) {
  const updated = await window.knet.setStage(j.id, stage);
  if (!updated) return;
  Object.assign(j, updated);
  renderBoard();
  if (state.selectedId === j.id) renderDetail(j);
}

function applicationSection(j) {
  const a = j.application;
  let timer;
  const notes = h('textarea', {
    class: 'notes', rows: 4, placeholder: 'Recruiter name, salary discussed, interview dates, follow-ups…',
    oninput: (e) => {
      a.notes = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => window.knet.setNotes(j.id, a.notes), 600);
    },
  });
  notes.value = a.notes || '';
  return h('div', { class: 'application' },
    h('h3', {}, 'Application stage'),
    h('div', { class: 'stages' }, Object.entries(STAGES).map(([k, label]) =>
      h('button', {
        class: `stage-btn${a.stage === k ? ' on' : ''}${CLOSED.includes(k) ? ' closed' : ''}`,
        onclick: () => changeStage(j, k),
      }, label))),
    h('ol', { class: 'timeline' }, [...a.history].reverse().map((e) =>
      h('li', {}, h('b', {}, STAGES[e.stage] || e.stage), h('span', { class: 'muted' }, ` · ${shortDate(e.at)} (${ago(e.at)})`)))),
    h('h3', {}, 'Notes'),
    notes);
}

function renderBoard() {
  const apps = state.jobs.filter((j) => j.status === 'applied' && j.application);
  const active = apps.filter((j) => !CLOSED.includes(j.application.stage)).length;
  $('#appCount').hidden = !active;
  $('#appCount').textContent = active;

  const lastChange = (j) => j.application.history.at(-1).at;
  const card = (j) => h('div', {
    class: 'app-card',
    onclick: (e) => { if (e.target.tagName !== 'SELECT') openApplication(j.id); },
  },
  h('div', { class: 'title' }, j.title),
  h('div', { class: 'meta' }, j.company),
  h('div', { class: 'app-foot' },
    h('span', { class: 'muted' }, `${CLOSED.includes(j.application.stage) ? STAGES[j.application.stage] + ' · ' : ''}${ago(lastChange(j))}`),
    (() => {
      const sel = h('select', { title: 'Move to stage', onchange: (e) => changeStage(j, e.target.value) },
        Object.entries(STAGES).map(([k, label]) => h('option', { value: k }, label)));
      sel.value = j.application.stage;
      return sel;
    })()));

  const columns = [
    ...['applied', 'screening', 'interview', 'offer'].map((k) => ({ label: STAGES[k], stages: [k] })),
    { label: 'Closed', stages: CLOSED },
  ];
  $('#board').replaceChildren(...columns.map((c) => {
    const items = apps.filter((j) => c.stages.includes(j.application.stage))
      .sort((a, b) => lastChange(b).localeCompare(lastChange(a)));
    return h('div', { class: `column${c.label === 'Closed' ? ' closed' : ''}` },
      h('div', { class: 'column-head' }, c.label, h('span', { class: 'muted' }, items.length)),
      items.length ? items.map(card) : h('div', { class: 'muted column-empty' }, apps.length ? '—' : c.stages[0] === 'applied' ? 'Click "Applied" on a job to track it here.' : ''));
  }));
}

function openApplication(id) {
  showView('matches');
  state.status = 'applied';
  $$('#statusTabs button').forEach((x) => x.classList.toggle('active', x.dataset.status === 'applied'));
  selectJob(id);
  $(`#jobList [data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

async function loadJobs() {
  state.jobs = await window.knet.getJobs();
  renderList();
  renderBoard();
  renderCompanies(); // job counts per company
  const sel = state.jobs.find((j) => j.id === state.selectedId);
  // Don't redraw under someone typing notes; a background check can finish mid-sentence.
  if (sel && !document.activeElement?.classList.contains('notes')) renderDetail(sel);
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
  f.email.value = p.email || '';
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
    email: f.email.value.trim(),
    name: f.name.value.trim(),
    years: Number(f.years.value) || 0,
    remoteOnly: f.remoteOnly.checked,
  };
  for (const [k, get] of Object.entries(chipGetters)) profile[k] = get();
  const r = await window.knet.saveProfile(profile);
  $('#profileError').textContent = r.ok ? '' : r.error;
  if (!r.ok) { f.email.focus(); return; }
  state.profile = r.profile;
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

// ---------- company career pages ----------

const companyKey = (c) => `${c.platform}:${c.slug}`;

async function saveCompanies(msg) {
  await window.knet.saveSettings({ companies: state.settings.companies, removedShared: state.settings.removedShared || [] });
  renderCompanies();
  if (msg) companyMsg(msg, 'ok');
}

function companyMsg(text, kind = '') {
  const el = $('#companyMsg');
  el.textContent = text;
  el.className = `hint ${kind}`;
}

function renderCompanies() {
  const list = state.settings.companies || [];
  const counts = {};
  for (const j of state.jobs) {
    const parts = j.id.split(':');
    if (parts.length >= 3) counts[`${parts[0]}:${parts[1]}`] = (counts[`${parts[0]}:${parts[1]}`] || 0) + 1;
  }
  $('#companyList').replaceChildren(...[...list]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => h('li', {},
      h('input', {
        type: 'checkbox', checked: c.enabled !== false, title: 'Check this company',
        onchange: (e) => { c.enabled = e.target.checked; saveCompanies(); },
      }),
      h('span', { class: 'name' },
        state.boardUrls[companyKey(c)]
          ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.knet.openUrl(state.boardUrls[companyKey(c)]); } }, c.name)
          : c.name),
      c.shared ? h('span', { class: 'pill', title: 'Approved by an admin for all knet users' }, 'shared') : null,
      c.custom && !c.shared ? h('button', {
        type: 'button', class: 'btn small', title: 'Open a pre-filled GitHub issue so an admin can add this for everyone',
        onclick: async () => {
          await window.knet.suggestSource(companyKey(c));
          c.suggested = new Date().toISOString();
          renderCompanies();
          companyMsg(`Opened a suggestion for ${c.name} on GitHub. Submit the issue there; once an admin approves it, everyone gets it.`, 'ok');
        },
      }, c.suggested ? 'Suggested ✓' : 'Suggest') : null,
      h('span', { class: 'platform' }, `${state.platforms[c.platform] || c.platform} · ${counts[companyKey(c)] || 0} jobs`),
      h('button', {
        type: 'button', class: 'remove', title: `Remove ${c.name}`,
        onclick: () => {
          state.settings.companies = state.settings.companies.filter((x) => x !== c);
          // Don't let the shared list add it back on the next check.
          if (c.shared) state.settings.removedShared = [...(state.settings.removedShared || []), companyKey(c)];
          saveCompanies(`Removed ${c.name}.`);
        },
      }, '×'))));
}

async function addCompany() {
  const url = $('#companyUrl').value.trim();
  if (!url) return companyMsg('Paste a careers page URL first.', 'error');
  const btn = $('#addCompany');
  btn.disabled = true;
  companyMsg('Looking for the job board…');
  try {
    const r = await window.knet.detectCompany(url);
    if (!r.ok) return companyMsg(r.error, 'error');
    const exists = state.settings.companies.find((c) => companyKey(c) === companyKey(r));
    if (exists) return companyMsg(`${exists.name} is already in the list.`, 'error');
    const name = $('#companyName').value.trim() || r.name ||
      r.slug.split(/[|/]/)[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    state.settings.companies.push({ name: name.slice(0, 100), platform: r.platform, slug: r.slug, url, enabled: true, custom: true });
    state.settings.removedShared = (state.settings.removedShared || []).filter((k) => k !== companyKey(r));
    state.boardUrls[companyKey(r)] = r.boardUrl;
    $('#companyUrl').value = '';
    $('#companyName').value = '';
    await saveCompanies(`Added ${name}: ${r.label === 'RSS feed' ? 'RSS feed' : `${r.label} board`} with ${r.jobCount} jobs. They'll appear after the next check. Press Suggest to share it with everyone.`);
  } finally {
    btn.disabled = false;
  }
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

// ---------- resizable panels ----------

// Drag a divider to set a width (stored as a CSS variable, remembered per viewer).
// Double-click resets; arrow keys nudge it when the divider has focus.
function makeResizer(handle, { cssVar, def, min, max, from }) {
  const root = document.documentElement;
  const clamp = (w) => Math.round(Math.min(max(), Math.max(min, w)));
  const set = (w, save = true) => {
    const v = clamp(w);
    root.style.setProperty(cssVar, `${v}px`);
    handle.setAttribute('aria-valuenow', v);
    if (save) safeSet(cssVar, String(v));
    return v;
  };
  const current = () => parseFloat(getComputedStyle(root).getPropertyValue(cssVar)) || def;
  set(Number(safeGet(cssVar)) || def, false);
  window.addEventListener('resize', () => set(current(), false)); // keep within bounds

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const move = (ev) => set(ev.clientX - from(), false);
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      set(current());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
  handle.addEventListener('dblclick', () => set(def));
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(current() - step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); set(current() + step); }
  });
}

function setupResizers() {
  makeResizer($('#sidebarResizer'), {
    cssVar: '--sidebar-w', def: 200, min: 150, max: () => Math.min(400, window.innerWidth * 0.4),
    from: () => 0,
  });
  makeResizer($('#listResizer'), {
    cssVar: '--list-w', def: 420, min: 260,
    max: () => {
      const w = $('.split').getBoundingClientRect().width;
      return w ? Math.max(260, w - 14 - 320) : 2000; // leave room for the detail; hidden view = don't clamp
    },
    from: () => $('.split').getBoundingClientRect().left,
  });
}

// ---------- wiring ----------

// ---------- post a job ----------

let postSkills = () => [];

function postDraft() {
  const f = $('#postForm');
  return {
    title: f.title.value, company: f.company.value, location: f.location.value, workplace: f.workplace.value,
    type: f.type.value, level: f.level.value, salary: f.salary.value, tags: postSkills(),
    apply: f.apply.value, description: f.description.value,
  };
}

const CHECK_ICON = { pass: '✓', warn: '!', fail: '✕' };

async function checkPost() {
  const audit = await window.knet.checkPost(postDraft());
  const box = $('#postChecks');
  box.hidden = false;
  box.replaceChildren(
    h('div', { class: 'post-verdict' }, audit.blocking
      ? 'Fix the items marked ✕ first. The same checks run on GitHub.'
      : audit.status === 'warn' ? 'Ready to post. Have a look at the warnings.' : 'Ready to post.'),
    ...audit.checks.map((c) => h('div', { class: `check ${c.status}` }, h('b', {}, `${CHECK_ICON[c.status]} ${c.label}`), ` ${c.detail}`)));
  return audit;
}

async function submitPost(e) {
  e.preventDefault();
  const audit = await checkPost();
  if (audit.blocking) { $('#postChecks').scrollIntoView({ block: 'nearest' }); return; }
  const { copied } = await window.knet.openPostForm(postDraft());
  const msg = $('#postMsg');
  msg.className = 'hint ok';
  msg.textContent = copied
    ? 'Opened GitHub. Your description was too long to pre-fill, so it\'s on your clipboard: paste it into "Description", tick the confirmation box and submit.'
    : 'Opened GitHub with your post filled in. Tick the confirmation box and press "Submit new issue". The bot replies within a minute or two.';
}

// ---------- registration ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // same check as src/main/profile.js
const isRegistered = () => EMAIL.test((state.profile.email || '').trim());

async function register(e) {
  e.preventDefault();
  const f = $('#registerForm');
  const email = f.email.value.trim();
  const err = $('#registerError');
  if (!email) { err.textContent = 'Email is required.'; f.email.focus(); return; }
  const r = await window.knet.saveProfile({ email, name: f.name.value.trim() || state.profile.name });
  if (!r.ok) { err.textContent = r.error; f.email.focus(); return; }
  err.textContent = '';
  state.profile = r.profile;
  renderProfile();
  document.body.classList.remove('locked');
  showView(state.profile.skills.length || state.profile.titles.length ? 'matches' : 'profile');
}

function showView(name) {
  if (!isRegistered()) name = 'register';
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

async function init() {
  const s = await window.knet.getState();
  Object.assign(state, { profile: s.profile, settings: s.settings, sources: s.sources, platforms: s.platforms, boardUrls: s.boardUrls });

  setupResizers();
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
  const paintRange = () => range.style.setProperty('--fill', `${range.value}%`); // filled part of the track
  paintRange();
  $('#minScoreVal').textContent = state.minScore;
  range.addEventListener('input', () => {
    state.minScore = Number(range.value);
    paintRange();
    $('#minScoreVal').textContent = range.value;
    safeSet('minScore', range.value);
    renderList();
  });

  $('#syncBtn').addEventListener('click', () => window.knet.syncNow());
  $('#profileForm').addEventListener('submit', saveProfile);
  $('#registerForm').addEventListener('submit', register);
  postSkills = chipInput($('#postSkills'), []);
  $('#checkPost').addEventListener('click', checkPost);
  $('#postForm').addEventListener('submit', submitPost);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#testNotif').addEventListener('click', () => window.knet.testNotification());
  $('#addCompany').addEventListener('click', addCompany);
  $('#companyUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCompany(); } });

  window.knet.on('sync-status', renderSync);
  window.knet.on('jobs-updated', loadJobs);
  window.knet.on('settings-updated', (settings) => { state.settings.companies = settings.companies; renderCompanies(); });
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
  if (!isRegistered()) {
    document.body.classList.add('locked');
    $('#registerForm').name.value = state.profile.name || '';
    showView('register');
    $('#registerForm').email.focus();
  } else if (!state.profile.skills.length && !state.profile.titles.length) showView('profile');
}

init();
