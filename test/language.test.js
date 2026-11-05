const test = require('node:test');
const assert = require('node:assert');
const { detectLanguage } = require('../src/main/language');
const { scoreJob } = require('../src/main/matcher');

const EN = `We are looking for a backend engineer to join our team. You will work with Node.js and Postgres,
and you will own services from design to production. We value clear writing, and our team works across time zones.
Experience with AWS is a plus, and you should have 3+ years of experience building APIs for the web.`;
const ES = `Estamos en la búsqueda de un desarrollador backend para sumarse a nuestro equipo. El puesto requiere
experiencia con Node.js y Postgres, y conocimientos de AWS. Buscamos personas con al menos 3 años de experiencia en
desarrollo de APIs. Somos una empresa que trabaja en remoto y también ofrecemos horario flexible para los equipos.`;
const PT = `Estamos buscando um(a) desenvolvedor(a) backend para atuar com Node.js e Postgres. Você vai trabalhar com
nossa equipe de produto, com foco em APIs. Buscamos um profissional com experiência prática em AWS e conhecimento de
bancos de dados. A vaga é remota e não exige inglês avançado. Nosso trabalho é feito em ciclos curtos com os times.`;
const DE = `Als Backend Engineer verantwortest du den Aufbau unserer Plattform. Du bringst Erfahrung mit Node.js und
Postgres mit und arbeitest eng mit dem Produktteam zusammen. Wir bieten dir ein Team, das auf Qualität achtet, und
die Möglichkeit, von zu Hause zu arbeiten. Erfahrung mit AWS ist ein Plus für die Rolle und für unser Team.`;

test('detectLanguage tells common job languages apart', () => {
  assert.strictEqual(detectLanguage(EN), 'en');
  assert.strictEqual(detectLanguage(ES), 'es');
  assert.strictEqual(detectLanguage(PT), 'pt');
  assert.strictEqual(detectLanguage(DE), 'de');
  assert.strictEqual(detectLanguage('バックエンドエンジニアを募集しています。'.repeat(3)), 'ja');
});

test('detectLanguage does not guess on short text', () => {
  assert.strictEqual(detectLanguage('Senior React Developer'), null);
  assert.strictEqual(detectLanguage('Ashby (YC W19) Is Hiring EMs. Posted on Hacker News jobs.'), null);
  assert.strictEqual(detectLanguage(''), null);
});

test('scoreJob drops jobs outside the chosen languages', () => {
  const profile = { skills: ['Node.js', 'Postgres'], titles: ['Backend Engineer'], locations: [] };
  const job = (description) => ({ title: 'Backend Engineer', company: 'Acme', description, tags: [], location: 'Remote', remote: true });

  const es = scoreJob({ ...profile, jobLanguages: ['en'] }, job(ES));
  assert.strictEqual(es.score, 0);
  assert.strictEqual(es.excluded, 'language');
  assert.match(es.reasons[0], /Spanish/);

  assert.ok(scoreJob({ ...profile, jobLanguages: ['en', 'es'] }, job(ES)).score > 0);
  assert.ok(scoreJob({ ...profile, jobLanguages: ['en'] }, job(EN)).score > 0);
  assert.ok(scoreJob({ ...profile, jobLanguages: [] }, job(ES)).score > 0); // none chosen: any language
  assert.ok(scoreJob({ ...profile, jobLanguages: ['es'] }, job('')).score > 0); // unknown language: kept
});
