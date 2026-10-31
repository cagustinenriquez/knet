// Profile validation. Email is required: it identifies the profile (and later, an account).

// Practical check, not full RFC 5322: something@domain.tld, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Invisible characters that sneak in from copy/paste or input methods.
const INVISIBLE = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;

// NFKC turns lookalikes typed by some keyboards and input methods into plain ASCII
// (full-width "＠" → "@", "ｇｍａｉｌ" → "gmail"); "。" (ideographic full stop) → ".".
function normalizeEmail(email) {
  return String(email ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(/[\u3002\uff61]/g, '.').trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 254 && EMAIL.test(e) && !/\.\.|\.$|@\.|\.@/.test(e);
}

// Returns an error message, or null if the profile can be saved.
function profileError(profile) {
  if (!normalizeEmail(profile.email)) return 'Email is required.';
  if (!isValidEmail(profile.email)) {
    // Point at the problem when it's a character that looks fine but isn't.
    const e = normalizeEmail(profile.email);
    if (!e.includes('@')) return 'That doesn\'t look like an email (no "@"). Use the format name@example.com.';
    if (/\s/.test(e)) return 'Emails can\'t contain spaces.';
    const odd = [...e].find((c) => !/[a-z0-9.@_+\-']/.test(c));
    if (odd) return `That email has an unusual character: "${odd}" (U+${odd.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}). Try typing it again.`;
    return 'That email doesn\'t look right. Use the format name@example.com.';
  }
  return null;
}

const isRegistered = (profile) => isValidEmail(profile?.email);

module.exports = { normalizeEmail, isValidEmail, profileError, isRegistered };
