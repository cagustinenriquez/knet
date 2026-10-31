// Audits a job source before it's shared with every user, and again weekly after that.
// Pure functions: the caller fetches the jobs (and robots.txt etc.) and passes them in.
//
// Each check is pass / warn / fail. Any fail blocks approval unless an admin overrides it.

const { scoreLocation } = require('./location');

const DAY = 86400000;

// Titles that read like job postings (any field, not just tech).
const JOB_TITLE = /\b(?:engineer|developer|dev|programmer|architect|designer|manager|director|head of|lead|analyst|scientist|specialist|consultant|administrator|admin|coordinator|assistant|associate|intern(?:ship)?|trainee|representative|rep|officer|executive|technician|writer|editor|strategist|recruiter|accountant|counsel|attorney|nurse|teacher|tutor|agent|operator|support|sales|marketing|product owner|scrum master|devops|sre|qa|tester|desarrollador|ingeniero|analista|dise[nñ]ador|gerente|l[ií]der|pasante|vendedor)\b/i;
const JOB_TEXT = /\b(?:apply|application|requirements|qualifications|responsibilities|experience|salary|benefits|full[- ]time|part[- ]time|contract|remote|on-?site|hybrid|requisitos|experiencia|postulaci[oó]n)\b/i;
const TECH = /\b(?:software|developer|engineer(?:ing)?|programmer|devops|sre|data|machine learning|ml|ai|cloud|security|qa|test automation|frontend|front-end|backend|back-end|full[- ]?stack|mobile|ios|android|web|platform|infrastructure|sysadmin|it support|ux|ui|product designer|blockchain|desarrollador|programador|ingenier[oa])\b/i;

// Scam patterns. Bounded gaps ([^.]{0,40}) keep these fast on long descriptions.
const SCAMS = [
  [/\b(?:registration|application|processing|training|onboarding) fee\b|\b(?:pay|deposit|purchase|buy)\b[^.]{0,40}\b(?:starter kit|training package|equipment)\b/i, 'asks the applicant to pay'],
  [/\b(?:whats\s?app|telegram)\b[^.]{0,40}(?:\+?\d[\d\s-]{6,}|contact|message|reach|text|chat)|\b(?:contact|message|reach|text|chat)\b[^.]{0,30}\b(?:whats\s?app|telegram)\b/i, 'contact over WhatsApp/Telegram'],
  [/\b(?:crypto(?:currency)?|forex|binary options?)\b[^.]{0,40}\b(?:invest(?:ment|ing)?|trading|profits?|returns)\b/i, 'crypto/forex investing'],
  [/\bearn (?:up to )?\$?\d[\d,]*\s*(?:\+\s*)?(?:per|a|\/|every)\s*day\b|\bdaily pay(?:out)?s?\b[^.]{0,30}\bno experience\b/i, 'promises daily earnings'],
  [/\bbe your own boss\b|\bunlimited (?:earning|income) potential\b|\bpassive income\b|\bfinancial freedom\b/i, 'MLM-style wording'],
  [/\b(?:send|provide|share)\b[^.]{0,30}\b(?:your )?(?:bank (?:account|details)|social security number|ssn|passport)\b/i, 'asks for bank or ID details'],
  [/\bcheck\b[^.]{0,30}\bdeposit\b[^.]{0,40}\b(?:equipment|supplies|software)\b/i, 'fake-check equipment scheme'],
  [/\bno interview(?:s)? (?:needed|required)\b|\bhired (?:immediately|today|on the spot)\b/i, 'hiring with no interview'],
];

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'rebrand.ly', 'cutt.ly', 'is.gd', 'ow.ly', 'buff.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'lnkd.in']);
const KNOWN_JOB_DOMAINS = new Set(['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'recruitee.com',
  'breezy.hr', 'bamboohr.com', 'myworkdayjobs.com', 'getonbrd.com', 'linkedin.com', 'jobvite.com', 'icims.com', 'teamtailor.com',
  'personio.de', 'personio.com', 'workday.com', 'jazzhr.com', 'applytojob.com', 'rippling.com', 'dover.com', 'wellfound.com',
  'ycombinator.com', 'workatastartup.com', 'hiringroom.com', 'manatal.com', 'careers-page.com', 'pinpointhq.com', 'gem.com']);

// "jobs.eu.lever.co" → "lever.co"; "foo.com.ar" → "foo.com.ar".
function baseDomain(host) {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  const n = parts.length >= 3 && /^(?:co|com|org|net|gov|edu|ac)$/.test(parts.at(-2)) && parts.at(-1).length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

const share = (n, total) => (total ? n / total : 0);
const pct = (x) => `${Math.round(x * 100)}%`;
const GENERIC_NAME = new Set(['inc', 'llc', 'ltd', 'sa', 'srl', 'gmbh', 'group', 'technologies', 'technology', 'tech', 'software',
  'solutions', 'labs', 'studio', 'studios', 'the', 'company', 'careers', 'jobs', 'digital', 'global', 'consulting', 'and']);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');

// Location check against a LATAM candidate (knet's main audience).
const LATAM_PROFILE = { locations: ['Argentina'], remoteOnly: false };

/**
 * @param src   { platform, slug, name }
 * @param jobs  jobs fetched from the source (shared job shape)
 * @param opts  { existingKeys?: Set (from looseKey), alreadyIn?: string (name of the existing entry),
 *                robots?: { disallowed, url }, boardName?: string, now?: number }
 * @returns { status, blocking, checks: [{ id, label, status, detail }] }
 */
function auditSource(src, jobs, opts = {}) {
  const now = opts.now ?? Date.now();
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const n = jobs.length;
  const isRss = src.platform === 'rss';

  if (opts.alreadyIn) {
    add('duplicate', 'Not already in knet', 'fail', `knet already reads this board as "${opts.alreadyIn}".`);
  }

  if (!n) {
    add('jobs', 'Has jobs', 'warn', 'No jobs right now, so nothing could be audited. Try again later or check the URL.');
    return summarize(checks);
  }

  // 1. Does it look like job postings at all?
  const jobLike = jobs.filter((j) => JOB_TITLE.test(j.title) || JOB_TEXT.test(j.description.slice(0, 3000))).length;
  const jl = share(jobLike, n);
  add('joblike', 'Looks like job postings', jl >= 0.7 ? 'pass' : jl >= 0.4 ? 'warn' : 'fail',
    `${pct(jl)} of ${n} items read like job postings.${jl < 0.7 ? ' This may be a blog or news feed.' : ''}`);

  // 2. Scam signals.
  const flagged = [];
  for (const j of jobs) {
    const text = `${j.title}\n${j.description}`.slice(0, 10000);
    const hit = SCAMS.find(([re]) => re.test(text));
    if (hit) flagged.push(`"${j.title.slice(0, 80)}": ${hit[1]}`);
  }
  const sr = share(flagged.length, n);
  add('scam', 'No scam signals', !flagged.length ? 'pass' : sr > 0.1 ? 'fail' : 'warn',
    flagged.length ? `${flagged.length} of ${n} postings flagged. ${flagged.slice(0, 3).join('; ')}` : 'None found.');

  // 3. Where do "Apply" links go?
  const srcBase = isRss ? baseDomain(src.slug.split('/')[0]) : null;
  let short = 0, bad = 0, unknown = 0;
  const unknownHosts = new Set();
  for (const j of jobs) {
    const host = hostOf(j.url);
    if (!host || !/^https?:/i.test(j.url)) { bad++; continue; }
    const base = baseDomain(host);
    if (SHORTENERS.has(host) || SHORTENERS.has(base)) short++;
    else if (base !== srcBase && !KNOWN_JOB_DOMAINS.has(base)) { unknown++; unknownHosts.add(base); }
  }
  const linkIssues = share(short + bad, n);
  add('links', 'Links go to real job pages', linkIssues > 0.1 ? 'fail' : (short || bad || share(unknown, n) > 0.5) ? 'warn' : 'pass',
    [short && `${short} use link shorteners`, bad && `${bad} have missing or non-web links`,
      unknown && `${unknown} point to other sites (${[...unknownHosts].slice(0, 4).join(', ')}${unknownHosts.size > 4 ? ', …' : ''})`]
      .filter(Boolean).join('; ') || `All links go to ${isRss ? srcBase : 'the hiring platform'} or known job sites.`);

  // 4. Freshness.
  const times = jobs.map((j) => new Date(j.postedAt).getTime()).filter((t) => !Number.isNaN(t));
  const newest = times.length ? Math.max(...times) : 0;
  const ageDays = newest ? Math.max(0, Math.round((now - newest) / DAY)) : Infinity;
  add('fresh', 'Recently updated', ageDays <= 14 ? 'pass' : ageDays <= 60 ? 'warn' : 'fail',
    Number.isFinite(ageDays) ? `Newest posting is ${ageDays} day${ageDays === 1 ? '' : 's'} old.` : 'Postings have no dates.');

  // 5. Overlap with sources we already have.
  if (opts.existingKeys) {
    const dup = jobs.filter((j) => opts.existingKeys.has(looseKey(j))).length;
    const o = share(dup, n);
    add('overlap', 'Adds new jobs', o >= 0.95 ? 'fail' : o >= 0.6 ? 'warn' : 'pass',
      `${pct(o)} of its jobs are already in knet from other sources.`);
  }

  // 6. Relevance (never blocks: it's a judgment call).
  const tech = share(jobs.filter((j) => TECH.test(j.title)).length, n);
  const open = share(jobs.filter((j) => !scoreLocation(LATAM_PROFILE, j).hardFail).length, n);
  add('relevance', 'Relevant to knet users', tech >= 0.25 && open >= 0.25 ? 'pass' : 'warn',
    `${pct(tech)} tech roles; ${pct(open)} open to candidates in Argentina/LATAM or worldwide.`);

  // 7. Does the board belong to the named company? (company boards only; warn at most)
  if (!isRss) {
    const tokens = String(src.name).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC_NAME.has(t));
    const slug = norm(src.slug.split('|')[0]);
    const board = norm(opts.boardName);
    const matches = tokens.some((t) => slug.includes(t) || board.includes(t)) || (slug.length >= 4 && norm(src.name).includes(slug));
    add('owner', 'Board matches the company name', matches ? 'pass' : 'warn',
      matches
        ? `Board "${src.slug}"${opts.boardName ? ` (${opts.boardName})` : ''} matches "${src.name}".`
        : `Board "${src.slug}"${opts.boardName ? ` (named "${opts.boardName}")` : ''} doesn't resemble "${src.name}". Confirm it's that company's board.`);
  }

  // 8. robots.txt (feeds only; hiring-platform APIs are published for this use).
  if (opts.robots) {
    add('robots', 'Site allows automated reading', opts.robots.disallowed ? 'warn' : 'pass',
      opts.robots.disallowed ? `${opts.robots.url} disallows this path. Check the site's terms before approving.` : `${opts.robots.url} allows it.`);
  } else if (!isRss) {
    add('robots', 'Site allows automated reading', 'pass', 'Public job-board API published by the hiring platform.');
  }

  return summarize(checks);
}

function summarize(checks) {
  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { status, blocking: status === 'fail', checks };
}

// Looser than sources.dupKey: location formats differ between sources.
const looseKey = (j) => `${j.company}|${j.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');

// Minimal robots.txt check for one path: rules for "*" (or "knet"); longest match wins.
function robotsDisallows(robotsTxt, path) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(robotsTxt).split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, field, value] = [m[0], m[1].toLowerCase(), m[2].trim()];
    if (field === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (field === 'allow' || field === 'disallow') && value) cur.rules.push({ allow: field === 'allow', value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a.startsWith('knet')));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    const re = new RegExp(`^${r.value.slice(0, 200).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    if (re.test(path) && (!best || r.value.length > best.value.length || (r.value.length === best.value.length && r.allow))) best = r;
  }
  return !!best && !best.allow;
}

const ICON = { pass: '✅', warn: '⚠️', fail: '❌' };

// Markdown for a GitHub comment. `safe` strips markup / @mentions from internet text.
function formatAudit(audit, safe = (s) => s) {
  return audit.checks.map((c) => `${ICON[c.status]} **${c.label}**: ${safe(c.detail)}`).join('\n');
}

module.exports = { auditSource, formatAudit, looseKey, robotsDisallows, baseDomain, SCAMS };
