// Company career boards. Most companies don't host their own job lists: they use a
// hiring platform (ATS) like Greenhouse or Lever, which publishes a public JSON feed.
// Reading those feeds is far sturdier than scraping careers pages.
//
// Each platform has:
//   pattern  — finds the company's account ("slug") in a careers URL or page HTML
//   fetch    — returns jobs in the shared job shape (see sources.js)
//   boardUrl — a human link to the company's job board

const { stripHtml } = require('./text');
const rss = require('./rss');
const jobpage = require('./jobpage');
const { robotsDisallows } = require('./audit');

const UA = 'Mozilla/5.0 (compatible; knet-desktop/0.1; job alerts)';
const MAX_DESC = 8000;
const DETAIL_LIMIT = 40; // per company per check, for platforms that need one request per job

async function http(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return opts.text ? res.text() : res.json();
}

const desc = (...html) => stripHtml(html.filter(Boolean).join('\n')).slice(0, MAX_DESC);
const iso = (d) => {
  const t = new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
  return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
};
const unescapeHtml = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const isRemote = (...s) => /\bremot[eo]\b|work from home|anywhere/i.test(s.filter(Boolean).join(' '));
const uniq = (a) => [...new Set(a.filter(Boolean))];

// Run async jobs with limited parallelism.
async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  }));
  return out;
}

const PLATFORMS = {
  greenhouse: {
    label: 'Greenhouse',
    pattern: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]{1,80})|boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]{1,80})/i,
    boardUrl: (s) => `https://job-boards.greenhouse.io/${s}`,
    async fetch(s, company) {
      const d = await http(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`);
      return (d.jobs || []).map((j) => {
        const loc = uniq([j.location?.name, ...(j.offices || []).map((o) => o.name)]).join(', ');
        return {
          id: `greenhouse:${s}:${j.id}`, title: j.title, company, location: loc, remote: isRemote(loc, j.title),
          tags: uniq((j.departments || []).map((x) => x.name)), description: desc(unescapeHtml(j.content)),
          url: j.absolute_url, postedAt: iso(j.first_published || j.updated_at),
        };
      });
    },
  },

  lever: {
    label: 'Lever',
    pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]{1,80})/i,
    boardUrl: (s) => `https://jobs.lever.co/${s}`,
    async fetch(s, company) {
      const d = await http(`https://api.lever.co/v0/postings/${s}?mode=json`);
      return (Array.isArray(d) ? d : []).map((j) => {
        const loc = uniq([...(j.categories?.allLocations || []), j.categories?.location]).join(', ');
        return {
          id: `lever:${s}:${j.id}`, title: j.text, company, location: loc,
          remote: j.workplaceType === 'remote' || isRemote(loc),
          tags: uniq([j.categories?.team, j.categories?.department]),
          description: desc(j.descriptionPlain || j.description, ...(j.lists || []).map((l) => `${l.text}\n${l.content}`), j.additionalPlain),
          url: j.hostedUrl, postedAt: iso(j.createdAt), type: j.categories?.commitment || '',
        };
      });
    },
  },

  ashby: {
    label: 'Ashby',
    pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]{1,80})/i,
    boardUrl: (s) => `https://jobs.ashbyhq.com/${s}`,
    async fetch(s, company) {
      const d = await http(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
      return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => {
        const loc = uniq([j.location, ...(j.secondaryLocations || []).map((x) => x.location)]).join(', ');
        return {
          id: `ashby:${s}:${j.id}`, title: j.title, company, location: loc,
          remote: j.isRemote || j.workplaceType === 'Remote', tags: uniq([j.department, j.team]),
          description: desc(j.descriptionPlain || j.descriptionHtml), url: j.jobUrl,
          postedAt: iso(j.publishedAt), type: j.employmentType || '',
        };
      });
    },
  },

  workable: {
    label: 'Workable',
    pattern: /apply\.workable\.com\/(?!j\/|api\/)([a-z0-9_-]{1,80})/i,
    boardUrl: (s) => `https://apply.workable.com/${s}`,
    async fetch(s, company) {
      const d = await http(`https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`);
      // The feed repeats a job once per location with the same shortcode; merge them.
      const byCode = new Map();
      for (const j of d.jobs || []) {
        const places = (j.locations?.length ? j.locations : [j]).map((l) => uniq([l.city, l.country]).join(', '));
        const seen = byCode.get(j.shortcode);
        if (seen) { seen.places.push(...places); continue; }
        byCode.set(j.shortcode, { j, places });
      }
      // A remote Workable job tied to countries means "remote from those countries".
      return [...byCode.values()].map(({ j, places }) => ({
        id: `workable:${s}:${j.shortcode}`, title: j.title, company, location: uniq(places).join(' / '),
        remote: Boolean(j.telecommuting), tags: uniq([j.department, j.function]),
        description: desc(j.description), url: j.url || j.shortlink,
        postedAt: iso(j.published_on || j.created_at), level: j.experience || '', type: j.employment_type || '',
      }));
    },
  },

  recruitee: {
    label: 'Recruitee',
    pattern: /(?<![a-z0-9-])([a-z0-9-]{1,63})\.recruitee\.com/i,
    boardUrl: (s) => `https://${s}.recruitee.com`,
    async fetch(s, company) {
      const d = await http(`https://${s}.recruitee.com/api/offers/`);
      return (d.offers || []).map((j) => ({
        id: `recruitee:${s}:${j.id}`, title: j.title, company: j.company_name || company,
        location: j.location || uniq([j.city, j.country]).join(', '), remote: Boolean(j.remote),
        tags: uniq([j.department, ...(j.tags || [])]), description: desc(j.description, j.requirements),
        url: j.careers_url, postedAt: iso(j.published_at || j.created_at), type: j.employment_type_code || '',
      }));
    },
  },

  smartrecruiters: {
    label: 'SmartRecruiters',
    pattern: /(?:careers|jobs)\.smartrecruiters\.com\/([a-z0-9_-]{1,80})/i,
    boardUrl: (s) => `https://jobs.smartrecruiters.com/${s}`,
    // The list has no descriptions, so fetch details only for jobs we haven't seen yet.
    async fetch(s, company, known) {
      const list = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const d = await http(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100&offset=${offset}`);
        list.push(...(d.content || []));
        if (list.length >= (d.totalFound || 0) || !(d.content || []).length) break;
      }
      const jobs = list.map((j) => ({
        id: `smartrecruiters:${s}:${j.id}`, title: j.name, company: j.company?.name || company,
        location: j.location?.fullLocation || uniq([j.location?.city, j.location?.country]).join(', '),
        remote: Boolean(j.location?.remote), tags: uniq([j.department?.label, j.function?.label]),
        description: '', url: `https://jobs.smartrecruiters.com/${s}/${j.id}`,
        postedAt: iso(j.releasedDate), level: j.experienceLevel?.label || '', type: j.typeOfEmployment?.label || '',
      }));
      const todo = jobs.filter((j) => !known.has(j.id)).slice(0, DETAIL_LIMIT);
      await pool(todo, 4, async (j) => {
        const d = await http(`https://api.smartrecruiters.com/v1/companies/${s}/postings/${j.id.split(':').pop()}`);
        const sec = d.jobAd?.sections || {};
        j.description = desc(sec.jobDescription?.text, sec.qualifications?.text, sec.additionalInformation?.text);
      });
      return jobs;
    },
  },

  breezy: {
    label: 'Breezy HR',
    pattern: /(?<![a-z0-9-])([a-z0-9-]{1,63})\.breezy\.hr/i,
    boardUrl: (s) => `https://${s}.breezy.hr`,
    async fetch(s, company) {
      const d = await http(`https://${s}.breezy.hr/json`);
      return (Array.isArray(d) ? d : []).map((j) => ({
        id: `breezy:${s}:${j.id}`, title: j.name, company: j.company?.name || company,
        location: uniq((j.locations || [j.location]).map((l) => l?.is_remote && !l?.country ? 'Remote' : l?.country?.name || l?.name)).join(', '),
        remote: Boolean(j.location?.is_remote), tags: uniq([j.department]),
        description: '', // the feed has no descriptions; matching uses title and location
        url: j.url, postedAt: iso(j.published_date), type: j.type?.name || '',
      }));
    },
  },

  bamboohr: {
    label: 'BambooHR',
    pattern: /(?<![a-z0-9-])([a-z0-9-]{1,63})\.bamboohr\.com\/(?:careers|jobs)/i,
    boardUrl: (s) => `https://${s}.bamboohr.com/careers`,
    async fetch(s, company, known) {
      const d = await http(`https://${s}.bamboohr.com/careers/list`);
      const where = (l = {}) => uniq([l.city, l.state, l.country]).join(', ');
      const jobs = (d.result || []).map((j) => ({
        id: `bamboohr:${s}:${j.id}`, title: j.jobOpeningName, company,
        // locationType 1 = remote; BambooHR then lists the country it's remote from.
        location: where(j.atsLocation) || where(j.location), remote: j.locationType === '1' || Boolean(j.isRemote),
        tags: uniq([j.departmentLabel]), description: '', url: `https://${s}.bamboohr.com/careers/${j.id}`,
        postedAt: new Date().toISOString(), type: j.employmentStatusLabel || '',
      }));
      await pool(jobs.filter((j) => !known.has(j.id)).slice(0, DETAIL_LIMIT), 4, async (j) => {
        const o = (await http(`https://${s}.bamboohr.com/careers/${j.id.split(':').pop()}/detail`)).result?.jobOpening || {};
        j.description = desc(o.description);
        if (o.datePosted) j.postedAt = iso(o.datePosted);
        if (o.minimumExperience) j.level = o.minimumExperience;
      });
      return jobs;
    },
  },

  getonbrd: {
    label: 'Get on Board',
    pattern: /getonbrd\.com\/companies\/([a-z0-9-]{1,80})/i,
    boardUrl: (s) => `https://www.getonbrd.com/companies/${s}`,
    async fetch(s, company) {
      const d = await http(`https://www.getonbrd.com/api/v0/companies/${s}/jobs?per_page=100&expand=["company","tags","seniority"]`);
      return (d.data || []).map((j) => normalizeGetOnBoard(j, company));
    },
  },

  workday: {
    label: 'Workday',
    // e.g. https://acme.wd5.myworkdayjobs.com/en-US/External → slug "acme|wd5|External"
    pattern: /(?<![a-z0-9-])([a-z0-9-]{1,63})\.(wd\d{1,3})\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]{1,80})/,
    slugFrom: (m) => `${m[1]}|${m[2]}|${m[3]}`,
    boardUrl: (s) => { const [t, wd, site] = s.split('|'); return `https://${t}.${wd}.myworkdayjobs.com/${site}`; },
    async fetch(s, company, known) {
      const [t, wd, site] = s.split('|');
      const base = `https://${t}.${wd}.myworkdayjobs.com/wday/cxs/${t}/${site}`;
      const list = [];
      for (let offset = 0; offset < 200; offset += 20) {
        const d = await http(`${base}/jobs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
        });
        list.push(...(d.jobPostings || []));
        if (!(d.jobPostings || []).length || list.length >= (d.total || 0)) break;
      }
      const jobs = list.filter((j) => j.externalPath).map((j) => ({
        id: `workday:${s}:${j.externalPath}`, title: j.title, company, location: j.locationsText || '',
        remote: isRemote(j.locationsText, j.remoteType), tags: [], description: '',
        url: `https://${t}.${wd}.myworkdayjobs.com/${site}${j.externalPath}`, postedAt: new Date().toISOString(),
        _path: j.externalPath,
      }));
      await pool(jobs.filter((j) => !known.has(j.id)).slice(0, DETAIL_LIMIT), 4, async (j) => {
        const d = await http(`${base}${j._path}`);
        const info = d.jobPostingInfo || {};
        j.description = desc(info.jobDescription);
        if (info.location) j.location = uniq([info.location, ...(info.additionalLocations || [])]).join(', ');
        if (info.startDate) j.postedAt = iso(info.startDate);
      });
      jobs.forEach((j) => delete j._path);
      return jobs;
    },
  },
};

// Get on Board is also used as a general source (see sources.js), so its parser is shared.
// RSS / Atom feeds aren't found by URL pattern; detectCompany() recognizes them by content.
PLATFORMS.rss = {
  label: 'RSS feed',
  boardUrl: (s) => `https://${s.split('/')[0]}`,
  async fetch(s, name) {
    const xml = await http(rss.feedUrl(s), { text: true, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!rss.isFeed(xml)) throw new Error('not an RSS/Atom feed');
    return rss.feedToJobs(rss.parseFeed(xml), s, name);
  },
};

const GOB_SENIORITY = { 1: 'no experience', 2: 'junior', 3: 'semi senior', 4: 'senior', 5: 'expert' };
function normalizeGetOnBoard(j, fallbackCompany) {
  const a = j.attributes || {};
  const countries = a.countries || [];
  const fullyRemote = a.remote_modality === 'fully_remote';
  // Fully remote with no country list = open worldwide; otherwise restricted to the countries.
  const location = fullyRemote && !countries.length ? 'Remote'
    : countries.join(', ') || a.remote_zone || '';
  return {
    id: `getonbrd:${j.id}`,
    source: 'getonbrd',
    title: a.title,
    company: a.company?.data?.attributes?.name || fallbackCompany || '',
    location,
    remote: Boolean(a.remote) || fullyRemote,
    tags: uniq([a.category_name, ...((a.tags?.data || []).map((t) => t.attributes?.name))]),
    description: desc(a.description, a.functions, a.desirable, a.projects),
    url: j.links?.public_url || `https://www.getonbrd.com/jobs/${j.id}`,
    postedAt: iso(a.published_at),
    salary: a.min_salary ? `US$${a.min_salary}–${a.max_salary}/mo` : '',
    level: GOB_SENIORITY[a.seniority?.data?.id] || a.seniority?.data?.attributes?.name || '',
    type: a.remote_modality ? a.remote_modality.replace(/_/g, ' ') : '',
  };
}

// Job sites without a feed whose job pages carry schema.org JobPosting data (jobpage.js).
// Like RSS, found by content, not URL pattern. Slug = the job list page (host + path + query).
PLATFORMS.jobpage = {
  label: 'Job site',
  boardUrl: (s) => jobpage.pageUrl(s),
  async fetch(s, name, known) {
    const { jobs } = await jobpage.fetchJobPages(s, http, known, { robotsDisallows });
    return jobs;
  },
};

// A list page whose links lead to JobPosting pages? Checks the first job link only.
async function detectJobSite(html, url) {
  const links = jobpage.findJobLinks(html, url);
  if (!links.length) return null;
  try {
    const first = await http(links[0], { text: true, headers: { Accept: 'text/html' } });
    if (!jobpage.findPostings(first).length) return null;
  } catch { return null; }
  return { platform: 'jobpage', slug: jobpage.pageSlug(url), name: jobpage.siteName(html, url) };
}

// Find the platform + account in a URL or a page's HTML.
function findPlatform(text) {
  for (const [platform, p] of Object.entries(PLATFORMS)) {
    if (!p.pattern) continue;
    const m = text.match(p.pattern);
    if (!m) continue;
    const slug = p.slugFrom ? p.slugFrom(m) : (m[1] || m[2]);
    if (slug && !['www', 'api', 'app', 'jobs', 'embed', 'static', 'assets', 'cdn'].includes(slug.toLowerCase())) {
      return { platform, slug: decodeURIComponent(slug) };
    }
  }
  return null;
}

// Distinct platform accounts linked from a page (up to `max`).
function findAllPlatforms(text, max = 5) {
  const seen = new Map();
  for (const [platform, p] of Object.entries(PLATFORMS)) {
    if (!p.pattern) continue;
    for (const m of text.matchAll(new RegExp(p.pattern.source, 'gi'))) {
      const slug = p.slugFrom ? p.slugFrom(m) : (m[1] || m[2]);
      if (!slug || ['www', 'api', 'app', 'jobs', 'embed', 'static', 'assets', 'cdn'].includes(slug.toLowerCase())) continue;
      seen.set(`${platform}:${slug.toLowerCase()}`, { platform, slug: decodeURIComponent(slug) });
      if (seen.size >= max) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

// A page that links to one company board is a careers page. One linking to several is a
// job board listing other companies' jobs, and picking the first link would be a guess.
function pageHit(html) {
  const hits = findAllPlatforms(html.slice(0, 3_000_000));
  if (hits.length > 1) {
    const e = new Error("That page links to several companies' job boards (it looks like a job board, not one company). Paste the company's own careers page, or the board's RSS feed.");
    e.ambiguous = true;
    throw e;
  }
  return hits[0] || null;
}

// Given a careers page URL, work out which platform it uses. Checks the URL itself,
// then the page and a few common careers paths on the same site.
async function detectCompany(input) {
  const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const direct = findPlatform(url);
  if (direct) return direct;
  // Is the URL itself an RSS/Atom feed?
  let first = '';
  try {
    first = await http(url, { text: true, headers: { Accept: 'application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.8' } });
    if (rss.isFeed(first)) return { platform: 'rss', slug: rss.feedSlug(url), name: rss.feedTitle(first) };
    let hit = null;
    try {
      hit = pageHit(first);
    } catch (e) {
      // A job board linking several companies: read its own job pages if they carry job data.
      if (e.ambiguous) return (await detectJobSite(first, url)) || Promise.reject(e);
      throw e;
    }
    if (hit) return hit;
    const site = await detectJobSite(first, url);
    if (site) return site;
  } catch (e) {
    if (e.ambiguous || /https:\/\/|custom ports/.test(e.message)) throw e; // tell the user
  }
  const origin = new URL(url).origin;
  const candidates = uniq([`${origin}/careers`, `${origin}/jobs`, `${origin}/join-us`, `${origin}/en/careers`,
    `${origin}/work-with-us`, `${origin}/trabaja-con-nosotros`]);
  for (const u of candidates) {
    try {
      const html = await http(u, { text: true, headers: { Accept: 'text/html' } });
      const hit = pageHit(html);
      if (hit) return hit;
    } catch (e) {
      if (e.ambiguous) throw e;
      /* otherwise try the next one */
    }
  }
  return null;
}

// Fetch all enabled companies. `known` = ids already stored (skip their detail requests).
async function fetchCompanies(companies, known) {
  const list = companies.filter((c) => c.enabled !== false && PLATFORMS[c.platform]);
  const errors = [];
  const results = await pool(list, 6, async (c) => {
    try {
      const jobs = await PLATFORMS[c.platform].fetch(c.slug, c.name, known);
      for (const j of jobs) j.source = c.platform;
      return jobs;
    } catch (e) {
      errors.push(`${c.name}: ${e.message}`);
      return [];
    }
  });
  return { jobs: results.flat().filter(Boolean), errors };
}

// Detect a careers page / feed URL and test-fetch it. Used by the app ("Add") and by the
// GitHub Action that checks submitted sources (scripts/review-source.js).
async function checkSource(input, { withJobs = false } = {}) {
  try {
    const url = String(input || '').trim().replace(/^http:\/\//i, 'https://');
    if (!url) return { ok: false, error: 'Paste a URL first.' };
    const hit = await detectCompany(url);
    if (!hit) return { ok: false, error: "Couldn't find a supported job board, RSS feed or job listings at that URL." };
    const p = PLATFORMS[hit.platform];
    // Skip per-job detail requests, except on job sites where each job page *is* the job: read a sample.
    const known = hit.platform === 'jobpage' ? { has: () => true, sample: 20 } : { has: () => true };
    const { jobs, errors } = await fetchCompanies([{ ...hit, name: hit.name || hit.slug }], known);
    if (errors.length) {
      const why = errors[0].replace(/^[^:]*: /, '');
      return { ok: false, error: hit.platform === 'rss' ? `Couldn't read that feed (${why}).`
        : hit.platform === 'jobpage' ? `Couldn't read that job site (${why}).`
        : `No public ${p.label} board named "${hit.slug}" (${why}). Check the URL on the company's careers page.` };
    }
    return {
      ok: true, platform: hit.platform, slug: hit.slug, name: hit.name || '', label: p.label,
      jobCount: jobs.length, boardUrl: p.boardUrl(hit.slug), sample: jobs.slice(0, 5).map((j) => `${j.title} · ${j.company}`),
      ...(withJobs ? { jobs } : {}),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { checkSource, findAllPlatforms, PLATFORMS, findPlatform, detectCompany, fetchCompanies, normalizeGetOnBoard, http };
