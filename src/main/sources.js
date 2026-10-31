// Job sources. Each fetcher returns jobs in one shared shape:
// { id, source, title, company, location, remote, tags[], description, url, postedAt, salary, level, type }
//
// All four are free public APIs with no key. Their terms ask that you link back to
// the original posting and credit them as the source, which the UI does.

const { stripHtml, fixMojibake } = require('./text');
const { fetchCompanies, normalizeGetOnBoard, http } = require('./ats');
const { POSTED_URL, validPosts } = require('./posts');

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
  posted: {
    label: 'Posted on knet',
    homepage: 'https://github.com/cagustinenriquez/knet/issues?q=is%3Aissue+is%3Aopen+label%3Ajob-post',
    async fetch() {
      try {
        return validPosts(await http(`${POSTED_URL}?t=${Date.now()}`)); // skip stale caches
      } catch (e) {
        if (e.message === 'HTTP 404') return []; // not published yet
        throw e;
      }
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
  getonbrd: {
    label: 'Get on Board',
    homepage: 'https://www.getonbrd.com',
    // LATAM-focused tech board. Newest postings from the tech categories.
    async fetch() {
      const cats = { programming: 2, 'sysadmin-devops-qa': 1, 'mobile-developer': 1, 'data-science-analytics': 1, 'machine-learning-ai': 1 };
      const pages = Object.entries(cats).flatMap(([c, n]) => Array.from({ length: n }, (_, i) => [c, i + 1]));
      const results = await Promise.all(pages.map(([c, page]) =>
        http(`https://www.getonbrd.com/api/v0/categories/${c}/jobs?per_page=100&page=${page}&expand=["company","tags","seniority"]`)
          .then((d) => d.data || []).catch(() => [])));
      return results.flat().map((j) => normalizeGetOnBoard(j));
    },
  },
};

// Fetch every enabled job board plus the company career boards, in parallel.
// One failing source doesn't stop the others. `known` = ids already stored.
async function fetchAll(settings, known = new Set()) {
  const enabled = settings.sources || {};
  const names = Object.keys(SOURCES).filter((n) => enabled[n] !== false);
  const [boardResults, companies] = await Promise.all([
    Promise.allSettled(names.map((n) => SOURCES[n].fetch())),
    enabled.companies !== false ? fetchCompanies(settings.companies || [], known) : { jobs: [], errors: [] },
  ]);
  const errors = [...companies.errors];
  const raw = [...companies.jobs];
  boardResults.forEach((r, i) => {
    if (r.status === 'fulfilled') raw.push(...r.value);
    else errors.push(`${SOURCES[names[i]].label}: ${r.reason.message}`);
  });
  const jobs = [];
  for (const j of raw) {
    if (!j || !j.title || !j.url) continue;
    for (const k of ['title', 'company', 'location']) j[k] = fixMojibake(String(j[k] || '')).trim();
    j.tags = j.tags || [];
    j.description = j.description || '';
    jobs.push(j);
  }
  return { jobs, errors };
}

// Same company + title + location = same job (often cross-posted to several boards).
// Location matters: many companies post one opening per country.

module.exports = { SOURCES, fetchAll };
