// Tests for version comparison and update checking logic.
const assert = require('assert');
const test = require('node:test');

// Inline the helper functions from main.js (they are not exported).
function parseVersion(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(remote, current) {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

test('parseVersion extracts semver', () => {
  assert.deepStrictEqual(parseVersion('0.1.0'), [0, 1, 0]);
  assert.deepStrictEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepStrictEqual(parseVersion('10.0.1'), [10, 0, 1]);
});

test('parseVersion rejects non-semver', () => {
  assert.strictEqual(parseVersion('1.2'), null);
  assert.strictEqual(parseVersion('1.2.3.4'), null);
  assert.strictEqual(parseVersion('abc'), null);
  assert.strictEqual(parseVersion(''), null);
});

test('isNewer: higher patch', () => {
  assert.strictEqual(isNewer('0.1.1', '0.1.0'), true);
});

test('isNewer: higher minor', () => {
  assert.strictEqual(isNewer('0.2.0', '0.1.5'), true);
});

test('isNewer: higher major', () => {
  assert.strictEqual(isNewer('1.0.0', '0.9.9'), true);
});

test('isNewer: same version is not newer', () => {
  assert.strictEqual(isNewer('0.1.0', '0.1.0'), false);
});

test('isNewer: older is not newer', () => {
  assert.strictEqual(isNewer('0.1.0', '0.1.1'), false);
});

test('isNewer: ignores v prefix', () => {
  assert.strictEqual(isNewer('v0.2.0', '0.1.0'), true);
});

test('isNewer: rejects bad input', () => {
  assert.strictEqual(isNewer('bad', '0.1.0'), false);
  assert.strictEqual(isNewer('0.2.0', 'bad'), false);
});
