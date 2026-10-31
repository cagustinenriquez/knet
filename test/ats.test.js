const test = require('node:test');
const assert = require('node:assert');
const { findPlatform, normalizeGetOnBoard } = require('../src/main/ats');
const { scoreJob, inferExperience } = require('../src/main/matcher');

test('detects the hiring platform from careers URLs', () => {
  const cases = {
    'https://boards.greenhouse.io/wizeline': ['greenhouse', 'wizeline'],
    'https://job-boards.greenhouse.io/embed/job_board/js?for=acme': ['greenhouse', 'acme'],
    'https://jobs.lever.co/coderio/123': ['lever', 'coderio'],
    'https://jobs.ashbyhq.com/truelogic': ['ashby', 'truelogic'],
    'https://apply.workable.com/azumo/': ['workable', 'azumo'],
    'https://careers.smartrecruiters.com/Endava': ['smartrecruiters', 'Endava'],
    'https://aerolab.recruitee.com/o/dev': ['recruitee', 'aerolab'],
    'https://fluxit.breezy.hr/': ['breezy', 'fluxit'],
    'https://sonatafytechnology.bamboohr.com/careers': ['bamboohr', 'sonatafytechnology'],
    'https://www.getonbrd.com/companies/acme-cl': ['getonbrd', 'acme-cl'],
    'https://intive.wd3.myworkdayjobs.com/en-US/Intive/job/x': ['workday', 'intive|wd3|Intive'],
  };
  for (const [url, [platform, slug]] of Object.entries(cases)) {
    assert.deepStrictEqual(findPlatform(url), { platform, slug }, url);
  }
  assert.strictEqual(findPlatform('https://apply.workable.com/j/37A90941C3'), null); // a single job, not a board
  assert.strictEqual(findPlatform('https://example.com/careers'), null);
});

test('finds a platform link inside page HTML quickly, even on huge pages', () => {
  const html = `<script>${'x'.repeat(2_000_000)}</script><a href="https://jobs.lever.co/acme">Jobs</a>${'a-'.repeat(500_000)}`;
  const t = Date.now();
  assert.deepStrictEqual(findPlatform(html), { platform: 'lever', slug: 'acme' });
  assert.ok(Date.now() - t < 1000, 'detection should not backtrack');
});

test('Get on Board: remote with no countries is open; otherwise limited to its countries', () => {
  const base = { id: 'x', attributes: { title: 'Dev', remote_modality: 'fully_remote', countries: [], published_at: 1793133968 } };
  assert.strictEqual(normalizeGetOnBoard(base).location, 'Remote');
  const local = { ...base, attributes: { ...base.attributes, remote_modality: 'remote_local', countries: ['Chile'] } };
  assert.strictEqual(normalizeGetOnBoard(local).location, 'Chile');
});

test('Spanish postings match English profiles', () => {
  const profile = { titles: ['Backend Engineer', 'Python Developer'], skills: ['Python', 'Django'], years: 4, locations: ['Argentina'] };
  const job = {
    title: 'Desarrollador/a Python Semi Senior', company: 'X', location: 'Argentina', remote: true, tags: ['Python', 'Django'],
    description: 'Buscamos 3 años de experiencia con Python y Django.',
  };
  const r = scoreJob(profile, job);
  assert.strictEqual(r.breakdown.title, 25);
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.deepStrictEqual(inferExperience(job).range, [3, 7]);
  assert.strictEqual(inferExperience({ title: 'Ingeniero SSr', description: '' }).source, 'mid');
  assert.strictEqual(inferExperience({ title: 'Python Semi Senior', description: '' }).source, 'mid');
});
