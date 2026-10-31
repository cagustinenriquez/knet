const test = require('node:test');
const assert = require('node:assert');
const { parseJobIssue, toEntry, validPosts, postFormUrl, applyLink, reportFormUrl } = require('../src/main/posts');
const { auditPost } = require('../src/main/audit');
const { decide, decideReport, parseReport, applyOps, reportNotes, expire } = require('../scripts/review-job');

const DESC = 'We are hiring a backend engineer to build our payments API with Python and Django. You will own services end to end, work with product, and mentor juniors. Requirements: 4+ years of experience.';
const body = (o = {}) => {
  const f = { 'Job title': 'Senior Backend Engineer', Company: 'Acme', Location: 'LATAM', Workplace: 'Remote', 'Employment type': 'Full-time',
    Seniority: 'Senior', Salary: '_No response_', 'Skills / tech stack': 'Python, Django', 'How to apply': 'jobs@acme.com',
    Description: DESC, Confirmation: '- [X] This is a real open position, and applicants are never asked to pay anything.', ...o };
  return Object.entries(f).map(([k, v]) => `### ${k}\n\n${v}`).join('\n\n');
};
const NOW = new Date('2026-10-31T12:00:00Z');

test('parses the issue form, including headings inside the description', () => {
  const p = parseJobIssue(body({ Description: `${DESC}\n\n### Benefits\n- Remote` }));
  assert.strictEqual(p.title, 'Senior Backend Engineer');
  assert.deepStrictEqual(p.tags, ['Python', 'Django']);
  assert.strictEqual(p.apply, 'mailto:jobs@acme.com');
  assert.strictEqual(p.salary, '');
  assert.match(p.description, /### Benefits\n- Remote$/);
  assert.ok(p.confirmed);
  assert.ok(!parseJobIssue(body({ Confirmation: '- [ ] This is a real…' })).confirmed);
  assert.strictEqual(applyLink('http://acme.com/jobs'), 'https://acme.com/jobs');
});

test('post audit: good posts pass; scams, short text, bad links, new accounts and spammers fail', () => {
  const good = parseJobIssue(body());
  assert.strictEqual(auditPost(good, { accountAgeDays: 400, livePosts: 0, confirmed: true }).status, 'pass');
  const fails = (post, opts = {}) => auditPost(post, { accountAgeDays: 400, livePosts: 0, confirmed: true, ...opts }).checks.filter((c) => c.status === 'fail').map((c) => c.id);
  assert.deepStrictEqual(fails({ ...good, description: `${DESC} Pay the registration fee to start.` }), ['scam']);
  assert.deepStrictEqual(fails({ ...good, description: 'Great job, apply now!' }), ['description']);
  assert.deepStrictEqual(fails({ ...good, apply: 'https://bit.ly/x' }), ['apply']);
  assert.deepStrictEqual(fails({ ...good, apply: 'http://acme.com' }), ['apply']); // must be https
  assert.deepStrictEqual(fails(good, { accountAgeDays: 2 }), ['account']);
  assert.deepStrictEqual(fails(good, { livePosts: 3 }), ['limit']);
  assert.deepStrictEqual(fails(good, { confirmed: false }), ['confirm']);
  assert.deepStrictEqual(fails({ ...good, title: '' }), ['complete']);
});

const empty = () => ({ posted: { jobs: [] }, verified: { posters: [] }, reports: { reports: {} } });
const run = (state, ops) => applyOps(state, ops, NOW).state;

test('publishing, editing (keeps the date), takedown on bad edits, expiry', async () => {
  let state = empty();
  const r1 = await decide({ body: body(), number: 7, poster: 'ana', ageDays: 400, now: NOW, state });
  assert.strictEqual(r1.action, 'upsert');
  assert.match(r1.comment, /Published/);
  state = run(state, r1.ops);
  assert.strictEqual(state.posted.jobs[0].location, 'Remote - LATAM');
  assert.strictEqual(state.posted.jobs[0].verified, false);

  const later = new Date('2026-11-02T00:00:00Z');
  const r2 = await decide({ body: body({ Salary: 'USD 4000' }), number: 7, poster: 'ana', ageDays: 400, now: later, state });
  state = run(state, r2.ops);
  assert.strictEqual(state.posted.jobs.length, 1);
  assert.strictEqual(state.posted.jobs[0].salary, 'USD 4000');
  assert.strictEqual(state.posted.jobs[0].postedAt, NOW.toISOString());

  const scam = body({ Description: `${DESC} Contact us on WhatsApp +1 555 123 4567.` });
  const r3 = await decide({ body: scam, number: 7, poster: 'ana', ageDays: 400, now: later, state });
  assert.strictEqual(r3.action, 'remove');
  assert.strictEqual((await decide({ body: scam, number: 7, poster: 'ana', ageDays: 400, now: later, state, override: true })).action, 'upsert');
  assert.deepStrictEqual(run(state, r3.ops).posted.jobs, []);

  const { state: after, expired } = expire(state, Date.parse('2026-12-15T00:00:00Z'));
  assert.deepStrictEqual([after.posted.jobs.length, expired], [0, [7]]);
});

const reportBody = (post, reason = 'Scam or fraud (asks for money, personal data, etc.)') =>
  `### Which post\n\n${post}\n\n### Reason\n\n${reason}\n\n### Details\n\n_No response_`;

test('reports: 3 different people hide a post; the poster, repeats and new accounts do not count', async () => {
  let state = run(empty(), (await decide({ body: body(), number: 7, poster: 'ana', ageDays: 400, now: NOW, state: empty() })).ops);
  assert.deepStrictEqual(parseReport(reportBody('https://github.com/x/knet/issues/7')).post, 7);
  const report = (reporter, ageDays = 400, n = 100) => {
    const d = decideReport({ body: reportBody('#7'), number: n, reporter, ageDays, state });
    const r = applyOps(state, d.ops, NOW);
    state = r.state;
    return { ...d, result: r.result };
  };
  assert.match(report('ana').note, /own post/);          // poster: logged, not counted
  assert.match(report('newbie', 3).note, /under 14 days/); // young account: not counted
  assert.strictEqual(report('bob', 400, 101).result.count, 1);
  assert.ok(report('bob', 400, 102).result.duplicate);    // same person again
  assert.strictEqual(report('cy', 400, 103).result.count, 2);
  const third = report('dee', 400, 104);
  assert.ok(third.result.hidden);
  assert.deepStrictEqual(state.posted.jobs, []);
  assert.match(reportNotes({ post: 7, result: third.result, reason: 'Scam' }).toPost, /hidden/);
  assert.match(decideReport({ body: reportBody('#7'), number: 105, reporter: 'eve', ageDays: 400, state }).note, /isn't live/);
  assert.strictEqual(reportNotes({ post: 7, result: {}, reason: 'Scam', note: 'not live' }).toPost, ''); // nothing said on the post
  assert.strictEqual(reportNotes({ post: 7, result: { count: 1 }, reason: 'Scam', counted: false }).toPost, '');

  // Poster edits the issue: stays hidden. An admin's "approved" restores it and clears reports.
  const edit = await decide({ body: body({ Salary: 'USD 1' }), number: 7, poster: 'ana', ageDays: 400, now: NOW, state, override: true });
  assert.strictEqual(edit.action, 'none');
  assert.match(edit.comment, /Hidden after 3 reports/);
  const ok = await decide({ body: body(), number: 7, poster: 'ana', ageDays: 400, now: NOW, state, override: true, approvedNow: true });
  state = run(state, ok.ops);
  assert.strictEqual(state.posted.jobs.length, 1);
  assert.strictEqual(state.reports.reports[7], undefined);
});

test('verified posters: badge on all their posts, skip account/limit checks, never auto-hidden', async () => {
  let state = empty();
  // A brand-new account can't post…
  assert.strictEqual((await decide({ body: body(), number: 8, poster: 'acme-hr', ageDays: 1, now: NOW, state })).action, 'none');
  // …until an admin verifies it.
  state = run(state, [{ op: 'verify', login: 'acme-hr', issue: 8 }]);
  const r = await decide({ body: body(), number: 8, poster: 'acme-hr', ageDays: 1, now: NOW, state });
  assert.strictEqual(r.action, 'upsert');
  assert.match(r.comment, /Verified poster/);
  state = run(state, r.ops);
  assert.strictEqual(state.posted.jobs[0].verified, true);
  for (const [i, who] of ['a', 'b', 'c', 'd'].entries()) {
    state = applyOps(state, decideReport({ body: reportBody('#8'), number: 200 + i, reporter: who, ageDays: 400, state }).ops, NOW).state;
  }
  assert.strictEqual(state.posted.jobs.length, 1); // still up: an admin reviews instead
  state = run(state, [{ op: 'unverify', login: 'ACME-HR' }]);
  assert.strictEqual(state.posted.jobs[0].verified, false);
  assert.deepStrictEqual(state.verified.posters, []);
});

test('apps validate the public posts file', () => {
  const e = toEntry(parseJobIssue(body()), { issue: 7, poster: 'ana', now: NOW });
  const ok = validPosts({ jobs: [e] }, NOW.getTime());
  assert.strictEqual(ok.length, 1);
  assert.strictEqual(ok[0].source, 'posted');
  assert.strictEqual(ok[0].issueUrl, 'https://github.com/cagustinenriquez/knet/issues/7');
  assert.strictEqual(ok[0].verified, false);
  assert.strictEqual(validPosts({ jobs: [{ ...e, verified: true }] }, NOW.getTime())[0].verified, true);
  assert.strictEqual(validPosts({ jobs: [{ ...e, verified: 'yes' }] }, NOW.getTime())[0].verified, false);
  const rep = new URL(reportFormUrl({ issue: 7, title: 'Dev', company: 'Acme' }));
  assert.deepStrictEqual([rep.searchParams.get('template'), rep.searchParams.get('post')], ['report-job.yml', '#7']);
  const bad = [{ ...e, id: 'evil:1' }, { ...e, url: 'javascript:alert(1)' }, { ...e, title: 5 }, { ...e, expiresAt: '2020-01-01' }];
  assert.strictEqual(validPosts({ jobs: bad }, NOW.getTime()).length, 0);
  assert.deepStrictEqual(validPosts({}), []);
});

test('the pre-filled GitHub form carries the draft', () => {
  const u = new URL(postFormUrl({ title: 'Dev', company: 'Acme', location: 'LATAM', tags: ['Go', 'K8s'], apply: 'mailto:a@b.co', description: 'x' }));
  assert.strictEqual(u.searchParams.get('template'), 'post-job.yml');
  assert.strictEqual(u.searchParams.get('skills'), 'Go, K8s');
  assert.strictEqual(u.searchParams.get('description'), 'x');
  assert.strictEqual(new URL(postFormUrl({ title: 'Dev', company: 'A', description: 'x' }, { withDescription: false })).searchParams.get('description'), null);
});
