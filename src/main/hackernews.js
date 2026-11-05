// Hacker News jobs (news.ycombinator.com/jobs), read from hnrss.org's RSS feed.
//
// These are the "X (YC W19) Is Hiring …" posts from YC companies. The feed has no job text,
// only a title and a link to the company's posting, so the title is parsed:
//   "Great Question (YC W21) Is Hiring Product Engineers in Canada (Remote)"
//   → company "Great Question", title "Product Engineers", location "Canada (remote)", tag "YC W21".
// Matching therefore leans on the title. Pure parsing helpers are exported for tests.

const { parseFeed } = require('./rss');

const FEED_URL = 'https://hnrss.org/jobs?count=100';
const HOMEPAGE = 'https://news.ycombinator.com/jobs';

// " in Austin, TX", " in NYC", " in Canada (Remote)". Place words must be capitalized, so
// "Leader in Office of CEO" isn't read as a place.
const PLACE = /\s+in\s+([A-Z][\w.]*(?:,?\s+[A-Z][\w.]*){0,3})(\s*\([^)]*\))?$/;

function parseTitle(raw = '') {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const m = text.match(/^(.+?)\s*(?:\((YC [A-Z]\d{2})\))?\s+is hiring\b:?\s*(.*)$/i);
  if (!m) return { company: '', batch: '', title: text, location: '', remote: /\bremote\b/i.test(text) };
  const [, company, batch = '', rest] = m;
  let role = rest.replace(/^(?:an?|for|across)\s+/i, '').trim();
  let location = '';
  const remote = /\bremote\b/i.test(rest);
  const p = ` ${role}`.match(PLACE); // leading space: "Is Hiring in Austin, TX" has no role
  if (p) {
    const paren = p[2] || '';
    // A trailing "(Remote)"/"(Hybrid)" belongs to the place; anything else stays in the title.
    const placeParen = /remote|hybrid|onsite|on-site/i.test(paren);
    location = placeParen ? `${p[1]} ${paren.trim().toLowerCase()}` : p[1];
    role = ` ${role}`.slice(0, p.index) + (placeParen ? '' : paren);
  } else if (remote) {
    location = 'Remote';
  }
  return { company: company.trim(), batch, title: role.trim() || 'Open roles', location, remote };
}

// "https://news.ycombinator.com/item?id=50354582" → "hackernews:50354582"
function jobId(item) {
  const m = String(item.guid || '').match(/[?&]id=(\d+)/);
  return m ? `hackernews:${m[1]}` : null;
}

function toHnJob(item) {
  const id = jobId(item);
  if (!id || !/^https?:\/\//i.test(item.link || '')) return null;
  const t = parseTitle(item.title);
  return {
    id,
    source: 'hackernews',
    title: t.title,
    company: t.company || 'Hacker News',
    location: t.location,
    remote: t.remote,
    tags: [t.batch].filter(Boolean),
    description: `${item.title.trim()}. Posted on Hacker News jobs.`,
    url: item.link,
    postedAt: new Date(Number.isNaN(Date.parse(item.date)) ? Date.now() : item.date).toISOString(),
    salary: '',
    type: '',
  };
}

// `http(url, {text:true})` from ats.js, so requests share its user agent and timeout.
async function fetchHackerNews(http) {
  const xml = await http(FEED_URL, { text: true, headers: { Accept: 'application/rss+xml, application/xml' } });
  return parseFeed(xml).map(toHnJob).filter(Boolean);
}

module.exports = { FEED_URL, HOMEPAGE, parseTitle, jobId, toHnJob, fetchHackerNews };
