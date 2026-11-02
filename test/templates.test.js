const test = require('node:test');
const assert = require('node:assert');
const tpl = require('../src/renderer/templates');

const job = {
  title: 'Senior React Developer', company: 'Catawiki', location: 'Amsterdam', url: 'https://example.com/j/1',
  tags: ['React', 'GraphQL', 'react'], match: { matchedSkills: ['react', 'typescript', 'node.js'] },
};
const profile = { name: 'Ana', email: 'ana@example.com', titles: ['Frontend Developer'], years: 6, skills: ['react', 'typescript'] };
const NOW = new Date('2026-11-02T12:00:00Z');

test('listJoin', () => {
  assert.strictEqual(tpl.listJoin([]), '');
  assert.strictEqual(tpl.listJoin(['a']), 'a');
  assert.strictEqual(tpl.listJoin(['a', 'b', 'c']), 'a, b and c');
});

test('variables from the job, the profile and the user\'s fields', () => {
  const v = tpl.variables(job, profile, [{ key: 'portfolio', value: ' https://ana.dev ' }, { key: 'company', value: 'hijack' }], NOW);
  assert.strictEqual(v.company, 'Catawiki'); // a field can't override a built-in variable
  assert.strictEqual(v.matched_skills, 'React, TypeScript and Node.js');
  assert.strictEqual(v.top_skill, 'React');
  assert.strictEqual(v.job_keywords, 'React, TypeScript, Node.js and GraphQL'); // de-duplicated
  assert.strictEqual(v.my_role, 'Frontend Developer');
  assert.strictEqual(v.years, '6');
  assert.strictEqual(v.portfolio, 'https://ana.dev');
  assert.strictEqual(v.today, 'November 2, 2026');
});

test('fill: missing variables stay visible as [name]', () => {
  const vars = tpl.variables(job, profile, [{ key: 'linkedin', value: '' }], NOW);
  const r = tpl.fill('Hi {{ Company }}, see {{linkedin}} and {{nope}}. {{company}}', vars);
  assert.strictEqual(r.text, 'Hi Catawiki, see [linkedin] and [nope]. Catawiki');
  assert.deepStrictEqual(r.missing, ['linkedin', 'nope']);
  assert.deepStrictEqual(tpl.fillParts('a {{role}} {{x}}', vars), ['a ', 'Senior React Developer', ' ', { missing: 'x' }]);
});

test('normalize: defaults, clean field names, no duplicates', () => {
  const n = tpl.normalize({ email: { subject: 5 }, fields: [{ key: ' GitHub ', value: 'x' }, { key: 'github', value: 'y' }, { key: '2bad', value: 'z' }, { key: 'role', value: 'w' }] });
  assert.strictEqual(n.email.subject, tpl.DEFAULTS.email.subject);
  assert.strictEqual(n.coverLetter.body, tpl.DEFAULTS.coverLetter.body);
  assert.deepStrictEqual(n.fields, [{ key: 'github', value: 'x' }]);
});

test('fillAll: the default templates only miss the user\'s own links', () => {
  const r = tpl.fillAll(undefined, job, profile, NOW);
  assert.strictEqual(r.email.subject, 'Senior React Developer at Catawiki: Ana');
  assert.match(r.email.body, /Hi Catawiki team/);
  assert.match(r.coverLetter, /Your posting asks for React, TypeScript and Node\.js/);
  assert.deepStrictEqual(r.missing.sort(), ['linkedin', 'portfolio']);
});

test('spell: the posting\'s spelling, then known spellings', () => {
  assert.strictEqual(tpl.spell('graphql', { tags: ['GraphQL'] }), 'GraphQL');
  assert.strictEqual(tpl.spell('kubernetes'), 'Kubernetes');
  assert.strictEqual(tpl.spell('htmx', { description: 'We love HTMX and Go.' }), 'HTMX');
  assert.strictEqual(tpl.spell('go', { description: 'gopher' }), 'Go');
  assert.strictEqual(tpl.spell('obscure-thing'), 'obscure-thing');
});

test('contactsOf', () => {
  const c = tpl.contactsOf({ url: 'mailto:jobs@acme.io', description: 'Ping noreply@acme.io or Bob@Acme.io.' });
  assert.deepStrictEqual(c.emails, ['bob@acme.io', 'jobs@acme.io']);
});
