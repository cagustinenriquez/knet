// Job sources. Each fetcher returns jobs in one shared shape:
// { id, source, title, company, location, remote, tags[], description, url, postedAt, salary, level, type }
//
// All four are free public APIs with no key. Their terms ask that you link back to
// the original posting and credit them as the source, which the UI does.

const { stripHtml } = require('./text');

const UA = 'knet-desktop/0.1 (job alerts MVP)';
const MAX_DESC = 8000;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const desc = (html) => stripHtml(html).slice(0, MAX_DESC);
const toIso = (d) => {
  const t = typeof d === 'number' ? new Date(d * 1000) : new Date(d);
  return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
};
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const SOURCES = {
  remotive: {
    label: 'Remotive',
    homepage: 'https://remotive.com',
    async fetch() {
      const d = await getJson('https://remotive.com/api/remote-jobs?limit=300');
      return (d.jobs || []).map((j) => ({
        id: `remotive:${j.id}`,
        source: 'remotive',
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || 'Remote',
        remote: true,
        tags: asArray(j.tags).map(String),
        description: desc(j.description),
        url: j.url,
        postedAt: toIso(j.publication_date),
        salary: j.salary || '',
        type: j.job_type || '',
      }));
    },
  },
  remoteok: {
    label: 'Remote OK',
    homepage: 'https://remoteok.com',
    async fetch() {
      const d = await getJson('https://remoteok.com/api');
      return d.filter((j) => j.id && j.position).map((j) => ({
        id: `remoteok:${j.id}`,
        source: 'remoteok',
        title: j.position,
        company: j.company,
        location: j.location || 'Remote',
        remote: true,
        tags: asArray(j.tags).map(String),
        description: desc(j.description),
        url: j.url,
        postedAt: toIso(j.epoch || j.date),
        salary: j.salary_min ? `$${j.salary_min}–$${j.salary_max}` : '',
        type: '',
      }));
    },
  },
  arbeitnow: {
    label: 'Arbeitnow',
    homepage: 'https://www.arbeitnow.com',
    async fetch() {
      const d = await getJson('https://www.arbeitnow.com/api/job-board-api');
      return (d.data || []).map((j) => ({
        id: `arbeitnow:${j.slug}`,
        source: 'arbeitnow',
        title: j.title,
        company: j.company_name,
        location: j.location || '',
        remote: Boolean(j.remote),
        tags: asArray(j.tags).map(String),
        description: desc(j.description),
        url: j.url,
        postedAt: toIso(j.created_at),
        salary: '',
        type: asArray(j.job_types).join(', '),
      }));
    },
  },
  jobicy: {
    label: 'Jobicy',
    homepage: 'https://jobicy.com',
    async fetch() {
      const d = await getJson('https://jobicy.com/api/v2/remote-jobs?count=100');
      return (d.jobs || []).map((j) => ({
        id: `jobicy:${j.id}`,
        source: 'jobicy',
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo || 'Remote',
        remote: true,
        tags: [...asArray(j.jobIndustry), ...asArray(j.jobType)].map((t) => stripHtml(String(t))),
        description: desc(j.jobDescription || j.jobExcerpt),
        url: j.url,
        postedAt: toIso(j.pubDate),
        salary: j.annualSalaryMin ? `${j.salaryCurrency || ''} ${j.annualSalaryMin}–${j.annualSalaryMax}`.trim() : '',
        level: j.jobLevel || '',
        type: asArray(j.jobType).join(', '),
      }));
    },
  },
};

// Fetch every enabled source in parallel. One failing source doesn't stop the others.
async function fetchAll(enabled) {
  const names = Object.keys(SOURCES).filter((n) => enabled[n] !== false);
  const results = await Promise.allSettled(names.map((n) => SOURCES[n].fetch()));
  const jobs = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') jobs.push(...r.value.filter((j) => j.title && j.url));
    else errors.push(`${SOURCES[names[i]].label}: ${r.reason.message}`);
  });
  return { jobs, errors };
}

module.exports = { SOURCES, fetchAll };
