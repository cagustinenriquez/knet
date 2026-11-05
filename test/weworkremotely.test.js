const test = require('node:test');
const assert = require('node:assert');
const wwr = require('../src/main/weworkremotely');

// Shape of https://weworkremotely.com/remote-jobs.rss (Nov 2026).
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>We Work Remotely</title>
  <item>
    <title>Super Speciosa: Supply Chain &amp; Operations Manager - LATAM</title>
    <region>Anywhere in the World</region><country></country><state></state>
    <skills>Operations, Logistics</skills>
    <category>Management and Finance</category>
    <type>Full-Time</type>
    <description>&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; Mexico City&lt;/p&gt;&lt;p&gt;Run our supply chain.&lt;/p&gt;</description>
    <pubDate>Wed, 04 Nov 2026 21:16:31 +0000</pubDate>
    <guid>https://weworkremotely.com/remote-jobs/super-speciosa-supply-chain-operations-manager-latam</guid>
    <link>https://weworkremotely.com/remote-jobs/super-speciosa-supply-chain-operations-manager-latam</link>
  </item>
  <item>
    <title>MANTECH: Requisitioning Agent</title>
    <region>USA Only</region>
    <skills></skills>
    <category>All Other Remote</category>
    <type>Contract</type>
    <description>Buy things.</description>
    <pubDate>Wed, 04 Nov 2026 17:00:37 +0000</pubDate>
    <link>https://weworkremotely.com/remote-jobs/mantech-requisitioning-agent</link>
  </item>
  <item>
    <title>Elsewhere: Not a WWR link</title>
    <link>https://example.com/job</link>
  </item>
</channel></rss>`;

test('toWwrJobs reads company, region, type and skills', () => {
  const jobs = wwr.toWwrJobs(FEED);
  assert.strictEqual(jobs.length, 2); // links outside weworkremotely.com are skipped
  const [a, b] = jobs;
  assert.strictEqual(a.id, 'weworkremotely:super-speciosa-supply-chain-operations-manager-latam');
  assert.strictEqual(a.source, 'weworkremotely');
  assert.strictEqual(a.company, 'Super Speciosa');
  assert.strictEqual(a.title, 'Supply Chain & Operations Manager - LATAM');
  assert.strictEqual(a.location, 'Anywhere in the World');
  assert.strictEqual(a.remote, true);
  assert.strictEqual(a.type, 'Full-Time');
  assert.deepStrictEqual(a.tags, ['Management and Finance', 'Operations', 'Logistics']);
  assert.match(a.description, /Run our supply chain/);
  assert.strictEqual(a.postedAt, '2026-11-04T21:16:31.000Z');
  assert.strictEqual(b.location, 'USA Only');
  assert.strictEqual(b.remote, true);
  assert.strictEqual(b.type, 'Contract');
});

test('fetchWeWorkRemotely requests the feed', async () => {
  const jobs = await wwr.fetchWeWorkRemotely(async (url) => { assert.strictEqual(url, wwr.FEED_URL); return FEED; });
  assert.strictEqual(jobs.length, 2);
});
