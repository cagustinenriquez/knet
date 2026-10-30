const test = require('node:test');
const assert = require('node:assert');
const { scoreJob, inferExperience } = require('../src/main/matcher');
const { stripHtml } = require('../src/main/text');

const job = (o = {}) => ({
  title: 'Senior Frontend Engineer', company: 'Acme', location: 'Worldwide', remote: true,
  tags: ['react', 'typescript'], description: 'We use React, TypeScript and Node.js. 5+ years experience. Strong communication.',
  ...o,
});

const profile = {
  titles: ['Frontend Developer'], skills: ['React', 'TypeScript', 'Node.js', 'GraphQL'],
  softSkills: ['communication'], years: 6, locations: [], remoteOnly: false, exclude: [],
};

test('good fit scores high and explains why', () => {
  const r = scoreJob(profile, job());
  assert.ok(r.score >= 80, `score ${r.score}`);
  assert.deepStrictEqual(r.matchedSkills, ['React', 'TypeScript', 'Node.js']);
  assert.deepStrictEqual(r.missingSkills, ['GraphQL']);
  assert.deepStrictEqual(r.matchedSoft, ['communication']);
});

test('unrelated job scores low', () => {
  const r = scoreJob(profile, job({ title: 'Account Executive', tags: ['sales'], description: 'Close deals. 2 years in SaaS sales.' }));
  assert.ok(r.score < 35, `score ${r.score}`);
});

test('"java" does not match "javascript"', () => {
  const r = scoreJob({ ...profile, skills: ['Java'] }, job({ tags: [], description: 'JavaScript only' }));
  assert.deepStrictEqual(r.matchedSkills, []);
});

test('aliases match: k8s ↔ kubernetes, postgres ↔ postgresql', () => {
  const r = scoreJob({ ...profile, skills: ['Kubernetes', 'Postgres'] }, job({ tags: [], description: 'Deploy on k8s with PostgreSQL.' }));
  assert.deepStrictEqual(r.matchedSkills, ['Kubernetes', 'Postgres']);
});

test('short skills like "Go" only count in title/tags, not prose', () => {
  const p = { ...profile, skills: ['Go'] };
  assert.deepStrictEqual(scoreJob(p, job({ tags: [], description: 'Ready to go live fast.' })).matchedSkills, []);
  assert.deepStrictEqual(scoreJob(p, job({ tags: ['go'] })).matchedSkills, ['Go']);
});

test('C++ and C# match exactly', () => {
  const r = scoreJob({ ...profile, skills: ['C++', 'C#'] }, job({ tags: [], description: 'Experience with C++ and C# required.' }));
  assert.deepStrictEqual(r.matchedSkills, ['C++', 'C#']);
});

test('exclude keyword hides the job', () => {
  const r = scoreJob({ ...profile, exclude: ['Acme'] }, job());
  assert.strictEqual(r.score, 0);
});

test('remote-only drops on-site jobs', () => {
  assert.strictEqual(scoreJob({ ...profile, remoteOnly: true }, job({ remote: false, location: 'Berlin' })).score, 0);
});

test('experience inference', () => {
  assert.deepStrictEqual(inferExperience(job({ description: 'Need 3+ years' })).range, [3, 7]);
  assert.strictEqual(inferExperience(job({ title: 'Junior Dev', description: '' })).source, 'junior');
  assert.strictEqual(inferExperience(job({ title: 'Developer', description: '' })), null);
});

test('junior candidate is penalized for staff role', () => {
  const junior = scoreJob({ ...profile, years: 1 }, job({ title: 'Staff Frontend Engineer', description: 'React TypeScript' }));
  const senior = scoreJob({ ...profile, years: 9 }, job({ title: 'Staff Frontend Engineer', description: 'React TypeScript' }));
  assert.ok(senior.score > junior.score);
});

test('stripHtml', () => {
  assert.strictEqual(stripHtml('<p>Hi &amp; <b>bye</b></p><script>x()</script>'), 'Hi & bye');
  assert.strictEqual(stripHtml('Lemon.io â\u0080\u0094 the café Ã©'), 'Lemon.io — the café é');
});
