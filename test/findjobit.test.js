const test = require('node:test');
const assert = require('node:assert');
const fj = require('../src/main/findjobit');
const { scoreLocation } = require('../src/main/location');

// Shape of https://findjobit.com/jobs/feed (Nov 2026).
const LATAM_17 = 'Costa Rica,Paraguay,República Dominicana,Bolivia,El Salvador,Chile,Colombia,Honduras,Perú,Venezuela,Cuba,Uruguay,Panamá,Nicaragua,Guatemala,México,Ecuador';
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Findjobit</title>
  <item>
    <title>Niuro busca un Lead Data Engineer · Remote</title>
    <link>https://findjobit.com/jobs/6aeb47267e7f5d6574af838f</link>
    <guid>https://findjobit.com/jobs/6aeb47267e7f5d6574af838f</guid>
    <description>&lt;p&gt;Build pipelines in Python and Spark.&lt;/p&gt;</description>
    <category>Ingeniero de Datos</category>
    <region>${LATAM_17}</region>
    <type>Tiempo Completo</type>
    <pubDate>Wed, 04 Nov 2026 14:54:32 GMT</pubDate>
  </item>
  <item>
    <title>Cmg3.cl busca un Desarrollador/a Oracle Forms &amp; PL/SQL</title>
    <link>https://findjobit.com/jobs/abc123</link>
    <description>&lt;p&gt;Trabajo presencial en Santiago.&lt;/p&gt;</description>
    <category>Ingeniero de Base de Datos</category>
    <region>Chile</region>
    <type>Medio Tiempo</type>
    <pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Elsewhere busca un Dev</title>
    <link>https://example.com/job</link>
  </item>
</channel></rss>`;

test('splitTitle reads "Company busca un Role"', () => {
  assert.deepStrictEqual(fj.splitTitle('Niuro busca un Senior Web Designer & Developer · Remoto'),
    { company: 'Niuro', title: 'Senior Web Designer & Developer', remote: true });
  assert.deepStrictEqual(fj.splitTitle('Talentos360 E.I.R.L.  busca un React Developer'),
    { company: 'Talentos360 E.I.R.L.', title: 'React Developer', remote: false });
  assert.deepStrictEqual(fj.splitTitle('Niuro busca un Senior AI Infrastructure Platform Engineer (Remote, LATAM)'),
    { company: 'Niuro', title: 'Senior AI Infrastructure Platform Engineer (Remote, LATAM)', remote: true });
  assert.deepStrictEqual(fj.splitTitle('No pattern here'), { company: '', title: 'No pattern here', remote: false });
});

test('toFindjobitJobs reads company, countries, type and remote', () => {
  const jobs = fj.toFindjobitJobs(FEED);
  assert.strictEqual(jobs.length, 2); // links outside findjobit.com are skipped
  const [a, b] = jobs;
  assert.strictEqual(a.id, 'findjobit:6aeb47267e7f5d6574af838f');
  assert.strictEqual(a.source, 'findjobit');
  assert.strictEqual(a.company, 'Niuro');
  assert.strictEqual(a.title, 'Lead Data Engineer');
  assert.strictEqual(a.location, LATAM_17.split(',').join(', '));
  assert.strictEqual(a.remote, true);
  assert.strictEqual(a.type, 'Full-Time');
  assert.deepStrictEqual(a.tags, ['Ingeniero de Datos']);
  assert.strictEqual(a.postedAt, '2026-11-04T14:54:32.000Z');
  assert.strictEqual(b.company, 'Cmg3.cl');
  assert.strictEqual(b.location, 'Chile');
  assert.strictEqual(b.remote, false);
  assert.strictEqual(b.type, 'Part-Time');
});

test('a country list matches only the countries on it', () => {
  const [job] = fj.toFindjobitJobs(FEED);
  assert.strictEqual(scoreLocation({ locations: ['Dominican Republic'] }, job).value, 1);
  assert.strictEqual(scoreLocation({ locations: ['Mexico'] }, job).value, 1);
  assert.strictEqual(scoreLocation({ locations: ['Argentina'] }, job).hardFail, true); // not on the list
});

test('fetchFindjobit requests the feed', async () => {
  const jobs = await fj.fetchFindjobit(async (url) => { assert.strictEqual(url, fj.FEED_URL); return FEED; });
  assert.strictEqual(jobs.length, 2);
});
