// Scores a job against a candidate profile (0-100) and explains why.
//
// Weights (sum to 100):
//   tech skills 45 · role/title 25 · experience 15 · soft skills 10 · location 5
// Any "exclude" keyword found in the title or company drops the score to 0.

const { termRegex } = require('./text');
const { scoreLocation } = require('./location');

const WEIGHTS = { skills: 45, title: 25, experience: 15, soft: 10, location: 5 };

// Common alternate spellings. Keys and values are all lowercase.
const ALIASES = {
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  'node.js': ['node', 'nodejs'],
  react: ['react.js', 'reactjs'],
  'react native': ['react-native'],
  vue: ['vue.js', 'vuejs'],
  angular: ['angularjs'],
  'next.js': ['nextjs'],
  postgresql: ['postgres', 'psql'],
  mongodb: ['mongo'],
  kubernetes: ['k8s'],
  golang: ['go'],
  python: ['py'],
  'c#': ['csharp', '.net', 'dotnet'],
  'c++': ['cpp'],
  aws: ['amazon web services'],
  gcp: ['google cloud'],
  azure: ['microsoft azure'],
  'machine learning': ['ml'],
  ci: ['ci/cd'],
  'ci/cd': ['continuous integration'],
  communication: ['communicator', 'communicate'],
  leadership: ['lead', 'leading', 'mentor', 'mentoring'],
  teamwork: ['team player', 'collaboration', 'collaborative', 'collaborate'],
  'problem solving': ['problem-solving', 'problem solver'],
};

const TITLE_STOPWORDS = new Set([
  'senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'mid', 'level', 'remote',
  'the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'in', 'i', 'ii', 'iii', 'iv', '-', '/', '&',
]);

function variants(term) {
  const t = term.toLowerCase().trim();
  const out = new Set([t]);
  for (const a of ALIASES[t] || []) out.add(a);
  // reverse lookup: user typed an alias ("k8s") → also match canonical ("kubernetes")
  for (const [canon, list] of Object.entries(ALIASES)) if (list.includes(t)) out.add(canon);
  return [...out];
}

// Very short terms ("go", "r", "js", "ml") create false positives in prose,
// so they only count when they appear in tags or the title.
function termFound(term, job) {
  for (const v of variants(term)) {
    const re = termRegex(v);
    const short = /^[a-z0-9]{1,2}$/.test(v); // "c++"/"c#" are distinctive enough, "go"/"r" are not
    if (job.tags.some((tag) => re.test(tag)) || re.test(job.title)) return { where: 'title/tags', v };
    if (!short && re.test(job.description)) return { where: 'description', v };
  }
  return null;
}

function scoreSkills(profile, job) {
  const skills = profile.skills || [];
  if (!skills.length) return { value: 0, matched: [], missing: [] };
  const matched = [];
  const missing = [];
  let strong = 0;
  for (const s of skills) {
    const hit = termFound(s, job);
    if (hit) {
      matched.push(s);
      if (hit.where === 'title/tags') strong++;
    } else missing.push(s);
  }
  // Matching ~4 of your skills is a strong signal; you don't need all of them.
  const target = Math.min(skills.length, 4);
  let value = Math.min(1, matched.length / target);
  if (strong > 0) value = Math.min(1, value + 0.1);
  return { value, matched, missing };
}

// "Front-end" / "front end" / "frontend" → "frontend", etc.
// Also maps common Spanish job words to English (many LATAM postings are in Spanish).
const normTitle = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(front|back)[\s-]+end\b/g, '$1end')
  .replace(/\bfull[\s-]+stack\b/g, 'fullstack')
  .replace(/\bdev\s*ops\b/g, 'devops')
  .replace(/\bdesarrollador(?:a|es|\/a|\(a\))?\b/g, 'developer')
  .replace(/\bingenier[oa](?:\/a|\(a\))?\b/g, 'engineer')
  .replace(/\bprogramador(?:a|\/a|\(a\))?\b/g, 'programmer')
  .replace(/\b(?:lider|lead) tecnic[oa]\b/g, 'tech lead')
  .replace(/\bde software\b/g, 'software');

// Words that appear in most tech titles. They count a little, but can't make a match alone.
const GENERIC = new Set(['developer', 'engineer', 'software', 'programmer', 'specialist', 'consultant']);

const tokens = (s) =>
  normTitle(s).split(/[^a-z0-9+#.]+/).filter((w) => w && !TITLE_STOPWORDS.has(w));

function scoreTitle(profile, job) {
  const titles = profile.titles || [];
  if (!titles.length) return { value: 0.5, best: null }; // neutral when not set
  const jobTitle = normTitle(job.title);
  const jobTokens = new Set(tokens(job.title));
  const jobHasGeneric = [...jobTokens].some((w) => GENERIC.has(w));
  let best = { value: 0, title: null };
  for (const t of titles) {
    if (termRegex(normTitle(t)).test(jobTitle)) return { value: 1, best: t };
    const want = tokens(t);
    const specific = want.filter((w) => !GENERIC.has(w));
    const genericHit = want.some((w) => GENERIC.has(w)) && jobHasGeneric ? 0.2 : 0;
    const v = specific.length
      ? (specific.filter((w) => jobTokens.has(w)).length / specific.length) * 0.8 + genericHit
      : genericHit * 2.5; // title was only generic words, e.g. "Software Engineer"
    if (v > best.value) best = { value: Math.min(1, v), title: t };
  }
  return { value: best.value, best: best.title };
}

// Returns the seniority a job asks for as a [minYears, maxYears] range, or null.
function inferExperience(job) {
  const text = `${job.title} ${job.level || ''}`.toLowerCase();
  const yrs = job.description.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs|años|anos)/i);
  if (yrs) {
    const n = parseInt(yrs[1], 10);
    if (n > 0 && n < 25) return { range: [n, n + 4], source: `${n}+ years` };
  }
  if (/\b(intern|internship|werkstudent|working student|trainee)\b/.test(text)) return { range: [0, 1], source: 'internship' };
  if (/\b(junior|jr\.?|entry|graduate)\b/.test(text)) return { range: [0, 2], source: 'junior' };
  if (/\b(principal|staff|director|head of|vp|expert)\b/.test(text)) return { range: [8, 30], source: 'staff+' };
  if (/\b(lead|manager|lider)\b/.test(text)) return { range: [6, 30], source: 'lead' };
  // "Semi Senior"/"SSr" (common in LATAM) must be checked before "Senior".
  if (/\b(mid|midweight|intermediate|semi[\s-]?senior|ssr)\b/.test(text)) return { range: [2, 6], source: 'mid' };
  if (/\b(senior|sr\.?)\b/.test(text)) return { range: [5, 30], source: 'senior' };
  return null;
}

function scoreExperience(profile, job) {
  const years = Number(profile.years);
  const req = inferExperience(job);
  if (!Number.isFinite(years) || !req) return { value: 0.7, req: req?.source || null }; // unknown → mild pass
  const [min, max] = req.range;
  let value;
  if (years >= min && years <= max) value = 1;
  else if (years < min) value = Math.max(0, 1 - (min - years) * 0.3); // 1 yr short → 0.7, 3+ short → ~0
  else value = 0.6; // overqualified: still worth seeing, but lower
  return { value, req: req.source };
}

function scoreSoft(profile, job) {
  const soft = profile.softSkills || [];
  if (!soft.length) return { value: 0.5, matched: [] };
  const matched = soft.filter((s) => termFound(s, job));
  return { value: Math.min(1, matched.length / Math.min(soft.length, 3)), matched };
}

function scoreJob(profile, job) {
  const exclude = (profile.exclude || []).find((x) => termRegex(x).test(`${job.title} ${job.company}`));
  if (exclude) return { score: 0, excluded: exclude, reasons: [`Excluded keyword: ${exclude}`] };

  const s = scoreSkills(profile, job);
  const t = scoreTitle(profile, job);
  const e = scoreExperience(profile, job);
  const so = scoreSoft(profile, job);
  const l = scoreLocation(profile, job);
  // A job you can't legally/practically take isn't a match, however good the skills fit.
  if (l.hardFail) return { score: 0, excluded: 'location', reasons: [l.reason] };

  const score = Math.round(
    s.value * WEIGHTS.skills + t.value * WEIGHTS.title + e.value * WEIGHTS.experience +
    so.value * WEIGHTS.soft + l.value * WEIGHTS.location,
  );

  const reasons = [];
  if (s.matched.length) reasons.push(`Skills: ${s.matched.join(', ')}`);
  if (t.best && t.value >= 0.5) reasons.push(`Role fits "${t.best}"`);
  if (e.req) reasons.push(e.value >= 1 ? `Experience fits (${e.req})` : `Asks for ${e.req}`);
  if (so.matched.length) reasons.push(`Soft skills: ${so.matched.join(', ')}`);
  if (l.reason) reasons.push(l.reason);

  return {
    score,
    matchedSkills: s.matched,
    missingSkills: s.missing,
    matchedSoft: so.matched,
    experience: e.req,
    breakdown: {
      skills: Math.round(s.value * WEIGHTS.skills),
      title: Math.round(t.value * WEIGHTS.title),
      experience: Math.round(e.value * WEIGHTS.experience),
      soft: Math.round(so.value * WEIGHTS.soft),
      location: Math.round(l.value * WEIGHTS.location),
    },
    reasons,
  };
}

module.exports = { scoreJob, inferExperience, WEIGHTS };
