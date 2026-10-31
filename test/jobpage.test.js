const test = require('node:test');
const assert = require('node:assert');
const jp = require('../src/main/jobpage');

const LIST = `<html><body>
  <a href="/international-jobs?page=2">Next</a>
  <a href="/about">About</a><a href="/blog/how-to-relocate">Blog</a>
  <a href="/netherlands/amsterdam/catawiki/lead-security-engineer-10303">Lead Security Engineer</a>
  <a href="/portugal/lisbon/catawiki/senior-product-manager-10229">PM</a>
  <a href="https://relocate.me/japan/tokyo/hennge/backend-engineer-10111#apply">Backend</a>
  <a href="https://other.example/jobs/123-abc">Elsewhere</a>
</body></html>`;

// Real-world quirk: raw newlines/tabs inside JSON strings, HTML entities in the title.
const JOB = `<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
<script type="application/ld+json">{
  "@context": "https://schema.org/", "@type": "JobPosting",
  "title": "Senior Manager – Data &amp; ML
\t\t| Relocation Offered",
  "datePosted": "2026-10-30", "employmentType": "FULL_TIME",
  "hiringOrganization": {"@type": "Organization", "name": "Catawiki"},
  "jobLocation": {"@type": "Place", "address": {"addressLocality": "Amsterdam", "addressCountry": "Netherlands"}},
  "description": "&lt;p&gt;Lead our data team.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;"
}</script>`;

test('finds the job links on a list page and the next page', () => {
  const links = jp.findJobLinks(LIST, 'https://relocate.me/international-jobs');
  assert.deepStrictEqual(links.sort(), [
    'https://relocate.me/japan/tokyo/hennge/backend-engineer-10111',
    'https://relocate.me/netherlands/amsterdam/catawiki/lead-security-engineer-10303',
    'https://relocate.me/portugal/lisbon/catawiki/senior-product-manager-10229',
  ]);
  assert.strictEqual(jp.nextPage(LIST, 'https://relocate.me/international-jobs'), 'https://relocate.me/international-jobs?page=2');
  assert.deepStrictEqual(jp.findJobLinks('<a href="/a/1">x</a>', 'https://x.io/jobs'), []); // too few to trust
});

test('reads JobPosting data into the shared job shape', () => {
  const url = 'https://relocate.me/netherlands/amsterdam/catawiki/senior-manager-10310';
  const [p] = jp.findPostings(JOB);
  const j = jp.toJob(p, url, Date.parse('2026-10-31'));
  assert.strictEqual(j.title, 'Senior Manager – Data & ML | Relocation Offered');
  assert.strictEqual(j.company, 'Catawiki');
  assert.strictEqual(j.location, 'Amsterdam, Netherlands');
  assert.strictEqual(j.remote, false);
  assert.strictEqual(j.type, 'full-time');
  assert.match(j.description, /Lead our data team\.\s+Python/);
  assert.strictEqual(j.postedAt, '2026-10-30T00:00:00.000Z');
  assert.strictEqual(j.id, jp.jobId(url));
  assert.match(j.id, /^jobpage:relocate\.me:[0-9a-f]{12}$/);
});

test('remote and expired postings', () => {
  const remote = { title: 'Dev', hiringOrganization: { name: 'Acme' }, jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: [{ '@type': 'Country', name: 'Argentina' }] };
  const r = jp.toJob(remote, 'https://x.io/jobs/dev-1');
  assert.strictEqual(r.remote, true);
  assert.strictEqual(r.location, 'Remote - Argentina');
  assert.strictEqual(jp.toJob({ ...remote, validThrough: '2020-01-01' }, 'https://x.io/jobs/dev-1'), null);
  assert.strictEqual(jp.toJob({ title: 'No company' }, 'https://x.io/jobs/x-1'), null);
});

test('postings inside @graph and ItemList are found', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},
    {"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"JobPosting","title":"A","hiringOrganization":"Acme"}}]}]}</script>`;
  assert.strictEqual(jp.findPostings(html).length, 1);
});

test('slugs are https only', () => {
  assert.strictEqual(jp.pageSlug('https://relocate.me/international-jobs/'), 'relocate.me/international-jobs');
  assert.throws(() => jp.pageSlug('http://relocate.me/jobs'), /https/);
});
