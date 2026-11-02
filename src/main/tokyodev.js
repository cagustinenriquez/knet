// TokyoDev (tokyodev.com): English-speaking developer jobs in Japan.
//
// Read from the official Atom feed (/jobs/atom.xml, allowed by robots.txt): the newest ~20 jobs.
// Each entry's summary follows a fixed pattern, parsed into location, tags and salary:
//   "PayPay is hiring a Frontend Engineer. Apply from abroad. No Japanese required.
//    Partially remote ¥7.5M ~ ¥10.4M"
// The job pages themselves sit behind a Cloudflare bot check (checked Nov 2026), so they aren't
// read: the feed is the access TokyoDev offers to programs. Descriptions are therefore short
// (the summary), and matching leans on the title. Pure parsing helpers are exported for tests.

const { parseFeed } = require('./rss');
const { stripHtml } = require('./text');

const FEED_URL = 'https://www.tokyodev.com/jobs/atom.xml';
const HOMEPAGE = 'https://www.tokyodev.com/jobs';

const CITIES = ['Tokyo', 'Osaka', 'Kyoto', 'Fukuoka', 'Yokohama', 'Nagoya', 'Sapporo', 'Kobe', 'Sendai', 'Hiroshima', 'Okinawa', 'Tsukuba'];

// "https://www.tokyodev.com/companies/paypay/jobs/frontend-engineer" → "tokyodev:paypay/frontend-engineer"
function jobId(url) {
  const m = new URL(url).pathname.match(/^\/companies\/([^/]+)\/jobs\/([^/]+)/);
  return m ? `tokyodev:${m[1]}/${m[2]}` : null;
}

// The summary's facts.
function parseSummary(summary = '') {
  const s = stripHtml(summary).replace(/\s+/g, ' ');
  const japanese = s.match(/\b(No Japanese|Basic|Conversational|Business|Fluent|Native)(?: Japanese)? required/i);
  const level = japanese && (/^no/i.test(japanese[1]) ? 'No Japanese required' : `Japanese: ${japanese[1].toLowerCase()} level`);
  const salary = s.match(/¥\s?[\d.,]+\s?M?(?:\s*~\s*¥?\s?[\d.,]*\s?M?)?/);
  return {
    abroad: /apply from abroad/i.test(s),
    residency: /residency in japan required/i.test(s),
    japanese: level || '',
    remote: /fully remote/i.test(s) ? 'full' : /partially remote/i.test(s) ? 'partial' : /no remote/i.test(s) ? 'none' : '',
    salary: salary ? salary[0].replace(/\s+/g, ' ').replace(/~\s*$/, '').trim() : '',
    text: s,
  };
}

// "AI Security Engineer, CISO Office, Tokyo at Money Forward" → title without " at <company>", and the city.
function splitTitle(title, company) {
  let t = String(title).trim();
  if (company && t.toLowerCase().endsWith(` at ${company.toLowerCase()}`)) t = t.slice(0, -(company.length + 4)).trim();
  const city = CITIES.find((c) => new RegExp(`(?:,|\\s-)\\s*${c}$`, 'i').test(t)) || '';
  return { title: t, city };
}

// One feed entry → the shared job shape (see sources.js).
function toTokyoDevJob(entry) {
  const id = jobId(entry.link);
  if (!id) return null;
  const company = entry.company || '';
  const { title, city } = splitTitle(entry.title, company);
  const facts = parseSummary(entry.description);
  const place = city ? `${city}, Japan` : 'Japan';
  const location = facts.remote === 'full' ? 'Remote - Japan'
    : facts.remote === 'partial' ? `${place} (hybrid)` : place;
  const tags = [
    facts.abroad ? 'Apply from abroad' : '', facts.residency ? 'Japan residents only' : '', facts.japanese,
    facts.remote === 'partial' ? 'Hybrid' : '',
  ].filter(Boolean);
  return {
    id,
    source: 'tokyodev',
    title,
    company: company || 'TokyoDev',
    location,
    remote: facts.remote === 'full',
    tags,
    description: facts.text,
    url: entry.link,
    postedAt: new Date(Number.isNaN(Date.parse(entry.date)) ? Date.now() : entry.date).toISOString(),
    salary: facts.salary,
    type: '',
  };
}

// Atom entries carry the company as <author><name>; rss.js doesn't read that, so do it here.
function authors(xml) {
  const out = new Map();
  for (const m of String(xml).matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const link = m[0].match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1];
    const name = m[0].match(/<author>\s*<name>([\s\S]*?)<\/name>/i)?.[1];
    if (link && name) out.set(link, stripHtml(name).trim());
  }
  return out;
}

// `http(url, {text:true})` from ats.js, so requests share its user agent and timeout.
async function fetchTokyoDev(http) {
  const xml = await http(FEED_URL, { text: true, headers: { Accept: 'application/atom+xml, application/xml' } });
  const company = authors(xml);
  return parseFeed(xml).map((e) => toTokyoDevJob({ ...e, company: company.get(e.link) || '' })).filter(Boolean);
}

module.exports = { FEED_URL, HOMEPAGE, jobId, parseSummary, splitTitle, toTokyoDevJob, fetchTokyoDev };
