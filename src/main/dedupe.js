// Duplicate detection: the same job often shows up on several sources (the company's own
// board, job boards, aggregators), each formatting it a little differently:
//   "Catawiki"      · "Lead Security Engineer"                      · "Amsterdam, Netherlands"
//   "Catawiki"      · "Lead Security Engineer | Relocation Offered" · "Amsterdam"
//   "Catawiki B.V." · "Lead Security Engineer (m/f/d)"              · "Amsterdam, NL"
// Two jobs are the same when the company matches after cleanup, the titles match after
// cleanup (or contain the same words in another order), and the locations don't conflict.
// It errs on the side of keeping jobs apart: "Senior" vs "Junior", Berlin vs London, or one
// role posted in two cities are different jobs.

const fold = (s = '') => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9+#]+/g, ' ').trim().split(' ').filter(Boolean);

// Legal-form endings: "Acme Inc.", "Catawiki B.V.", "Globant S.A. de C.V.".
const LEGAL = new Set(['inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'gmbh', 'ag', 'kg', 'bv', 'nv', 'sa', 'sas',
  'sarl', 'srl', 'spa', 'sl', 'slu', 'sapi', 'cv', 'de', 'plc', 'corp', 'corporation', 'co', 'company', 'oy', 'ab', 'as',
  'aps', 'kk', 'pty', 'pte', 'se', 'ug', 'lda', 'ltda', 'eirl']);

function normCompany(name) {
  const w = words(String(name).replace(/\./g, '')); // "B.V." → "bv"
  if (w[0] === 'the' && w.length > 1) w.shift();
  while (w.length > 1 && LEGAL.has(w[w.length - 1])) w.pop();
  return w.join(' ');
}

// Bits of a title that aren't part of the role: gender tags, work arrangements, perks.
const GENDER = /\(\s*(?:all genders?|gn|[mwfdhxi*](?:\s*[/|,]\s*[mwfdhxi*]){1,3})\s*\)|(?<![a-z])[mwf]\s*\/\s*[wfm]\s*\/\s*[dxi](?![a-z])|(?<![a-z])[hf]\s*\/\s*[fh](?![a-z])/gi;
const NOISE = /^(?:remote(?:ly)?(?: first| only| friendly| ok)?|100% remote|fully remote|hybrid|on-?site|in office|relocation.*|visa.*|full[- ]?time|part[- ]?time|contract(?:or)?|freelance|temporary|temp|permanent|urgent(?:ly)?|new|hiring|immediate start|anywhere|worldwide|global|emea|latam|apac|europe|eu|us|usa|uk|americas|[a-z .]{2,30} based|based in .*)$/;
const ABBREV = { sr: 'senior', snr: 'senior', jr: 'junior', jnr: 'junior', mgr: 'manager', eng: 'engineer', engr: 'engineer', dev: 'developer' };

function normTitle(title, location = '') {
  const loc = fold(location);
  const isNoise = (part) => {
    const p = fold(part).replace(/[^a-z0-9%+# .-]+/g, ' ').trim();
    return !p || NOISE.test(p) || (p.length > 2 && loc.includes(p));
  };
  let t = String(title).replace(GENDER, ' ');
  t = t.replace(/[([]([^)\]]*)[)\]]/g, (m, inner) => (isNoise(inner) ? ' ' : ` ${inner} `)); // "(Remote)", "[Berlin]"
  const parts = t.split(/\s+[-–—:|]\s+/); // "Role - Remote", "Role – Berlin", "Role | Relocation Offered"
  t = [parts[0], ...parts.slice(1).filter((p) => !isNoise(p))].join(' ');
  return words(t).map((w) => ABBREV[w] || w).join(' ');
}

// Place words in a location ("Amsterdam, NL" → amsterdam, netherlands). Empty = no place named.
const COUNTRY_CODES = { nl: 'netherlands', uk: 'united kingdom', gb: 'united kingdom', us: 'united states', usa: 'united states',
  de: 'germany', fr: 'france', es: 'spain', pt: 'portugal', it: 'italy', ie: 'ireland', ar: 'argentina', br: 'brazil',
  mx: 'mexico', ca: 'canada', jp: 'japan', ch: 'switzerland', at: 'austria', be: 'belgium', pl: 'poland', se: 'sweden' };
const NOT_PLACES = new Set(['remote', 'hybrid', 'onsite', 'on', 'site', 'office', 'anywhere', 'worldwide', 'global', 'and', 'or',
  'in', 'the', 'of', 'only', 'fully', 'first', 'friendly', 'based', 'time', 'zone', 'timezone', 'from', 'home', 'work', 'flexible']);

function places(location) {
  const out = new Set();
  for (const part of fold(location).split(/[,;/|()·•\-–—]+/)) {
    const p = part.replace(/[^a-z0-9 ]+/g, ' ').trim().replace(/\s+/g, ' ');
    if (!p) continue;
    if (COUNTRY_CODES[p]) { out.add(COUNTRY_CODES[p]); continue; }
    const kept = p.split(' ').filter((w) => !NOT_PLACES.has(w)).join(' ');
    if (kept.length > 1) out.add(kept);
  }
  return out;
}

// Do two locations allow the same job? Yes if either names no place, or if one names a single
// place the other includes ("Amsterdam" vs "Amsterdam, Netherlands"). When both are specific
// ("Cali, Colombia" vs "Medellín, Colombia") the first place (the city) must match: companies
// post the same role once per city, and those are separate postings.
const near = (p, q) => p === q || p.includes(q) || q.includes(p); // "new york city" ~ "new york"
function locationsCompatible(a, b) {
  const pa = [...places(a)];
  const pb = [...places(b)];
  if (!pa.length || !pb.length) return true;
  if (pa.length === 1) return pb.some((q) => near(pa[0], q));
  if (pb.length === 1) return pa.some((p) => near(p, pb[0]));
  return near(pa[0], pb[0]);
}

function keyOf(j) {
  const title = normTitle(j.title, j.location);
  const tokens = new Set(title.split(' ').filter(Boolean));
  return { company: normCompany(j.company), title, tokens };
}

// Filler words that don't change the role ("Head of Data" ~ "Data Head" isn't real, but
// "Engineer, Data and ML" ~ "Data & ML Engineer" is).
const FILLER = new Set(['and', 'of', 'the', 'for', 'with', 'a', 'an', 'in', 'to', 'at']);

function titlesMatch(ka, kb) {
  if (ka.title === kb.title) return true;
  // Same words in another order ("Senior Software Engineer, Backend" ~ "Senior Backend Software
  // Engineer"). Any different word means a different job ("dominante Back" vs "dominante Front").
  const a = [...ka.tokens].filter((w) => !FILLER.has(w));
  const b = new Set([...kb.tokens].filter((w) => !FILLER.has(w)));
  return a.length >= 2 && a.length === b.size && a.every((w) => b.has(w));
}

function sameJob(a, b) {
  const ka = keyOf(a);
  const kb = keyOf(b);
  return !!ka.company && ka.company === kb.company && titlesMatch(ka, kb) && locationsCompatible(a.location, b.location);
}

// Loose key for counting overlap between whole sources (audit): company + cleaned title.
const looseKey = (j) => `${normCompany(j.company)}|${normTitle(j.title, j.location)}`;

// Which copy to keep when the same job arrives from several sources in one check:
// jobs posted on knet, then the company's own board, then job boards, then aggregators.
const BOARDS = new Set(['remotive', 'remoteok', 'arbeitnow', 'jobicy', 'getonbrd']);
function sourceRank(source) {
  if (source === 'posted') return 4;
  if (source === 'rss' || source === 'jobpage') return 1;
  if (BOARDS.has(source)) return 2;
  return 3; // company hiring platforms (greenhouse, lever, ...)
}

// Index of known jobs by company, for quick lookups while merging a check's results.
class DupIndex {
  constructor(jobs = []) {
    this.byCompany = new Map();
    for (const j of jobs) this.add(j);
  }

  add(j) {
    const k = keyOf(j);
    if (!k.company) return;
    if (!this.byCompany.has(k.company)) this.byCompany.set(k.company, []);
    this.byCompany.get(k.company).push({ job: j, key: k });
  }

  // The known job this one duplicates, or null. Never matches a job with the same id.
  find(j) {
    const k = keyOf(j);
    for (const e of this.byCompany.get(k.company) || []) {
      if (e.job.id !== j.id && titlesMatch(k, e.key) && locationsCompatible(j.location, e.job.location)) return e.job;
    }
    return null;
  }
}

module.exports = { DupIndex, sameJob, looseKey, normCompany, normTitle, places, locationsCompatible, sourceRank };
