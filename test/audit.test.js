const test = require('node:test');
const assert = require('node:assert');
const { auditSource, robotsDisallows, baseDomain, looseKey } = require('../src/main/audit');
const { findTarget, removeApproved } = require('../scripts/review-source');

const NOW = Date.parse('2026-10-31T00:00:00Z');
const job = (o = {}) => ({
  title: 'Senior Python Developer', company: 'Acme', location: 'Remote (Worldwide)', remote: true, tags: [],
  description: 'Requirements: 5 years of experience with Django. Apply below.', url: 'https://jobs.lever.co/acme/1',
  postedAt: '2026-10-28T00:00:00Z', ...o,
});
const status = (audit, id) => audit.checks.find((c) => c.id === id)?.status;

test('a healthy company board passes', () => {
  const a = auditSource({ platform: 'lever', slug: 'acme', name: 'Acme Inc' }, Array.from({ length: 10 }, () => job()), { now: NOW });
  assert.strictEqual(a.status, 'pass', JSON.stringify(a.checks));
  assert.ok(!a.blocking);
});

test('a news feed fails "looks like job postings"', () => {
  const items = ['Show HN: My weekend project', 'The history of the transistor', 'Why SQLite is great'].map((t) =>
    job({ title: t, description: 'An essay about computers.', url: 'https://example.org/post' }));
  const a = auditSource({ platform: 'rss', slug: 'news.example.com/rss', name: 'News' }, items, { now: NOW });
  assert.strictEqual(status(a, 'joblike'), 'fail');
  assert.ok(a.blocking);
});

test('scam signals: a few warn, many fail', () => {
  const scam = job({ description: 'No interview needed! Pay the registration fee and message us on WhatsApp +1 555 123 4567.' });
  const one = auditSource({ platform: 'lever', slug: 'acme', name: 'Acme' }, [scam, ...Array.from({ length: 19 }, () => job())], { now: NOW });
  assert.strictEqual(status(one, 'scam'), 'warn');
  const many = auditSource({ platform: 'lever', slug: 'acme', name: 'Acme' }, [scam, scam, job()], { now: NOW });
  assert.strictEqual(status(many, 'scam'), 'fail');
  // Normal postings that mention these words in passing aren't flagged.
  const fine = job({ description: 'Build our crypto wallet UI in React. We integrate with Telegram bots. Competitive salary.' });
  assert.strictEqual(status(auditSource({ platform: 'lever', slug: 'acme', name: 'Acme' }, [fine], { now: NOW }), 'scam'), 'pass');
});

test('link shorteners fail; links to unrelated sites warn', () => {
  const src = { platform: 'rss', slug: 'board.io/feed', name: 'Board' };
  assert.strictEqual(status(auditSource(src, [job({ url: 'https://bit.ly/abc' })], { now: NOW }), 'links'), 'fail');
  assert.strictEqual(status(auditSource(src, [job({ url: 'https://board.io/jobs/1' })], { now: NOW }), 'links'), 'pass');
  assert.strictEqual(status(auditSource(src, [job({ url: 'https://random-site.biz/x' })], { now: NOW }), 'links'), 'warn');
});

test('stale boards, duplicates and overlap', () => {
  const src = { platform: 'lever', slug: 'acme', name: 'Acme' };
  assert.strictEqual(status(auditSource(src, [job({ postedAt: '2026-01-01T00:00:00Z' })], { now: NOW }), 'fresh'), 'fail');
  assert.strictEqual(status(auditSource(src, [job()], { now: NOW, alreadyIn: 'Acme' }), 'duplicate'), 'fail');
  const all = auditSource(src, [job()], { now: NOW, existingKeys: new Set([looseKey(job())]) });
  assert.strictEqual(status(all, 'overlap'), 'fail');
});

test('board name mismatch only warns; empty sources warn', () => {
  const a = auditSource({ platform: 'lever', slug: 'toptal', name: 'Microsoft' }, [job()], { now: NOW });
  assert.strictEqual(status(a, 'owner'), 'warn');
  assert.ok(!a.blocking);
  assert.strictEqual(auditSource({ platform: 'lever', slug: 'x', name: 'X' }, [], { now: NOW }).status, 'warn');
});

test('robots.txt rules and base domains', () => {
  const txt = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/jobs.rss\nDisallow: /*.xml$';
  assert.ok(!robotsDisallows(txt, '/feed.rss'));
  assert.ok(robotsDisallows(txt, '/private/x'));
  assert.ok(!robotsDisallows(txt, '/private/jobs.rss'));
  assert.ok(robotsDisallows(txt, '/a/jobs.xml'));
  assert.ok(!robotsDisallows('', '/x'));
  assert.strictEqual(baseDomain('jobs.eu.lever.co'), 'lever.co');
  assert.strictEqual(baseDomain('www.empleos.com.ar'), 'empleos.com.ar');
});

test('revoke finds the source by marker or by the approving issue', () => {
  const data = { sources: [{ name: 'A', platform: 'lever', slug: 'a', issue: 3 }, { name: 'B', platform: 'rss', slug: 'b.io/feed', issue: 4 }] };
  assert.strictEqual(findTarget(data, '', 3).name, 'A');
  assert.strictEqual(findTarget(data, '<!-- knet-source: rss:b.io/feed -->', 99).name, 'B');
  assert.strictEqual(findTarget(data, 'nothing', 7), null);
  assert.deepStrictEqual(removeApproved(data, { platform: 'lever', slug: 'a' }).sources.map((s) => s.name), ['B']);
});
