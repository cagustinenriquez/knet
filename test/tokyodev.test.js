const test = require('node:test');
const assert = require('node:assert');
const { parseFeed } = require('../src/main/rss');
const td = require('../src/main/tokyodev');

// Shape of https://www.tokyodev.com/jobs/atom.xml (Nov 2026).
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom">
  <title>TokyoDev Jobs</title>
  <entry>
    <id>tag:www.tokyodev.com,2005:Job/2359</id>
    <published>2026-11-02T17:26:25+09:00</published>
    <link rel="alternate" type="text/html" href="https://www.tokyodev.com/companies/moneyforward/jobs/ai-security-engineer-ciso-office-tokyo"/>
    <title>AI Security Engineer, CISO Office, Tokyo at Money Forward</title>
    <summary>Money Forward is hiring a AI Security Engineer, CISO Office, Tokyo. Apply from abroad. Business required. Partially remote ¥6.9M ~ ¥11.0M</summary>
    <author><name>Money Forward</name></author>
  </entry>
  <entry>
    <id>tag:www.tokyodev.com,2005:Job/2350</id>
    <published>2026-10-30T08:23:04+09:00</published>
    <link rel="alternate" type="text/html" href="https://www.tokyodev.com/companies/restar/jobs/software-engineer-mid-senior-level"/>
    <title>Software Engineer (Mid or Senior level) at RESTAR</title>
    <summary>RESTAR is hiring a Software Engineer (Mid or Senior level). Residency in Japan required. No Japanese required. Fully remote ¥8M ~ ¥12M</summary>
    <author><name>RESTAR</name></author>
  </entry>
  <entry>
    <id>tag:www.tokyodev.com,2005:Job/2340</id>
    <published>2026-10-29T10:00:00+09:00</published>
    <link rel="alternate" type="text/html" href="https://www.tokyodev.com/companies/rapyuta/jobs/embedded-software-engineer"/>
    <title>Embedded Software Engineer at Rapyuta Robotics</title>
    <summary>Rapyuta Robotics is hiring a Embedded Software Engineer. Apply from abroad. No Japanese required. No remote</summary>
    <author><name>Rapyuta Robotics</name></author>
  </entry>
</feed>`;

test('parseSummary', () => {
  const f = td.parseSummary('X is hiring a Y. Apply from abroad. Conversational required. Partially remote ¥9M ~');
  assert.deepStrictEqual({ ...f, text: undefined }, { abroad: true, residency: false, japanese: 'Japanese: conversational level', remote: 'partial', salary: '¥9M', text: undefined });
  assert.strictEqual(td.parseSummary('No Japanese required. No remote').japanese, 'No Japanese required');
  assert.strictEqual(td.parseSummary('Fully remote ¥8M ~ ¥12M').salary, '¥8M ~ ¥12M');
});

test('splitTitle: drops " at <company>", finds the city', () => {
  assert.deepStrictEqual(td.splitTitle('AI Security Engineer, CISO Office, Tokyo at Money Forward', 'Money Forward'),
    { title: 'AI Security Engineer, CISO Office, Tokyo', city: 'Tokyo' });
  assert.deepStrictEqual(td.splitTitle('Data Engineer at Acme at Scale', 'Other'), { title: 'Data Engineer at Acme at Scale', city: '' });
});

test('feed entries → jobs', () => {
  const company = { 0: 'Money Forward', 1: 'RESTAR', 2: 'Rapyuta Robotics' };
  const jobs = parseFeed(FEED).map((e, i) => td.toTokyoDevJob({ ...e, company: company[i] }));
  assert.deepStrictEqual(jobs.map((j) => [j.id, j.title, j.company, j.location, j.remote]), [
    ['tokyodev:moneyforward/ai-security-engineer-ciso-office-tokyo', 'AI Security Engineer, CISO Office, Tokyo', 'Money Forward', 'Tokyo, Japan (hybrid)', false],
    ['tokyodev:restar/software-engineer-mid-senior-level', 'Software Engineer (Mid or Senior level)', 'RESTAR', 'Remote - Japan', true],
    ['tokyodev:rapyuta/embedded-software-engineer', 'Embedded Software Engineer', 'Rapyuta Robotics', 'Japan', false],
  ]);
  assert.deepStrictEqual(jobs[0].tags, ['Apply from abroad', 'Japanese: business level', 'Hybrid']);
  assert.deepStrictEqual(jobs[1].tags, ['Japan residents only', 'No Japanese required']);
  assert.strictEqual(jobs[0].salary, '¥6.9M ~ ¥11.0M');
  assert.strictEqual(jobs[0].postedAt, '2026-11-02T08:26:25.000Z');
});

test('fetchTokyoDev reads the company from <author>', async () => {
  const jobs = await td.fetchTokyoDev(async (url) => { assert.strictEqual(url, td.FEED_URL); return FEED; });
  assert.deepStrictEqual(jobs.map((j) => j.company), ['Money Forward', 'RESTAR', 'Rapyuta Robotics']);
});
