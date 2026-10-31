const test = require('node:test');
const assert = require('node:assert');
const { sameJob, DupIndex, normCompany, normTitle, places, sourceRank, looseKey } = require('../src/main/dedupe');

const J = (company, title, location = '', extra = {}) => ({ company, title, location, ...extra });

test('the same job from different sources is a duplicate', () => {
  const pairs = [
    [J('Catawiki', 'Lead Security Engineer', 'Amsterdam, Netherlands'), J('Catawiki', 'Lead Security Engineer | Relocation Offered', 'Amsterdam')],
    [J('Catawiki', 'Lead Security Engineer', 'Amsterdam, Netherlands'), J('Catawiki B.V.', 'Lead Security Engineer (m/f/d)', 'Amsterdam, NL')],
    [J('Acme Inc.', 'Senior Software Engineer, Backend', 'Remote'), J('Acme', 'Senior Backend Software Engineer', 'Remote - US')],
    [J('Acme', 'Sr. Frontend Developer - Remote', 'Remote'), J('Acme', 'Senior Frontend Developer', 'Anywhere')],
    [J('Acme', 'Backend Engineer – Berlin', 'Berlin, Germany'), J('Acme', 'Backend Engineer', 'Berlin')],
    [J('Globant S.A. de C.V.', 'QA Analyst', 'Mexico City'), J('Globant', 'QA Analyst', 'Ciudad de Mexico, Mexico')],
    [J('Acme GmbH', 'Data Engineer (w/m/d)', 'München'), J('ACME', 'Data Engineer', 'Munchen, Germany')],
  ];
  for (const [a, b] of pairs) assert.ok(sameJob(a, b), `${a.title} ~ ${b.title}`);
});

test('different jobs stay apart', () => {
  const pairs = [
    [J('Acme', 'Senior Backend Engineer', 'Remote'), J('Acme', 'Junior Backend Engineer', 'Remote')],
    [J('Acme', 'Backend Engineer', 'Berlin'), J('Acme', 'Backend Engineer', 'London')],
    [J('Acme', 'Software Engineer II'), J('Acme', 'Software Engineer III')],
    [J('Acme', 'Data Engineer', 'Remote'), J('Globex', 'Data Engineer', 'Remote')],
    [J('Acme', 'Engineering Manager, Platform'), J('Acme', 'Engineering Manager, Payments')],
    [J('Acme', 'Product Designer (Mobile)'), J('Acme', 'Product Designer')],
    [J('Acme', 'Engineer - Backend'), J('Acme', 'Engineer - Frontend')],
    [J('Aubay', 'Fullstack Java / Vue.js (dominante Back) Senior'), J('Aubay', 'Fullstack Java / Vue.js (dominante Front) Senior')],
    [J('Endava', 'Regional Operations Manager', 'Cali, Valle del Cauca, Colombia'), J('Endava', 'Regional Operations Manager', 'Medellín, Antioquia, Colombia')],
  ];
  for (const [a, b] of pairs) assert.ok(!sameJob(a, b), `${a.title} vs ${b.title}`);
});

test('cleanup helpers', () => {
  assert.strictEqual(normCompany('The Acme Company, Inc.'), 'acme');
  assert.strictEqual(normCompany('Catawiki B.V.'), 'catawiki');
  assert.strictEqual(normTitle('Sr. Python Dev (Remote) | Visa sponsorship'), 'senior python developer');
  assert.strictEqual(normTitle('Backend Engineer - São Paulo', 'São Paulo, Brazil'), 'backend engineer');
  assert.deepStrictEqual([...places('Amsterdam, NL')], ['amsterdam', 'netherlands']);
  assert.deepStrictEqual([...places('Remote')], []);
  assert.strictEqual(looseKey(J('Acme Inc', 'Sr. QA (m/f/d)')), looseKey(J('Acme', 'Senior QA')));
});

test('index finds duplicates but never the job itself', () => {
  const gh = J('Catawiki', 'Lead Security Engineer', 'Amsterdam', { id: 'greenhouse:catawiki:1' });
  const idx = new DupIndex([gh]);
  assert.strictEqual(idx.find(J('Catawiki BV', 'Lead Security Engineer | Relocation Offered', 'Amsterdam', { id: 'jobpage:x:2' })), gh);
  assert.strictEqual(idx.find(gh), null);
  assert.strictEqual(idx.find(J('Catawiki', 'Senior Product Manager', 'Amsterdam', { id: 'jobpage:x:3' })), null);
});

test('company boards outrank job boards and aggregators', () => {
  assert.ok(sourceRank('posted') > sourceRank('greenhouse'));
  assert.ok(sourceRank('greenhouse') > sourceRank('remotive'));
  assert.ok(sourceRank('remotive') > sourceRank('jobpage'));
  assert.strictEqual(sourceRank('rss'), sourceRank('jobpage'));
});

test('a pipe only drops filler, not a different specialty', () => {
  assert.ok(sameJob(J('Catawiki', 'Lead Security Engineer | Relocation Offered'), J('Catawiki', 'Lead Security Engineer')));
  assert.ok(!sameJob(J('Margo', 'Data Scientist | Projets Pricing & Segmentation', 'Paris'), J('Margo', 'Data Scientist | Machine Learning Engineer', 'Paris')));
  assert.ok(!sameJob(J('BC', 'Ingeniero/a de Datos | Big Data & AWS'), J('BC', 'Ingeniero/a de Datos | Big Data & Cloud')));
});
