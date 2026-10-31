const test = require('node:test');
const assert = require('node:assert');
const { isValidEmail, profileError, normalizeEmail, isRegistered } = require('../src/main/profile');

test('email is required and must look like an email', () => {
  assert.strictEqual(profileError({ email: '' }), 'Email is required.');
  assert.strictEqual(profileError({ email: '   ' }), 'Email is required.');
  assert.strictEqual(profileError({}), 'Email is required.');
  for (const bad of ['ana', 'ana@', '@x.com', 'ana@x', 'ana @x.com', 'ana@x.c']) assert.ok(profileError({ email: bad }), bad);
  for (const ok of ['ana@x.com', ' Ana.Perez+jobs@mail.example.com.ar ']) assert.strictEqual(profileError({ email: ok }), null, ok);
});

test('emails are trimmed and lowercased; registered means a valid email', () => {
  assert.strictEqual(normalizeEmail('  Ana@X.COM '), 'ana@x.com');
  assert.ok(isValidEmail('a@b.io'));
  assert.ok(!isRegistered({ email: '' }));
  assert.ok(!isRegistered(undefined));
  assert.ok(isRegistered({ email: 'a@b.io' }));
});
