const test = require('node:test');
const assert = require('node:assert');
const { isFeed, parseFeed, feedToJobs, feedSlug, feedTitle } = require('../src/main/rss');
const { validEntries, syncApproved, suggestUrl } = require('../src/main/shared');
const { findAllPlatforms } = require('../src/main/ats');
const { parseIssue, addApproved } = require('../scripts/review-source');

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Remote Board</title>
<item><title>Acme: Senior Python Developer</title><link>https://board.io/jobs/1</link><guid>https://board.io/jobs/1</guid>
<region>Anywhere in the World</region><category>Python</category><pubDate>Wed, 29 Oct 2026 10:00:00 +0000</pubDate>
<description><![CDATA[<p>Build APIs with <b>Django</b> &amp; Postgres.</p>]]></description></item>
<item><title>Globex: React Engineer</title><link>https://board.io/jobs/2</link><region>USA Only</region></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Jobs at Initech</title>
<entry><id>urn:job:9</id><title type="html">Go Engineer</title><link rel="alternate" href="https://initech.com/jobs/9"/>
<updated>2026-10-30T12:00:00Z</updated><summary>Remote, LATAM.</summary><category term="golang"/></entry></feed>`;

test('reads RSS feeds, including "Company: Title" items and regions', () => {
  assert.ok(isFeed(RSS) && isFeed(ATOM) && !isFeed('<!doctype html><html>'));
  assert.strictEqual(feedTitle(RSS), 'Remote Board');
  const jobs = feedToJobs(parseFeed(RSS), feedSlug('https://board.io/feed.rss'), 'Remote Board');
  assert.strictEqual(jobs.length, 2);
  assert.deepStrictEqual(
    { title: jobs[0].title, company: jobs[0].company, location: jobs[0].location, tags: jobs[0].tags, remote: jobs[0].remote },
    { title: 'Senior Python Developer', company: 'Acme', location: 'Anywhere in the World', tags: ['Python'], remote: true });
  assert.match(jobs[0].description, /Build APIs with Django & Postgres/);
  assert.strictEqual(jobs[0].postedAt, '2026-10-29T10:00:00.000Z');
  assert.match(jobs[0].id, /^rss:board\.io\/feed\.rss:[0-9a-f]{12}$/);
  assert.strictEqual(jobs[1].location, 'USA Only');
});

test('reads Atom feeds; company falls back to the feed name', () => {
  const [j] = feedToJobs(parseFeed(ATOM), 'initech.com/jobs.atom', 'Initech');
  assert.deepStrictEqual([j.title, j.company, j.url, j.tags[0]], ['Go Engineer', 'Initech', 'https://initech.com/jobs/9', 'golang']);
});

test('feed URLs must be https; broken huge feeds parse quickly', () => {
  assert.throws(() => feedSlug('http://x.io/feed'));
  assert.strictEqual(feedSlug('https://x.io/a/feed?cat=dev'), 'x.io/a/feed?cat=dev');
  const broken = `<rss>${'<item><title>x'.repeat(200_000)}`;
  const t = Date.now();
  parseFeed(broken);
  assert.ok(Date.now() - t < 1000);
});

test('a page linking to several company boards is recognized as a job board', () => {
  assert.strictEqual(findAllPlatforms('<a href="https://jobs.lever.co/acme">x</a><a href="https://jobs.lever.co/acme/123">').length, 1);
  assert.strictEqual(findAllPlatforms('<a href="https://jobs.lever.co/acme"></a><a href="https://acme2.breezy.hr/p/1"></a>').length, 2);
});

test('shared list: invalid entries are dropped; approved sources merge once', () => {
  const approved = validEntries({ sources: [
    { name: 'Acme', platform: 'lever', slug: 'acme' },
    { name: 'Feed', platform: 'rss', slug: 'board.io/feed.rss' },
    { name: 'Bad', platform: 'nope', slug: 'x' },
    { name: 'Bad2', platform: 'lever', slug: 'a:b' },
    { name: '', platform: 'lever', slug: 'c' },
  ] });
  assert.deepStrictEqual(approved.map((s) => s.name), ['Acme', 'Feed']);
  assert.deepStrictEqual(validEntries(null), []);

  const settings = { companies: [{ name: 'Mine', platform: 'lever', slug: 'acme', custom: true }], removedShared: ['rss:board.io/feed.rss'] };
  assert.strictEqual(syncApproved(settings, approved).added, 0); // own one marked shared; removed one stays removed
  assert.strictEqual(settings.companies[0].shared, true);
  settings.removedShared = [];
  assert.strictEqual(syncApproved(settings, approved).added, 1);
  assert.strictEqual(syncApproved(settings, approved).added, 0);
  assert.deepStrictEqual(settings.companies[1], { name: 'Feed', platform: 'rss', slug: 'board.io/feed.rss', enabled: true, shared: true });

  // Revoking: the feed disappears; the user's own source stays but isn't "shared" anymore.
  const r = syncApproved(settings, []);
  assert.deepStrictEqual(r, { added: 0, revoked: ['rss:board.io/feed.rss'] });
  assert.deepStrictEqual(settings.companies.map((c) => [c.name, !!c.shared]), [['Mine', false]]);
});

test('suggest link pre-fills the GitHub issue form', () => {
  const u = new URL(suggestUrl({ url: 'https://jobs.lever.co/acme', name: 'Acme & Co' }));
  assert.strictEqual(u.searchParams.get('template'), 'new-source.yml');
  assert.strictEqual(u.searchParams.get('url'), 'https://jobs.lever.co/acme');
  assert.strictEqual(u.searchParams.get('title'), 'Source: Acme & Co');
});

test('review script parses issue forms and never adds duplicates', () => {
  const body = '### Careers page or RSS feed URL\n\nhttps://jobs.lever.co/acme\n\n### Company or feed name\n\nAcme <b>Inc</b>\n\n### Why is it useful? (optional)\n\n_No response_';
  assert.deepStrictEqual(parseIssue(body), { url: 'https://jobs.lever.co/acme', name: 'Acme Inc' });
  assert.deepStrictEqual(parseIssue('### Careers page or RSS feed URL\n\n_No response_'), { url: '', name: '' });
  const e = { name: 'Acme', platform: 'lever', slug: 'acme' };
  const first = addApproved({ sources: [] }, e);
  assert.ok(first.added);
  assert.ok(!addApproved(first.data, { ...e, slug: 'ACME' }).added);
});
