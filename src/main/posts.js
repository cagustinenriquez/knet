// Jobs posted directly on knet. Posting happens through a GitHub issue form
// (.github/ISSUE_TEMPLATE/post-job.yml); the review workflow publishes passing posts to
// jobs/posted.json, which every app reads as the "Posted on knet" source.

const REPO = 'cagustinenriquez/knet';
const POSTED_URL = process.env.KNET_POSTED_URL || `https://raw.githubusercontent.com/${REPO}/dev/jobs/posted.json`;
const LIFETIME_DAYS = 30;

// Issue form fields, in form order: [id, heading on the rendered issue].
const FIELDS = [
  ['job_title', 'Job title'],
  ['company', 'Company'],
  ['location', 'Location'],
  ['workplace', 'Workplace'],
  ['type', 'Employment type'],
  ['level', 'Seniority'],
  ['salary', 'Salary'],
  ['skills', 'Skills / tech stack'],
  ['apply', 'How to apply'],
  ['description', 'Description'],
  ['confirm', 'Confirmation'],
];

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

// "jobs@acme.com" → "mailto:jobs@acme.com"; URLs pass through.
function applyLink(v) {
  const s = String(v || '').trim();
  if (/^[^\s@/:]+@[^\s@/]+\.[a-z]{2,}$/i.test(s)) return `mailto:${s}`;
  return s.replace(/^http:\/\//i, 'https://');
}

// Rendered issue body ("### Heading\n\nvalue" sections) → post fields.
function parseJobIssue(body = '') {
  const text = String(body).replace(/\r\n/g, '\n');
  // Find each known heading; a field's value runs to the next known heading, so "###"
  // inside a description doesn't break parsing.
  const at = FIELDS.map(([id, h]) => {
    const m = text.match(new RegExp(`^###\\s+${h.replace(/[/()]/g, '\\$&')}[^\\n]*$`, 'm'));
    return m ? { id, start: m.index, end: m.index + m[0].length } : null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);
  const raw = {};
  at.forEach((f, i) => {
    const v = text.slice(f.end, at[i + 1]?.start ?? text.length).trim();
    raw[f.id] = v === '_No response_' ? '' : v;
  });
  return {
    title: clean(raw.job_title, 200),
    company: clean(raw.company, 200),
    location: clean(raw.location, 200),
    workplace: clean(raw.workplace, 40),
    type: clean(raw.type, 40),
    level: clean(raw.level, 40),
    salary: clean(raw.salary, 200),
    tags: clean(raw.skills, 1000).split(/[,\n]/).map((t) => t.trim()).filter((t) => t && t.length <= 40).slice(0, 15),
    apply: applyLink(clean(raw.apply, 500)),
    description: clean(raw.description, 20000),
    confirmed: /-\s*\[x\]/i.test(raw.confirm || ''),
  };
}

// Post → entry for jobs/posted.json (the shared job shape plus bookkeeping).
function toEntry(post, { issue, poster, now = new Date(), postedAt }) {
  const first = postedAt || now.toISOString();
  const remote = /remote/i.test(post.workplace) || /\bremot[eo]\b/i.test(post.location);
  return {
    id: `posted:${issue}`,
    title: post.title, company: post.company,
    location: remote && !/remote/i.test(post.location) ? `Remote - ${post.location}` : post.location,
    remote, type: post.type, level: post.level, salary: post.salary, tags: post.tags,
    description: post.description, url: post.apply,
    postedAt: first,
    expiresAt: new Date(new Date(first).getTime() + LIFETIME_DAYS * 86400000).toISOString(),
    issue, poster,
  };
}

const str = (v, max) => typeof v === 'string' && v.length <= max;

// jobs/posted.json is public and written by a workflow: validate before showing anything.
function validPosts(data, now = Date.now()) {
  const list = Array.isArray(data?.jobs) ? data.jobs : [];
  return list.filter((j) => j &&
    /^posted:\d{1,9}$/.test(j.id) && str(j.title, 200) && j.title && str(j.company, 200) && j.company &&
    str(j.location, 220) && str(j.description, 20000) &&
    (/^https:\/\/[^\s]+$/i.test(j.url) || /^mailto:[^\s@]+@[^\s@]+$/i.test(j.url)) && j.url.length <= 500 &&
    !Number.isNaN(Date.parse(j.postedAt)) && Date.parse(j.expiresAt) > now)
    .map((j) => ({
      id: j.id, source: 'posted', title: j.title, company: j.company, location: j.location, remote: !!j.remote,
      type: str(j.type, 40) ? j.type : '', level: str(j.level, 40) ? j.level : '', salary: str(j.salary, 200) ? j.salary : '',
      tags: Array.isArray(j.tags) ? j.tags.filter((t) => str(t, 40)).slice(0, 15) : [],
      description: j.description, format: 'markdown', url: j.url, postedAt: new Date(j.postedAt).toISOString(),
      issue: Number.isInteger(j.issue) ? j.issue : null,
      issueUrl: Number.isInteger(j.issue) ? `https://github.com/${REPO}/issues/${j.issue}` : '',
      verified: j.verified === true,
    }));
}

// Pre-filled GitHub issue for a post written in the app. Very long URLs get rejected, so
// a long description is left out (the app copies it to the clipboard instead).
function postFormUrl(post, { withDescription = true } = {}) {
  const q = new URLSearchParams({ template: 'post-job.yml', title: `Job: ${post.title} at ${post.company}` });
  const values = {
    job_title: post.title, company: post.company, location: post.location, workplace: post.workplace, type: post.type,
    level: post.level, salary: post.salary, skills: (post.tags || []).join(', '), apply: post.apply,
    ...(withDescription ? { description: post.description } : {}),
  };
  for (const [k, v] of Object.entries(values)) if (v) q.set(k, v);
  return `https://github.com/${REPO}/issues/new?${q}`;
}

// Pre-filled "Report a job post" issue.
function reportFormUrl({ issue, title, company }) {
  const q = new URLSearchParams({ template: 'report-job.yml', title: `Report: #${issue} ${title} at ${company}`.slice(0, 200), post: `#${issue}` });
  return `https://github.com/${REPO}/issues/new?${q}`;
}

module.exports = { reportFormUrl, POSTED_URL, LIFETIME_DAYS, FIELDS, parseJobIssue, toEntry, validPosts, postFormUrl, applyLink };
