#!/usr/bin/env node
// Reviews shared job sources. Run by .github/workflows/source-review.yml:
//   check      a "Suggest a job source" issue was opened/edited → print an audit comment
//   approve    labeled "approved" → re-audit; if nothing fails (or OVERRIDE=true), add it to
//              sources/approved.json
//   revoke     labeled "revoke" → remove the source from sources/approved.json
//   audit-all  weekly → re-audit every shared source; open an issue for each one that fails
// Issue text comes from env (ISSUE_BODY, ISSUE_NUMBER). It's untrusted: never pass it to a shell.

const fs = require('fs');
const path = require('path');
const { checkSource, fetchCompanies, http } = require('../src/main/ats');
const { fetchAll } = require('../src/main/sources');
const { DEFAULTS } = require('../src/main/store');
const { validEntries, key } = require('../src/main/shared');
const { auditSource, formatAudit, looseKey, robotsDisallows } = require('../src/main/audit');

const APPROVED = path.join(__dirname, '..', 'sources', 'approved.json');
const MARKER = (k) => `<!-- knet-source: ${k} -->`;

// ---------- helpers ----------

// GitHub issue forms render as "### Label\n\nvalue" sections.
function parseIssue(body = '') {
  const field = (label) => {
    const m = body.match(new RegExp(`###\\s*${label}[^\\n]*\\n+([^\\n]+)`, 'i'));
    const v = m ? m[1].trim() : '';
    return v === '_No response_' ? '' : v;
  };
  return {
    url: field('Careers page or RSS feed URL'),
    // Plain text only: no control characters, markdown links or HTML.
    name: field('Company or feed name').replace(/<[^>]{0,200}>/g, '').replace(/[\u0000-\u001f<>[\]`]/g, '').trim().slice(0, 100),
  };
}

// Returns { added: boolean, data } without writing.
function addApproved(data, entry) {
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (sources.some((s) => key(s) === key(entry))) return { added: false, data };
  return { added: true, data: { ...data, sources: [...sources, entry] } };
}

// Which shared source an issue is about: a marker (audit issues) or the request's issue number.
function findTarget(data, body = '', number) {
  const m = body.match(/<!-- knet-source: ([^\s]{1,400}) -->/);
  const sources = data.sources || [];
  if (m) return sources.find((s) => key(s) === m[1].toLowerCase()) || null;
  return sources.find((s) => number && s.issue === Number(number)) || null;
}

function removeApproved(data, target) {
  return { ...data, sources: (data.sources || []).filter((s) => key(s) !== key(target)) };
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

// Text from the internet going into a GitHub comment: no HTML/markdown links, and no
// @mentions (they would notify real people).
const safe = (s) => String(s).replace(/[<>`[\]]/g, '').replace(/@/g, '@​');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const readApproved = () => JSON.parse(fs.readFileSync(APPROVED, 'utf8'));
const writeApproved = (data) => fs.writeFileSync(APPROVED, `${JSON.stringify(data, null, 2)}\n`);

// robots.txt for a feed's or job site's pages (hiring-platform APIs are meant to be read).
async function robotsFor(src) {
  if (src.platform !== 'rss' && src.platform !== 'jobpage') return null;
  const [host, ...rest] = src.slug.split('/');
  const url = `https://${host}/robots.txt`;
  try {
    const txt = await http(url, { text: true, headers: { Accept: 'text/plain' } });
    return { url, disallowed: robotsDisallows(txt, `/${rest.join('/')}`) };
  } catch {
    return { url, disallowed: false }; // no robots.txt = no restrictions
  }
}

// The platform's own name for the board, where its API gives one.
async function boardName(src) {
  try {
    if (src.platform === 'greenhouse') return (await http(`https://boards-api.greenhouse.io/v1/boards/${src.slug}`)).name || '';
    if (src.platform === 'workable') return (await http(`https://apply.workable.com/api/v1/widget/accounts/${src.slug}`)).name || '';
  } catch { /* optional */ }
  return '';
}

// Jobs knet already gets from every other source, to measure overlap.
async function existingKeys(exclude) {
  const approved = validEntries(readApproved()).filter((s) => key(s) !== key(exclude));
  const settings = { ...DEFAULTS.settings, companies: [...DEFAULTS.settings.companies, ...approved] };
  const { jobs } = await fetchAll(settings, { has: () => true }); // skip per-job detail requests
  return new Set(jobs.filter((j) => !(j.id.startsWith(`${exclude.platform}:${exclude.slug}:`))).map(looseKey));
}

const VERDICT = { pass: '✅ Passed', warn: '⚠️ Passed with warnings', fail: '❌ Failed' };

async function auditRequest(url, name) {
  const r = await checkSource(url, { withJobs: true });
  if (!r.ok) return { r };
  const src = { platform: r.platform, slug: r.slug, name };
  const [existing, robots, bname] = await Promise.all([existingKeys(src), robotsFor(src), boardName(src)]);
  const already = [...DEFAULTS.settings.companies, ...validEntries(readApproved())].find((s) => key(s) === key(src));
  return { r, src, audit: auditSource(src, r.jobs, { existingKeys: existing, robots, boardName: bname, alreadyIn: already?.name }) };
}

function report(r, audit) {
  const site = r.platform === 'rss' || r.platform === 'jobpage' ? `https://${r.slug.split('/')[0]}` : r.boardUrl;
  return [
    `### Audit: ${VERDICT[audit.status]}`,
    `**${r.label}** · ${code(r.slug)} · ${r.jobCount}${r.platform === 'jobpage' ? '+ jobs (sample read)' : ' jobs right now'}`,
    '',
    formatAudit(audit, safe),
    r.sample.length ? `\n<details><summary>Sample postings</summary>\n\n${r.sample.map((s) => `- ${safe(s)}`).join('\n')}\n</details>` : '',
    '',
    '**Admin checklist** (things the bot can\'t judge):',
    '- [ ] The company or job board is real and reputable (website, LinkedIn page, reviews)',
    `- [ ] Its terms allow showing its jobs in another app (${site})`,
    '- [ ] The sample postings look like real jobs',
  ].join('\n');
}

// ---------- modes ----------

async function check() {
  const { url, name } = parseIssue(process.env.ISSUE_BODY);
  if (!url || !name) return console.log('❌ The issue needs both a URL and a name. Edit the issue to fill them in and the check runs again.');
  const { r, audit } = await auditRequest(url, name);
  if (!r.ok) return console.log(`❌ Couldn't use ${code(url)}: ${safe(r.error)}\n\nEdit the issue with a working URL and the check runs again.`);
  console.log(`${report(r, audit)}\n\n${audit.blocking
    ? '**Approval is blocked** by the ❌ above. To approve anyway, an admin adds the `approved-override` label.'
    : 'To approve, an admin adds the `approved` label.'}`);
}

async function approve() {
  const override = process.env.OVERRIDE === 'true';
  const fail = (msg) => { setOutput('ok', 'false'); console.log(`${msg}\n\nNot approved.`); };
  const { url, name } = parseIssue(process.env.ISSUE_BODY);
  if (!url || !name) return fail('❌ The issue needs both a URL and a name.');
  const { r, src, audit } = await auditRequest(url, name);
  if (!r.ok) return fail(`❌ Couldn't use ${code(url)}: ${safe(r.error)}`);
  if (!validEntries({ sources: [src] }).length) return fail(`❌ ${code(url)} can't be stored as a shared source.`);
  if (audit.blocking && !override) {
    return fail(`${report(r, audit)}\n\n**Approval blocked** by the ❌ above. Add the \`approved-override\` label to approve anyway.`);
  }
  const { added, data } = addApproved(readApproved(), {
    ...src, url, addedAt: new Date().toISOString().slice(0, 10),
    issue: Number(process.env.ISSUE_NUMBER) || undefined, audit: audit.status,
    // Checks the admin knowingly overrode; the weekly audit won't re-report these.
    ...(audit.blocking ? { override: audit.checks.filter((c) => c.status === 'fail').map((c) => c.id) } : {}),
  });
  if (added) writeApproved(data);
  setOutput('ok', 'true');
  setOutput('added', String(added));
  console.log(added
    ? `✅ Approved${audit.blocking ? ' **with override**' : ''}. **${safe(name)}** is now in \`sources/approved.json\`; knet apps pick it up on their next check. Add the \`revoke\` label to this issue to remove it later.\n\n${report(r, audit)}`
    : `ℹ️ ${code(src.slug)} is already in the shared list. Nothing to add.`);
}

async function revoke() {
  const data = readApproved();
  const target = findTarget(data, process.env.ISSUE_BODY, process.env.ISSUE_NUMBER);
  if (!target) {
    setOutput('removed', 'false');
    return console.log('ℹ️ No shared source is linked to this issue, so nothing was revoked.');
  }
  writeApproved(removeApproved(data, target));
  setOutput('removed', 'true');
  console.log(`🚫 Revoked **${safe(target.name)}** (${code(target.slug)}). knet apps remove it and its jobs on their next check (jobs a user saved or applied to are kept).`);
}

// Weekly: re-audit every shared source; open one issue per failing source.
async function auditAll() {
  const data = readApproved();
  const sources = validEntries(data).map((s) => ({ ...data.sources.find((x) => key(x) === key(s)), ...s }));
  const failing = [];
  for (const src of sources) {
    const { jobs, errors } = await fetchCompanies([{ ...src, enabled: true }], { has: () => true });
    const audit = errors.length
      ? { status: 'fail', blocking: true, checks: [{ id: 'works', label: 'Source works', status: 'fail', detail: `Fetching failed: ${errors[0].replace(/^[^:]*: /, '')}` }] }
      : auditSource(src, jobs, { robots: await robotsFor(src) });
    const overridden = new Set(Array.isArray(src.override) ? src.override : []);
    const newFails = audit.checks.filter((c) => c.status === 'fail' && !overridden.has(c.id));
    console.log(`${audit.status.padEnd(4)} ${src.name} (${key(src)})${audit.blocking && !newFails.length ? ' (overridden at approval)' : ''}`);
    if (newFails.length) failing.push({ src, audit });
  }
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) { console.log(`\n${failing.length} failing. No GITHUB_TOKEN/GITHUB_REPOSITORY, so no issues opened.`); return; }

  const gh = (p, opts = {}) => fetch(`https://api.github.com/repos/${repo}${p}`, {
    ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  }).then((r) => { if (!r.ok) throw new Error(`GitHub API ${r.status} on ${p}`); return r.json(); });
  const open = await gh('/issues?state=open&labels=source-audit&per_page=100');
  for (const { src, audit } of failing) {
    if (open.some((i) => i.body?.includes(MARKER(key(src))))) continue; // already reported
    await gh('/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: `Audit failed: ${src.name}`,
        labels: ['source-audit'],
        body: [
          MARKER(key(src)),
          `The weekly audit of the shared source **${safe(src.name)}** (${code(src.slug)}) failed:`,
          '',
          formatAudit(audit, safe),
          '',
          '- To remove it from every knet app, add the `revoke` label.',
          '- To keep it, close this issue. It will be reported again next week if it still fails.',
        ].join('\n'),
      }),
    });
    console.log(`Opened an issue for ${src.name}`);
  }
}

const MODES = { check, approve, revoke, 'audit-all': auditAll };

if (require.main === module) {
  const run = MODES[process.argv[2]] || check;
  run().catch((e) => {
    setOutput('ok', 'false');
    console.log(`❌ The review script crashed: ${safe(e.message)}`);
    if (process.argv[2] === 'audit-all') process.exitCode = 1;
  });
}

module.exports = { parseIssue, addApproved, findTarget, removeApproved };
