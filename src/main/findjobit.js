// Findjobit (findjobit.com): tech jobs in Latin America, many in Spanish. Read from its public
// RSS feed (/jobs/feed, allowed by robots.txt): the newest ~100 jobs, with full descriptions.
//
// Items are titled "Company busca un Role" ("Company is looking for a Role"), sometimes ending
// in "· Remote". <region> lists the countries the job is open to, <type> is the job type in
// Spanish and <category> the role family. The shared RSS parser reads the rest.

const { parseFeed, feedToJobs } = require('./rss');
const { stripHtml } = require('./text');

const FEED_URL = 'https://findjobit.com/jobs/feed';
const HOMEPAGE = 'https://findjobit.com';

const TYPES = { 'tiempo completo': 'Full-Time', 'medio tiempo': 'Part-Time', temporal: 'Temporary', freelance: 'Freelance', 'por proyecto': 'Contract' };

// "https://findjobit.com/jobs/6aeb47267e7f5d6574af838f" → "findjobit:6aeb47267e7f5d6574af838f"
function jobId(url) {
  const m = String(url).match(/^https:\/\/findjobit\.com\/jobs\/([\w-]+)\/?$/);
  return m ? `findjobit:${m[1]}` : null;
}

// "Niuro busca un Lead Data Engineer · Remote" → { company: 'Niuro', title: 'Lead Data Engineer', remote: true }
function splitTitle(raw = '') {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const m = text.match(/^(.+?)\s+busca\s+(?:una?\s+|a\s+)?(.+)$/i);
  let [company, title] = m ? [m[1], m[2]] : ['', text];
  const suffix = title.match(/\s*[·|–-]\s*(remot[eo](?:\s+latam)?)\s*$/i);
  if (suffix) title = title.slice(0, suffix.index);
  return { company: company.trim(), title: title.trim(), remote: !!suffix || /\bremot[eo]\b/i.test(title) };
}

// Per item link: { region, type }. <region> is "Chile" or "Costa Rica,Paraguay,…".
function extras(xml) {
  const out = new Map();
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const get = (name) => stripHtml(m[0].match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '').trim();
    const link = get('link');
    if (link) out.set(link, { region: get('region'), type: get('type') });
  }
  return out;
}

// Remote if the title says so, or the description's opening does ("100% remote from Latin America").
const REMOTE_TEXT = /\b(?:100%\s*)?remot[eo]\b|\bteletrabajo\b|\bhome ?office\b/i;

function toFindjobitJobs(xml) {
  const extra = extras(xml);
  return feedToJobs(parseFeed(xml), 'findjobit.com', 'Findjobit').map((j) => {
    const id = jobId(j.url);
    if (!id) return null;
    const { region = '', type = '' } = extra.get(j.url) || {};
    const t = splitTitle(j.title);
    const countries = region.split(',').map((c) => c.trim()).filter(Boolean);
    return {
      ...j,
      id,
      source: 'findjobit',
      title: t.title,
      company: t.company || 'Findjobit',
      location: countries.join(', '),
      remote: t.remote || REMOTE_TEXT.test(j.description.slice(0, 600)),
      salary: '',
      type: TYPES[type.toLowerCase()] || type,
    };
  }).filter(Boolean);
}

// `http(url, {text:true})` from ats.js, so requests share its user agent and timeout.
async function fetchFindjobit(http) {
  return toFindjobitJobs(await http(FEED_URL, { text: true, headers: { Accept: 'application/rss+xml, application/xml' } }));
}

module.exports = { FEED_URL, HOMEPAGE, jobId, splitTitle, toFindjobitJobs, fetchFindjobit };
