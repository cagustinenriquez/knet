// Decides whether a job is open to where the candidate can work from.
//
// A job counts as "open" when its location is worldwide/anywhere (or just "Remote"
// with no region mentioned anywhere). Otherwise it's restricted to the places it
// names, and the candidate must be in one of them.

const { termRegex } = require('./text');

const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Words in a profile that mean "I want remote / open-to-anywhere jobs", not a place.
const ANYWHERE_WORDS = ['remote', 'worldwide', 'anywhere', 'global', 'everywhere'];

// Job location text that names no place at all.
const OPEN_LOCATION = /^(?:remote(?: job| only| first)?|100% remote|fully remote|worldwide|anywhere|global|work from anywhere|remote[\s,/-]+(?:worldwide|anywhere|global))?$/;
const WORLDWIDE = /\b(worldwide|anywhere in the world|work from anywhere|global(?:ly)?)\b/;

// Regions each country belongs to, so "Argentina" matches a job open to "LATAM".
const LATAM = ['latam', 'latin america', 'south america', 'americas', 'lat am', 'south american'];
const CENTRAL_AM = ['latam', 'latin america', 'central america', 'americas'];
const NORTH_AM = ['north america', 'americas'];
const EUROPE = ['europe', 'eu', 'emea', 'european union', 'eea'];
const APAC = ['apac', 'asia', 'asia pacific'];

const COUNTRY_REGIONS = {
  argentina: [...LATAM, 'buenos aires', 'cordoba', 'rosario', 'mendoza'],
  brazil: [...LATAM, 'brasil', 'sao paulo', 'rio de janeiro'],
  chile: [...LATAM, 'santiago'],
  colombia: [...LATAM, 'bogota', 'medellin'],
  peru: [...LATAM, 'lima'],
  uruguay: [...LATAM, 'montevideo'],
  paraguay: LATAM,
  bolivia: LATAM,
  ecuador: LATAM,
  venezuela: LATAM,
  mexico: [...CENTRAL_AM, ...NORTH_AM, 'cdmx', 'ciudad de mexico', 'mexico city'],
  'costa rica': CENTRAL_AM,
  guatemala: CENTRAL_AM,
  panama: CENTRAL_AM,
  usa: ['us', 'u.s.', 'united states', ...NORTH_AM],
  canada: NORTH_AM,
  'united kingdom': ['uk', 'great britain', 'england', 'london', ...EUROPE.filter((r) => r !== 'eu' && r !== 'european union')],
  germany: [...EUROPE, 'deutschland', 'berlin', 'munich', 'hamburg', 'dach'],
  france: [...EUROPE, 'paris'],
  spain: [...EUROPE, 'espana', 'madrid', 'barcelona'],
  portugal: [...EUROPE, 'lisbon'],
  italy: [...EUROPE, 'italia'],
  netherlands: [...EUROPE, 'amsterdam'],
  poland: [...EUROPE, 'cee', 'eastern europe', 'central & eastern europe'],
  ireland: [...EUROPE, 'dublin'],
  india: [...APAC, 'bangalore', 'bengaluru'],
  philippines: [...APAC, 'manila'],
  australia: [...APAC, 'anz'],
};
const ALIAS_COUNTRY = { 'united states': 'usa', us: 'usa', 'u.s.': 'usa', uk: 'united kingdom', brasil: 'brazil', 'méxico': 'mexico' };

// Places we can recognise in job text. Used to tell "restricted to somewhere" apart from noise.
const KNOWN_PLACES = [...new Set([
  ...Object.keys(COUNTRY_REGIONS),
  ...Object.values(COUNTRY_REGIONS).flat(),
  'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'belgium', 'romania', 'ukraine',
  'czech', 'hungary', 'greece', 'turkey', 'israel', 'singapore', 'japan', 'south korea', 'china',
  'new zealand', 'south africa', 'nigeria', 'kenya', 'egypt', 'saudi arabia', 'uae', 'pakistan', 'vietnam',
])].filter((p) => p.length > 2 || ['us', 'uk', 'eu'].includes(p));

// Expand the candidate's places: "Argentina" → argentina, latam, americas, buenos aires, ...
function candidatePlaces(locations = []) {
  const places = new Set();
  let anywhere = false;
  for (const raw of locations) {
    const l = norm(raw).trim();
    if (!l) continue;
    if (ANYWHERE_WORDS.includes(l)) { anywhere = true; continue; }
    const country = ALIAS_COUNTRY[l] || l;
    places.add(country);
    if (country !== l) places.add(l);
    for (const r of COUNTRY_REGIONS[country] || []) places.add(r);
  }
  return { places, anywhere };
}

function placesIn(text) {
  return KNOWN_PLACES.filter((p) => termRegex(p).test(text));
}

// Phrases in a description that restrict where you can live, e.g.
// "work remotely (from Central & Eastern Europe)", "must be based in the US", "EU only".
const RESTRICTION_PATTERNS = [
  /\b(?:based|located|resid(?:e|es|ing|ent)|living|live|work(?:ing)?\s+remotely|remote(?:ly)?(?:\s+first)?)\s*\(?\s*(?:in|from|within|out of)\s+(?:the\s+)?([^.;:\n)]{2,60})/g,
  /\bauthori[sz]ed to work in\s+(?:the\s+)?([^.;:\n)]{2,40})/g,
  /\banywhere in\s+(?:the\s+)?([^.;:\n)]{2,40})/g, // "work from anywhere in Canada and USA"
  /\bremote\s*[-–(]\s*([^.;:\n)]{2,40})/g, // "(Remote - USA / Canada)"
  /\b([a-z.]{2,6}|europe|latam)[\s-]only\b/g,
];
// Skip "we are based in…", "our company is located in…": that's the employer, not you.
const EMPLOYER_SUBJECT = /\b(we|we're|we are|our|company|headquarter\w*|hq|office\w*|team is)\b[^.]{0,25}$/;

function descriptionRestriction(description) {
  const text = norm(description);
  for (const re of RESTRICTION_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (EMPLOYER_SUBJECT.test(before)) continue;
      if (WORLDWIDE.test(m[1])) continue;
      const found = placesIn(m[1]);
      if (found.length) return { places: found, phrase: m[0].trim().slice(0, 80) };
    }
  }
  return null;
}

// Where is this job open to?
function jobPlaces(job) {
  const loc = norm(job.location).trim();
  if (/other countries|multiple locations|various locations/.test(loc)) return { kind: 'unclear' };
  if (WORLDWIDE.test(loc)) return { kind: 'open' };
  if (OPEN_LOCATION.test(loc) || loc === 'homeoffice' || loc === 'home office') {
    // "Senior Engineer - Mainland Europe", "Backend Developer (US)"
    const inTitle = placesIn(norm(job.title)).filter((p) => p !== 'us' || /\b(US)\b/.test(job.title));
    if (inTitle.length) return { kind: 'restricted', places: inTitle, label: inTitle.join(', ') };
    const r = descriptionRestriction(job.description || '');
    if (r) return { kind: 'restricted', places: r.places, label: `"${r.phrase}"` };
    // Arbeitnow is a German board: an unspecific location there means Germany.
    if (job.source === 'arbeitnow') return { kind: 'restricted', places: ['germany'], label: 'Germany' };
    return { kind: 'open' };
  }
  return { kind: 'restricted', places: placesIn(loc), raw: loc, label: job.location };
}

// Returns { value 0..1, hardFail, reason }.
function scoreLocation(profile, job) {
  if (profile.remoteOnly && !job.remote) return { value: 0, hardFail: true, reason: 'Not remote' };
  const { places, anywhere } = candidatePlaces(profile.locations);
  const where = jobPlaces(job);

  if (where.kind === 'open') return { value: job.remote || !anywhere ? 1 : 0.7, reason: job.remote ? 'Open worldwide' : null };
  if (where.kind === 'unclear') return { value: 0.5, reason: `Location unclear: ${job.location}` };
  if (!places.size) return { value: 0.5, reason: null }; // we don't know where the candidate is

  const fits = where.places.some((p) => places.has(p)) ||
    (where.raw && [...places].some((p) => termRegex(p).test(where.raw)));
  if (fits) return { value: 1, reason: `Open to your location (${where.label})` };
  return { value: 0, hardFail: true, reason: `Location: only ${where.label}` };
}

module.exports = { scoreLocation, candidatePlaces, jobPlaces, descriptionRestriction };
