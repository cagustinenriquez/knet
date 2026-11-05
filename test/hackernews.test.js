const test = require('node:test');
const assert = require('node:assert');
const { parseFeed } = require('../src/main/rss');
const hn = require('../src/main/hackernews');

// Shape of https://hnrss.org/jobs (Nov 2026).
const item = (id, title, link, date = 'Tue, 03 Nov 2026 17:00:53 +0000') => `<item><title><![CDATA[${title}]]></title>
<description><![CDATA[<p>Article URL: <a href="${link}">${link}</a></p>]]></description>
<pubDate>${date}</pubDate><link>${link}</link><dc:creator>someone</dc:creator>
<comments>https://news.ycombinator.com/item?id=${id}</comments>
<guid isPermaLink="false">https://news.ycombinator.com/item?id=${id}</guid></item>`;

const FEED = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Hacker News: Jobs</title>
${item(50354582, 'Ashby (YC W19) Is Hiring EMs', 'https://www.ashbyhq.com/careers?ashby_jid=695b&amp;utm_source=hn')}
${item(49943524, 'Great Question (YC W21) Is Hiring Product Engineers in Canada (Remote)', 'https://greatquestion.co/careers')}
${item(1, 'no guid id', 'https://example.com')}
</channel></rss>`.replace('item?id=1</guid>', 'nope</guid>');

test('parseTitle reads company, batch, role and place', () => {
  const cases = [
    ['Sava Trust (YC F25) Is Hiring a Founding Engineer in NYC', 'Sava Trust', 'YC F25', 'Founding Engineer', 'NYC'],
    ['9 Mothers (YC P26) Is Hiring in Austin, TX', '9 Mothers', 'YC P26', 'Open roles', 'Austin, TX'],
    ['Hazel (YC W24) Is Hiring', 'Hazel', 'YC W24', 'Open roles', ''],
    ['Bitmovin (YC S15) Is Hiring Technical Graduates in Denver (Engineering/CS Focus)', 'Bitmovin', 'YC S15',
      'Technical Graduates (Engineering/CS Focus)', 'Denver'],
    ['Flexport Is Hiring a Biz Ops Leader in Office of CEO', 'Flexport', '', 'Biz Ops Leader in Office of CEO', ''],
    ['Nango (YC W23) Is Hiring Across Eng, FDE, Marketing, DevRel', 'Nango', 'YC W23', 'Eng, FDE, Marketing, DevRel', ''],
    ['Weave (YC W25) is hiring ML, AI, product, & design engineers', 'Weave', 'YC W25', 'ML, AI, product, & design engineers', ''],
  ];
  for (const [raw, company, batch, title, location] of cases) {
    assert.deepStrictEqual(
      (({ company: c, batch: b, title: t, location: l }) => ({ c, b, t, l }))(hn.parseTitle(raw)),
      { c: company, b: batch, t: title, l: location }, raw);
  }
  assert.strictEqual(hn.parseTitle('Some other post').title, 'Some other post');
});

test('fetchHackerNews turns feed items into jobs', async () => {
  const jobs = await hn.fetchHackerNews(async (url) => { assert.strictEqual(url, hn.FEED_URL); return parseFeed(FEED) && FEED; });
  assert.strictEqual(jobs.length, 2); // the item without an HN id is skipped
  const [a, b] = jobs;
  assert.strictEqual(a.id, 'hackernews:50354582');
  assert.strictEqual(a.source, 'hackernews');
  assert.strictEqual(a.company, 'Ashby');
  assert.strictEqual(a.url, 'https://www.ashbyhq.com/careers?ashby_jid=695b&utm_source=hn');
  assert.deepStrictEqual(a.tags, ['YC W19']);
  assert.strictEqual(a.postedAt, '2026-11-03T17:00:53.000Z');
  assert.strictEqual(b.location, 'Canada (remote)');
  assert.strictEqual(b.remote, true);
});
