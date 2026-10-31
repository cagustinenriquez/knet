// Job sites with no feed or API. Many still describe each job page with schema.org
// "JobPosting" data (the structured data Google Jobs reads). This reader:
//   1. loads the site's job list page(s) and finds the links that lead to job pages,
//   2. fetches only job pages it hasn't seen before (politely: 2 at a time, robots.txt honored),
//   3. reads the JobPosting data on each page.
// Used for sites like relocate.me. Pure parsing helpers are exported for tests.

const crypto = require('crypto');
const { stripHtml } = require('./text');

const MAX_PAGES = 10;     // list pages per check
const NEW_PER_CHECK = 30; // job pages fetched per check (the rest come next time)
const MAX_DESC = 8000;

const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const clean = (s) => stripHtml(String(s ?? '')).replace(/\s+/g, ' ').trim(); // also decodes &amp; etc.

// "relocate.me/international-jobs" (host + path + query), https only, like RSS feed slugs.
function pageSlug(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Job sites must use https://');
  if (u.port) throw new Error('Job sites on custom ports are not supported');
  return `${u.host}${u.pathname.replace(/\/$/, '') || '/'}${u.search}`;
}
const pageUrl = (slug) => `https://${slug}`;

// Stable id per job page URL, so pages already read are skipped before fetching them.
function jobId(url) {
  const u = new URL(url);
  return `jobpage:${u.host}:${shortHash(`${u.host}${u.pathname}`)}`;
}

// ---------- reading JobPosting data ----------

// All JSON-LD objects on a page. Some sites put raw newlines/tabs inside JSON strings,
// which JSON.parse rejects; they're turned into spaces first.
function jsonLd(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, ' '))); } catch { /* skip bad block */ }
  }
  return out;
}

const isType = (o, t) => o && (o['@type'] === t || (Array.isArray(o['@type']) && o['@type'].includes(t)));

// JobPosting objects anywhere in the JSON-LD (top level, arrays, @graph, ItemList items).
function findPostings(html) {
  const found = [];
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6 || found.length > 200) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
    if (isType(o, 'JobPosting')) { found.push(o); return; }
    for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity']) if (o[k]) walk(o[k], depth + 1);
  };
  jsonLd(html).forEach((d) => walk(d));
  return found;
}

const name = (v) => clean(typeof v === 'string' ? v : v?.name);
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function locationOf(p) {
  const placesText = list(p.jobLocation).map((l) => {
    const a = l?.address || {};
    if (typeof a === 'string') return clean(a);
    return [a.addressLocality, a.addressRegion, name(a.addressCountry)].map(clean).filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i).join(', ');
  }).filter(Boolean);
  const remote = list(p.jobLocationType).some((t) => /telecommute/i.test(t));
  const allowed = list(p.applicantLocationRequirements).map(name).filter(Boolean);
  const where = [...new Set(placesText)].join('; ');
  if (remote) return { remote: true, location: `Remote${allowed.length ? ` - ${allowed.join(', ')}` : where ? ` - ${where}` : ''}` };
  return { remote: false, location: where };
}

// One JobPosting → the shared job shape (see sources.js). Null if unusable or expired.
function toJob(p, url, now = Date.now()) {
  const title = clean(p.title || p.name);
  const company = name(p.hiringOrganization);
  if (!title || !company) return null;
  if (p.validThrough && Date.parse(p.validThrough) < now) return null; // closed
  const { location, remote } = locationOf(p);
  const posted = Date.parse(p.datePosted);
  return {
    id: jobId(url), title, company, location, remote,
    type: list(p.employmentType).map((t) => clean(t).toLowerCase().replace(/_/g, '-')).join(', ').slice(0, 40),
    tags: list(p.skills || p.occupationalCategory).flatMap((s) => String(s).split(',')).map(clean).filter((t) => t && t.length <= 40).slice(0, 10),
    description: stripHtml(String(p.description || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).slice(0, MAX_DESC),
    url, postedAt: new Date(Number.isNaN(posted) ? now : posted).toISOString(),
  };
}

// ---------- finding job links on a list page ----------

const hrefs = (html, base) => {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), base);
      if (u.protocol === 'https:' || u.protocol === 'http:') out.push(u);
    } catch { /* bad URL */ }
  }
  return out;
};

// Job links share a shape: same depth, and usually an id at the end
// ("/netherlands/amsterdam/catawiki/lead-security-engineer-10303"). The biggest group of
// same-site links with one shape (at least 3) is taken as the job links.
function findJobLinks(html, listUrl) {
  const base = new URL(listUrl);
  const groups = new Map();
  for (const u of hrefs(html, base)) {
    if (u.host !== base.host || u.search) continue;
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2) continue;
    const last = segs[segs.length - 1];
    const shape = `${segs.length}|${/\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(last) ? 'id' : 'slug'}|${last.includes('-') ? '-' : ''}`;
    const href = `${u.origin}${u.pathname}`;
    if (href === `${base.origin}${base.pathname}`) continue;
    if (!groups.has(shape)) groups.set(shape, new Set());
    groups.get(shape).add(href);
  }
  // Prefer link shapes that end in an id; then the biggest group.
  const best = [...groups.entries()].sort((a, b) =>
    (b[0].includes('|id|') ? 1 : 0) - (a[0].includes('|id|') ? 1 : 0) || b[1].size - a[1].size)[0];
  return best && best[1].size >= 3 ? [...best[1]] : [];
}

// The next list page: rel="next", or a link to ?page=N+1.
function nextPage(html, current) {
  const cur = new URL(current);
  const rel = String(html).match(/<(?:link|a)\b[^>]*\brel=["']next["'][^>]*\bhref=["']([^"']+)["']|<(?:link|a)\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']next["']/i);
  if (rel) return new URL((rel[1] || rel[2]).replace(/&amp;/g, '&'), cur).href;
  const n = Number(cur.searchParams.get('page') || 1) + 1;
  const want = hrefs(html, cur).find((u) => u.host === cur.host && u.pathname === cur.pathname && u.searchParams.get('page') === String(n));
  return want ? want.href : null;
}

const siteName = (html, url) => clean(String(html).match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1]) || new URL(url).host.replace(/^www\./, '');

// ---------- fetching ----------

// `http(url, {text:true})` is passed in (ats.js) so requests share one user agent / timeout.
// `known.has(id)` skips pages already read; `known.sample = n` reads up to n pages regardless
// (used when checking a new source).
async function fetchJobPages(slug, http, known, { robotsDisallows } = {}) {
  const start = pageUrl(slug);
  const get = (u) => http(u, { text: true, headers: { Accept: 'text/html' } });
  let robots = '';
  try { robots = await get(`${new URL(start).origin}/robots.txt`); } catch { /* none */ }
  const allowed = (u) => !robotsDisallows || !robotsDisallows(robots, new URL(u).pathname);
  if (!allowed(start)) throw new Error('robots.txt asks crawlers not to read this page');

  const links = new Set();
  let page = start;
  for (let i = 0; i < MAX_PAGES && page; i++) {
    const html = await get(page);
    const before = links.size;
    findJobLinks(html, page).forEach((l) => links.add(l));
    if (links.size === before && i > 0) break; // no new jobs on this page
    page = nextPage(html, page);
  }
  const todo = [...links].filter(allowed)
    .filter((u) => (known.sample ? true : !known.has(jobId(u))))
    .slice(0, known.sample || NEW_PER_CHECK);

  const jobs = [];
  let i = 0;
  await Promise.all([0, 1].map(async () => {
    while (i < todo.length) {
      const u = todo[i++];
      try {
        const posting = findPostings(await get(u))[0];
        const job = posting && toJob(posting, u);
        if (job) jobs.push(job);
      } catch { /* skip this page */ }
      await new Promise((r) => setTimeout(r, 250)); // be gentle
    }
  }));
  return { jobs, linkCount: links.size };
}

module.exports = { pageSlug, pageUrl, jobId, jsonLd, findPostings, toJob, findJobLinks, nextPage, siteName, fetchJobPages };
