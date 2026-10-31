const test = require('node:test');
const assert = require('node:assert');
const { parseJobIssue, toEntry, validPosts, postFormUrl, applyLink } = require('../src/main/posts');
const { auditPost } = require('../src/main/audit');
const { decide, applyDecision, expire } = require('../scripts/review-job');

const DESC = 'We are hiring a backend engineer to build our payments API with Python and Django. You will own services end to end, work with product, and mentor juniors. Requirements: 4+ years of experience.';
const body = (o = {}) => {
  const f = { 'Job title': 'Senior Backend Engineer', Company: 'Acme', Location: 'LATAM', Workplace: 'Remote', 'Employment type': 'Full-time',
    Seniority: 'Senior', Salary: '_No response_', 'Skills / tech stack': 'Python, Django', 'How to apply': 'jobs@acme.com',
    Description: DESC, Confirmation: '- [X] This is a real open position, and applicants are never asked to pay anything.', ...o };
  return Object.entries(f).map(([k, v]) => `### ${k}\n\n${v}`).join('\n\n');
};
const NOW = new Date('2026-10-31T12:00:00Z');

test('parses the issue form, including headings inside the description', () => {
  const p = parseJobIssue(body({ Description: `${DESC}\n\n### Benefits\n- Remote` }));
  assert.strictEqual(p.title, 'Senior Backend Engineer');
  assert.deepStrictEqual(p.tags, ['Python', 'Django']);
  assert.strictEqual(p.apply, 'mailto:jobs@acme.com');
  assert.strictEqual(p.salary, '');
  assert.match(p.description, /### Benefits\n- Remote$/);
  assert.ok(p.confirmed);
  assert.ok(!parseJobIssue(body({ Confirmation: '- [ ] This is a real…' })).confirmed);
  assert.strictEqual(applyLink('http://acme.com/jobs'), 'https://acme.com/jobs');
});

test('post audit: good posts pass; scams, short text, bad links, new accounts and spammers fail', () => {
  const good = parseJobIssue(body());
  assert.strictEqual(auditPost(good, { accountAgeDays: 400, livePosts: 0, confirmed: true }).status, 'pass');
  const fails = (post, opts = {}) => auditPost(post, { accountAgeDays: 400, livePosts: 0, confirmed: true, ...opts }).checks.filter((c) => c.status === 'fail').map((c) => c.id);
  assert.deepStrictEqual(fails({ ...good, description: `${DESC} Pay the registration fee to start.` }), ['scam']);
  assert.deepStrictEqual(fails({ ...good, description: 'Great job, apply now!' }), ['description']);
  assert.deepStrictEqual(fails({ ...good, apply: 'https://bit.ly/x' }), ['apply']);
  assert.deepStrictEqual(fails({ ...good, apply: 'http://acme.com' }), ['apply']); // must be https
  assert.deepStrictEqual(fails(good, { accountAgeDays: 2 }), ['account']);
  assert.deepStrictEqual(fails(good, { livePosts: 3 }), ['limit']);
  assert.deepStrictEqual(fails(good, { confirmed: false }), ['confirm']);
  assert.deepStrictEqual(fails({ ...good, title: '' }), ['complete']);
});

test('publishing, editing (keeps the date), closing and expiry', async () => {
  let data = { jobs: [] };
  const r1 = await decide({ body: body(), number: 7, poster: 'ana', ageDays: 400, now: NOW, data });
  assert.strictEqual(r1.decision.action, 'upsert');
  assert.match(r1.comment, /Published/);
  data = applyDecision(data, r1.decision);
  assert.strictEqual(data.jobs[0].location, 'Remote - LATAM');

  const later = new Date('2026-11-02T00:00:00Z');
  const r2 = await decide({ body: body({ Salary: 'USD 4000' }), number: 7, poster: 'ana', ageDays: 400, now: later, data });
  data = applyDecision(data, r2.decision);
  assert.strictEqual(data.jobs.length, 1);
  assert.strictEqual(data.jobs[0].salary, 'USD 4000');
  assert.strictEqual(data.jobs[0].postedAt, NOW.toISOString());

  // Edited into a scam → taken down. An admin "approved" label publishes anyway.
  const scam = body({ Description: `${DESC} Contact us on WhatsApp +1 555 123 4567.` });
  const r3 = await decide({ body: scam, number: 7, poster: 'ana', ageDays: 400, now: later, data });
  assert.strictEqual(r3.decision.action, 'remove');
  assert.strictEqual((await decide({ body: scam, number: 7, poster: 'ana', ageDays: 400, now: later, data, override: true })).decision.action, 'upsert');
  assert.deepStrictEqual(applyDecision(data, r3.decision).jobs, []);

  const { data: after, expired } = expire(data, Date.parse('2026-12-15T00:00:00Z'));
  assert.deepStrictEqual([after.jobs.length, expired], [0, [7]]);
});

test('apps validate the public posts file', () => {
  const e = toEntry(parseJobIssue(body()), { issue: 7, poster: 'ana', now: NOW });
  const ok = validPosts({ jobs: [e] }, NOW.getTime());
  assert.strictEqual(ok.length, 1);
  assert.strictEqual(ok[0].source, 'posted');
  assert.strictEqual(ok[0].issueUrl, 'https://github.com/cagustinenriquez/knet/issues/7');
  const bad = [{ ...e, id: 'evil:1' }, { ...e, url: 'javascript:alert(1)' }, { ...e, title: 5 }, { ...e, expiresAt: '2020-01-01' }];
  assert.strictEqual(validPosts({ jobs: bad }, NOW.getTime()).length, 0);
  assert.deepStrictEqual(validPosts({}), []);
});

test('the pre-filled GitHub form carries the draft', () => {
  const u = new URL(postFormUrl({ title: 'Dev', company: 'Acme', location: 'LATAM', tags: ['Go', 'K8s'], apply: 'mailto:a@b.co', description: 'x' }));
  assert.strictEqual(u.searchParams.get('template'), 'post-job.yml');
  assert.strictEqual(u.searchParams.get('skills'), 'Go, K8s');
  assert.strictEqual(u.searchParams.get('description'), 'x');
  assert.strictEqual(new URL(postFormUrl({ title: 'Dev', company: 'A', description: 'x' }, { withDescription: false })).searchParams.get('description'), null);
});
