// Profile validation. Email is required: it identifies the profile (and later, an account).

// Practical check, not full RFC 5322: something@domain.tld, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 254 && EMAIL.test(e);
}

// Returns an error message, or null if the profile can be saved.
function profileError(profile) {
  if (!normalizeEmail(profile.email)) return 'Email is required.';
  if (!isValidEmail(profile.email)) return 'That email doesn\'t look right. Use the format name@example.com.';
  return null;
}

const isRegistered = (profile) => isValidEmail(profile?.email);

module.exports = { normalizeEmail, isValidEmail, profileError, isRegistered };
