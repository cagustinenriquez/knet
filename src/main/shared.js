// Sources suggested by users and approved by an admin. The list lives in the GitHub repo
// (sources/approved.json, written by .github/workflows/source-review.yml) and every app
// downloads it on each check.

const { PLATFORMS } = require('./ats');

const REPO = 'cagustinenriquez/knet';
const BRANCH = 'dev';
const APPROVED_URL = process.env.KNET_APPROVED_URL || `https://raw.githubusercontent.com/${REPO}/${BRANCH}/sources/approved.json`;

const key = (c) => `${c.platform}:${c.slug}`.toLowerCase();

// The file is public and edited through a workflow, so treat it as untrusted input.
function validEntries(data) {
  const list = Array.isArray(data?.sources) ? data.sources : [];
  return list.filter((s) =>
    s && PLATFORMS[s.platform] &&
    typeof s.slug === 'string' && s.slug.length > 0 && s.slug.length <= 300 && !/[\s:]/.test(s.slug) &&
    typeof s.name === 'string' && s.name.trim().length > 0 && s.name.length <= 100)
    .map((s) => ({ name: s.name.trim(), platform: s.platform, slug: s.slug }));
}

async function fetchApproved(http) {
  const data = await http(`${APPROVED_URL}?t=${Date.now()}`); // skip stale caches
  // A malformed file must not look like "everything was revoked".
  if (!Array.isArray(data?.sources)) throw new Error('approved list is malformed');
  return validEntries(data);
}

// Bring the user's list in line with the approved list. Mutates settings.
// - Adds approved sources the user doesn't have (unless they removed them).
// - Revokes: shared sources no longer approved are removed. If the user added it
//   themselves first, it stays, just no longer marked shared.
// Returns { added, revoked: [keys] }.
function syncApproved(settings, approved) {
  const removed = new Set((settings.removedShared || []).map((k) => k.toLowerCase()));
  const approvedKeys = new Set(approved.map(key));
  const revoked = [];
  settings.companies = settings.companies.filter((c) => {
    if (!c.shared || approvedKeys.has(key(c))) return true;
    if (c.custom) { delete c.shared; return true; }
    revoked.push(`${c.platform}:${c.slug}`);
    return false;
  });
  const byKey = new Map(settings.companies.map((c) => [key(c), c]));
  let added = 0;
  for (const s of approved) {
    const mine = byKey.get(key(s));
    if (mine) { mine.shared = true; continue; } // e.g. the user's own suggestion got approved
    if (removed.has(key(s))) continue;
    settings.companies.push({ ...s, enabled: true, shared: true });
    added++;
  }
  return { added, revoked };
}

// Pre-filled GitHub issue (form: .github/ISSUE_TEMPLATE/new-source.yml).
function suggestUrl({ url, name }) {
  const q = new URLSearchParams({ template: 'new-source.yml', title: `Source: ${name}`, url, name });
  return `https://github.com/${REPO}/issues/new?${q}`;
}

module.exports = { APPROVED_URL, validEntries, fetchApproved, syncApproved, suggestUrl, key };
