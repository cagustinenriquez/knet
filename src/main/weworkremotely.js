// We Work Remotely (weworkremotely.com): remote jobs, read from its public RSS feed
// (/remote-jobs.rss, allowed by robots.txt): the newest 100 jobs, with full descriptions.
//
// Items are titled "Company: Job title" and carry WWR's own tags: <region> ("Anywhere in the
// World", "USA Only"…), <category>, <type> ("Full-Time", "Contract") and <skills>.
// The shared RSS parser reads most of it; type and skills are read here.

const { parseFeed, feedToJobs } = require('./rss');
const { stripHtml } = require('./text');

const FEED_URL = 'https://weworkremotely.com/remote-jobs.rss';
const HOMEPAGE = 'https://weworkremotely.com';

// "https://weworkremotely.com/remote-jobs/toptal-ml-engineer" → "weworkremotely:toptal-ml-engineer"
function jobId(url) {
  const m = String(url).match(/^https:\/\/weworkremotely\.com\/remote-jobs\/([^/?#]+)/);
  return m ? `weworkremotely:${m[1]}` : null;
}

// Per item link: { type, skills[] }, from tags rss.js doesn't read.
function extras(xml) {
  const out = new Map();
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const get = (name) => stripHtml(m[0].match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '').trim();
    const link = get('link');
    if (link) out.set(link, { type: get('type'), skills: get('skills').split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

function toWwrJobs(xml) {
  const extra = extras(xml);
  return feedToJobs(parseFeed(xml), 'weworkremotely.com', 'We Work Remotely').map((j) => {
    const id = jobId(j.url);
    if (!id) return null;
    const { type = '', skills = [] } = extra.get(j.url) || {};
    return {
      ...j,
      id,
      source: 'weworkremotely',
      location: j.location || 'Anywhere in the World',
      remote: true, // every WWR job is remote; the region says from where
      tags: [...new Set([...j.tags, ...skills])].slice(0, 15),
      salary: '',
      type,
    };
  }).filter(Boolean);
}

// `http(url, {text:true})` from ats.js, so requests share its user agent and timeout.
async function fetchWeWorkRemotely(http) {
  return toWwrJobs(await http(FEED_URL, { text: true, headers: { Accept: 'application/rss+xml, application/xml' } }));
}

module.exports = { FEED_URL, HOMEPAGE, jobId, toWwrJobs, fetchWeWorkRemotely };
