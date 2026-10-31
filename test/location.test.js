const test = require('node:test');
const assert = require('node:assert');
const { scoreLocation, descriptionRestriction } = require('../src/main/location');
const { scoreJob } = require('../src/main/matcher');

const me = { locations: ['Argentina', 'remote', 'worldwide'] };
const job = (o) => ({ title: 'Backend Engineer', location: 'Remote', remote: true, description: '', source: 'remotive', ...o });
const loc = (o, p = me) => scoreLocation(p, job(o));

test('Europe-only job is hidden for someone in Argentina (the Bloomreach case)', () => {
  const r = loc({ location: 'Europe', description: 'You will work remotely first (from Central & Eastern Europe).' });
  assert.ok(r.hardFail);
  const full = scoreJob({ ...me, skills: ['python'] }, job({ title: 'Staff Software Engineer', location: 'Europe', tags: ['python'] }));
  assert.strictEqual(full.score, 0);
});

test('"remote" in my locations does not match every remote job', () => {
  assert.ok(loc({ location: 'USA' }).hardFail);
  assert.ok(loc({ location: 'Germany' }).hardFail);
});

test('worldwide / plain remote jobs are open', () => {
  assert.strictEqual(loc({ location: 'Worldwide' }).value, 1);
  assert.strictEqual(loc({ location: 'Remote' }).value, 1);
  assert.strictEqual(loc({ location: '' }).value, 1);
});

test('regions containing Argentina match', () => {
  for (const l of ['LATAM', 'Latin America', 'Americas', 'South America', 'Buenos Aires', 'Europe, Argentina, Brazil'])
    assert.ok(!loc({ location: l }).hardFail, l);
});

test('plain "Remote" location but description restricts it', () => {
  assert.ok(loc({ description: 'Candidates must be based in the US.' }).hardFail);
  assert.ok(loc({ description: 'You will work remotely (from Central & Eastern Europe).' }).hardFail);
  assert.ok(loc({ description: 'This role is EU only.' }).hardFail);
  assert.ok(loc({ description: 'Senior Engineer (Remote - USA / Canada)' }).hardFail);
  assert.ok(loc({ description: 'Work from anywhere in Canada and USA.' }).hardFail);
  assert.ok(!loc({ description: 'We are remote-first and hire anywhere in the world.' }).hardFail);
  assert.ok(!loc({ description: 'Must be based in Latin America.' }).hardFail);
});

test('employer location in description is not a restriction', () => {
  assert.strictEqual(descriptionRestriction('We are a company based in the US hiring worldwide.'), null);
  assert.strictEqual(descriptionRestriction('Our HQ is located in Berlin.'), null);
  assert.strictEqual(descriptionRestriction('Work remotely from anywhere in the world.'), null);
});

test('region in title restricts a plain "Remote" job', () => {
  assert.ok(loc({ title: 'Sales Engineering Manager - Mainland Europe' }).hardFail);
});

test('unclear locations are kept but scored lower', () => {
  const r = loc({ location: 'US, UK, Canada, Australia + 35 other countries' });
  assert.ok(!r.hardFail);
  assert.strictEqual(r.value, 0.5);
});

test('Arbeitnow "Homeoffice" means Germany', () => {
  assert.ok(loc({ location: 'Homeoffice', source: 'arbeitnow' }).hardFail);
});

test('no locations set → nothing is hidden', () => {
  assert.ok(!loc({ location: 'USA' }, { locations: [] }).hardFail);
  assert.ok(!loc({ location: 'USA' }, { locations: ['remote'] }).hardFail);
});
