#!/usr/bin/env node
// Reviews job posts, reports and poster verification. Run by .github/workflows/job-posts.yml.
//
//   audit         post issue opened/edited/reopened/labeled "approved" → comment + ops
//   close         post issue closed → ops (remove)
//   revoke        post issue labeled "revoke" → ops (remove); the workflow closes the issue
//   verify        post issue labeled "verified-poster" → ops (verify the poster)
//   unverify      that label removed → ops (unverify)
//   report        "Report a job" issue opened → ops (count the report)
//   report-notes  after apply: write the comments for a report
//   apply         apply ops.json to jobs/*.json and write result.json (no network; the
//                 workflow retries it on push races, so ops must be idempotent)
//   expire        drop posts past their expiry; print their issue numbers
//
// Issue text comes from env (ISSUE_BODY etc.). It's untrusted: never pass it to a shell.

const fs = require('fs');
const path = require('path');
const { parseJobIssue, toEntry, LIFETIME_DAYS, JOB_ID } = require('../src/main/posts');
const { auditPost, formatAudit } = require('../src/main/audit');

const DIR = path.join(__dirname, '..', 'jobs');
const FILES = { posted: 'posted.json', verified: 'verified.json', reports: 'reports.json', hidden: 'hidden.json' };
const OPS = 'ops.json';
const RESULT = 'result.json';
const REPORT_THRESHOLD = 3;   // distinct reporters that hide a post
const MIN_REPORTER_DAYS = 14; // younger accounts' reports are logged but not counted

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DIR, FILES[name]), 'utf8'));
const writeJson = (name, data) => fs.writeFileSync(path.join(DIR, FILES[name]), `${JSON.stringify(data, null, 2)}\n`);
const readState = () => ({ posted: readJson('posted'), verified: readJson('verified'), reports: readJson('reports'), hidden: readJson('hidden') });
const safe = (s) => String(s).replace(/[<>`[\]]/g, '').replace(/@/g, '@​');
const issueUrl = (n) => `https://github.com/${process.env.GITHUB_REPOSITORY || 'cagustinenriquez/knet'}/issues/${n}`;
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const isVerified = (state, login) => (state.verified.posters || []).some((p) => p.login.toLowerCase() === String(login).toLowerCase());
const reportersOf = (state, issue) => (state.reports.reports?.[issue] || []).filter((r) => r.counted);

async function accountAgeDays(login) {
  const token = process.env.GITHUB_TOKEN;
  if (!login || !token) return null;
  try {
    const r = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    const { created_at: created } = await r.json();
    return Math.floor((Date.now() - Date.parse(created)) / 86400000);
  } catch {
    return null;
  }
}

const VERDICT = { pass: '✅ Passed', warn: '⚠️ Passed with warnings', fail: '❌ Failed' };

// ---------- posts ----------

// Decide what to do with an open job-post issue. `approvedNow` = an admin just added "approved".
async function decide({ body, number, poster, override, approvedNow = false, now = new Date(), ageDays, state = readState() }) {
  const post = parseJobIssue(body);
  const existing = state.posted.jobs.find((j) => j.issue === number);
  const verified = isVerified(state, poster);
  const livePosts = state.posted.jobs.filter((j) => j.poster === poster && j.issue !== number && Date.parse(j.expiresAt) > now).length;
  // Verified posters skip the new-account and post-limit checks.
  const audit = auditPost(post, verified ? { confirmed: post.confirmed } : { accountAgeDays: ageDays, livePosts, confirmed: post.confirmed });
  const reported = !verified && !approvedNow && reportersOf(state, number).length >= REPORT_THRESHOLD;
  const publish = (!audit.blocking || override) && !reported;
  const ops = publish
    ? [{ op: 'upsert', entry: toEntry(post, { issue: number, poster, now, postedAt: existing?.postedAt }) }]
    : existing ? [{ op: 'remove', issue: number }] : [];
  if (approvedNow) ops.push({ op: 'clearReports', issue: number });
  const action = publish ? 'upsert' : existing ? 'remove' : 'none';

  const lines = [`### Post check: ${VERDICT[audit.status]}${verified ? ' · ✓ Verified poster' : ''}`, '', formatAudit(audit, safe), ''];
  if (reported) {
    lines.push(`🚩 **Hidden after ${REPORT_THRESHOLD} reports.** An admin will review it: \`approved\` restores the post, \`revoke\` removes it.`);
  } else if (publish) {
    lines.push(`📣 **${existing ? 'Updated' : 'Published'}${audit.blocking ? ' (approved by an admin)' : ''}.** knet users whose profile matches get notified on their next check (apps check every 30 minutes or so).`,
      '', `- The post stays up until ${ops[0].entry.expiresAt.slice(0, 10)} (${LIFETIME_DAYS} days).`,
      '- Editing this issue re-checks and updates the post.',
      '- **Close this issue when the position is filled**; it\'s then removed from every app.');
  } else {
    lines.push(`**Not published${existing ? ' (and taken down)' : ''}.** Edit the issue to fix the ❌ items and it's checked again.`,
      'If a check is wrong, an admin can publish it anyway by adding the `approved` label.');
  }
  return { ops, action, comment: lines.join('\n'), audit };
}

// ---------- reports ----------

const REPORT_FIELDS = { post: 'Which post', reason: 'Reason', details: 'Details' };

function parseReport(body = '') {
  const get = (h) => {
    const m = String(body).match(new RegExp(`###\\s*${h}[^\\n]*\\n+([\\s\\S]*?)(?=\\n###\\s|$)`, 'i'));
    const v = m ? m[1].trim() : '';
    return v === '_No response_' ? '' : v;
  };
  const which = get(REPORT_FIELDS.post);
  const job = which.match(/knet-job:\s*(\S{3,440})(?:\s+(https?:\/\/\S{1,800}))?/i);
  const post = job ? null : which.match(/(?:issues\/|#|^)\s*(\d{1,9})\b/);
  return {
    post: post ? Number(post[1]) : null,
    jobId: job && JOB_ID.test(job[1]) ? job[1] : null,
    jobUrl: job?.[2] || '',
    reason: get(REPORT_FIELDS.reason).replace(/[\u0000-\u001f]/g, '').slice(0, 80),
    details: get(REPORT_FIELDS.details).slice(0, 2000),
  };
}

// Returns { ops, note } — note explains a report that won't be counted.
function decideReport({ body, number, reporter, ageDays, title = '', state = readState() }) {
  const r = parseReport(body);
  const young = ageDays != null && ageDays < MIN_REPORTER_DAYS;
  if (r.jobId) { // a job from a board or company page
    return {
      ops: [{ op: 'reportJob', id: r.jobId, reporter, reason: r.reason || 'Other', counted: !young, report: number,
        title: String(title).replace(/^Report:\s*/i, '').slice(0, 200) }],
      note: young ? `Thanks. Reports from GitHub accounts under ${MIN_REPORTER_DAYS} days old are logged for the admin but don't count toward hiding the job.` : '',
      report: r,
    };
  }
  if (!r.post) return { ops: [], note: 'Couldn\'t tell which post this is about. Put the post\'s issue number (like #42) in "Which post".', report: r };
  const entry = state.posted.jobs.find((j) => j.issue === r.post);
  if (!entry) return { ops: [], note: `Post #${r.post} isn't live on knet right now, so there's nothing to hide.`, report: r };
  const own = entry.poster && entry.poster.toLowerCase() === String(reporter).toLowerCase();
  const counted = !own && !young;
  return {
    ops: [{ op: 'report', issue: r.post, reporter, reason: r.reason || 'Other', counted, report: number }],
    note: own ? 'You can\'t report your own post (close the issue to take it down).'
      : young ? `Thanks. Reports from GitHub accounts under ${MIN_REPORTER_DAYS} days old are logged for the admin but don't count toward hiding the post.` : '',
    report: r,
  };
}

// ---------- applying ops (pure) ----------

function applyOps(state, ops, now = new Date()) {
  const s = {
    posted: { ...state.posted, jobs: [...state.posted.jobs] },
    verified: { ...state.verified, posters: [...(state.verified.posters || [])] },
    reports: { ...state.reports, reports: { ...(state.reports.reports || {}) }, jobs: { ...(state.reports.jobs || {}) } },
    hidden: { ...(state.hidden || {}), jobs: [...(state.hidden?.jobs || [])] },
  };
  const result = {};
  const setVerifiedFlags = () => {
    s.posted.jobs = s.posted.jobs.map((j) => ({ ...j, verified: isVerified(s, j.poster) }));
  };
  for (const o of ops) {
    if (o.op === 'upsert') {
      s.posted.jobs = [...s.posted.jobs.filter((j) => j.issue !== o.entry.issue), { ...o.entry, verified: isVerified(s, o.entry.poster) }]
        .sort((a, b) => a.issue - b.issue);
    } else if (o.op === 'remove') {
      s.posted.jobs = s.posted.jobs.filter((j) => j.issue !== o.issue);
    } else if (o.op === 'verify') {
      if (!isVerified(s, o.login)) s.verified.posters.push({ login: o.login, since: now.toISOString().slice(0, 10), issue: o.issue });
      setVerifiedFlags();
    } else if (o.op === 'unverify') {
      s.verified.posters = s.verified.posters.filter((p) => p.login.toLowerCase() !== o.login.toLowerCase());
      setVerifiedFlags();
    } else if (o.op === 'clearReports') {
      delete s.reports.reports[o.issue];
    } else if (o.op === 'reportJob') {
      const list = [...(s.reports.jobs[o.id] || [])];
      const mine = list.find((r) => r.reporter.toLowerCase() === o.reporter.toLowerCase());
      if (!mine) list.push({ reporter: o.reporter, reason: o.reason, counted: o.counted, at: now.toISOString().slice(0, 10), report: o.report });
      s.reports.jobs[o.id] = list;
      result.count = list.filter((r) => r.counted).length;
      result.duplicate = !!mine && mine.report !== o.report;
      result.kind = 'job';
      if (result.count >= REPORT_THRESHOLD && !s.hidden.jobs.some((j) => j.id === o.id)) {
        s.hidden.jobs.push({ id: o.id, title: o.title, since: now.toISOString().slice(0, 10), report: o.report });
        result.hidden = true;
      }
    } else if (o.op === 'unhideJob') {
      s.hidden.jobs = s.hidden.jobs.filter((j) => j.id !== o.id);
      delete s.reports.jobs[o.id];
    } else if (o.op === 'report') {
      const list = [...(s.reports.reports[o.issue] || [])];
      if (!list.some((r) => r.reporter.toLowerCase() === o.reporter.toLowerCase())) {
        list.push({ reporter: o.reporter, reason: o.reason, counted: o.counted, at: now.toISOString().slice(0, 10), report: o.report });
      }
      s.reports.reports[o.issue] = list;
      const entry = s.posted.jobs.find((j) => j.issue === o.issue);
      const count = list.filter((r) => r.counted).length;
      const verified = entry && isVerified(s, entry.poster);
      result.count = count;
      result.verified = !!verified;
      result.duplicate = list.length && list.find((r) => r.reporter.toLowerCase() === o.reporter.toLowerCase()).report !== o.report;
      if (entry && !verified && count >= REPORT_THRESHOLD) {
        s.posted.jobs = s.posted.jobs.filter((j) => j.issue !== o.issue);
        result.hidden = true;
      }
    }
  }
  return { state: s, result };
}

function reportNotes({ post, result, note, reason, counted = true }) {
  const count = `${result.count ?? 0}/${REPORT_THRESHOLD}`;
  if (result.kind === 'job' || (!post && result.count !== undefined)) { // a job from a board or company page
    return {
      toPost: '',
      toReporter: note || (result.duplicate ? 'You already reported this job; it counts once.'
        : result.hidden ? `🚩 Thanks. This job reached ${REPORT_THRESHOLD} reports and is now hidden for every knet user. An admin will review it: adding \`approved\` to this issue un-hides it.`
          : `Thanks for the report. It's logged (${count} reports; the job is hidden for everyone at ${REPORT_THRESHOLD}).`),
    };
  }
  // Only counted reports on live posts are mentioned on the post's issue.
  const toPost = result.count === undefined || !counted ? ''
    : result.hidden
    ? `🚩 **This post was hidden from knet after ${REPORT_THRESHOLD} reports** (latest: ${safe(reason)}). An admin will review it: \`approved\` restores it, \`revoke\` removes it.`
    : result.duplicate ? '' // same person reporting twice: say nothing on the post
      : `🚩 A user reported this post: **${safe(reason)}** (${result.verified ? 'verified poster: an admin will review' : `${count} reports`}).`;
  const toReporter = [
    note || (result.duplicate ? 'You already reported this post; it counts once.'
      : result.hidden ? `Thanks for the report. Post #${post} has been hidden from knet while an admin reviews it.`
        : `Thanks for the report. It's logged on post #${post} (${result.verified ? 'the poster is verified, so an admin will review it' : `${count} reports; the post is hidden at ${REPORT_THRESHOLD}`}).`),
    '', `Post: ${issueUrl(post)}`,
  ].join('\n');
  return { toPost, toReporter };
}

function expire(state, now = Date.now()) {
  const live = state.posted.jobs.filter((j) => Date.parse(j.expiresAt) > now);
  const expired = state.posted.jobs.filter((j) => Date.parse(j.expiresAt) <= now).map((j) => j.issue);
  const reports = Object.fromEntries(Object.entries(state.reports.reports || {}).filter(([n]) => !expired.includes(Number(n))));
  // Hidden board jobs: listings are long gone after ~90 days, so forget them.
  const cutoff = now - 90 * 86400000;
  const hiddenJobs = (state.hidden?.jobs || []).filter((j) => Date.parse(j.since) > cutoff);
  const keep = new Set(hiddenJobs.map((j) => j.id));
  const jobReports = Object.fromEntries(Object.entries(state.reports.jobs || {})
    .filter(([id, list]) => keep.has(id) || list.some((r) => Date.parse(r.at) > cutoff)));
  return {
    state: { ...state, posted: { ...state.posted, jobs: live }, reports: { ...state.reports, reports, jobs: jobReports }, hidden: { ...(state.hidden || {}), jobs: hiddenJobs } },
    expired,
  };
}

// ---------- CLI ----------

const writeOps = (ops) => fs.writeFileSync(OPS, JSON.stringify(ops));

async function main(mode) {
  const number = Number(process.env.ISSUE_NUMBER);
  const login = String(process.env.POSTER || process.env.ACTOR || '');
  if (mode === 'audit') {
    const r = await decide({
      body: process.env.ISSUE_BODY, number, poster: login, override: process.env.OVERRIDE === 'true',
      approvedNow: process.env.APPROVED_NOW === 'true', ageDays: await accountAgeDays(login),
    });
    writeOps(r.ops);
    setOutput('action', r.action);
    setOutput('changes', String(r.ops.length > 0));
    console.log(r.comment);
  } else if (mode === 'close' || mode === 'revoke') {
    const live = readState().posted.jobs.some((j) => j.issue === number);
    writeOps(live ? [{ op: 'remove', issue: number }, { op: 'clearReports', issue: number }] : [{ op: 'clearReports', issue: number }]);
    setOutput('changes', 'true');
    console.log(mode === 'revoke' ? '🚫 An admin removed this post from knet.' : live ? '🗑️ Issue closed, so the post was removed from knet.' : '');
  } else if (mode === 'verify' || mode === 'unverify') {
    writeOps([{ op: mode, login, issue: number }]);
    setOutput('changes', 'true');
    console.log(mode === 'verify'
      ? `✓ **${safe(login)} is now a verified poster.** Their posts show a Verified badge in knet and skip the new-account and post-limit checks. Remove the \`verified-poster\` label to undo.`
      : `${safe(login)} is no longer a verified poster.`);
  } else if (mode === 'report') {
    const r = decideReport({ body: process.env.ISSUE_BODY, number, reporter: login, title: process.env.ISSUE_TITLE, ageDays: await accountAgeDays(login) });
    writeOps(r.ops);
    fs.writeFileSync('report.json', JSON.stringify({ post: r.report.post, note: r.note, reason: r.report.reason || 'Other', counted: !!r.ops[0]?.counted }));
    setOutput('kind', r.report.jobId ? 'job' : 'post');
    setOutput('changes', String(r.ops.length > 0));
    setOutput('post', r.report.post || '');
  } else if (mode === 'report-notes') {
    const meta = JSON.parse(fs.readFileSync('report.json', 'utf8'));
    const result = fs.existsSync(RESULT) ? JSON.parse(fs.readFileSync(RESULT, 'utf8')) : {};
    const { toPost, toReporter } = reportNotes({ ...meta, result });
    fs.writeFileSync('post-comment.md', toPost);
    fs.writeFileSync('report-comment.md', toReporter);
    setOutput('hidden', String(!!result.hidden));
    setOutput('comment_post', String(!!toPost && !!meta.post));
  } else if (mode === 'unhide') { // admin labeled a job report "approved"
    const { jobId } = parseReport(process.env.ISSUE_BODY);
    writeOps(jobId ? [{ op: 'unhideJob', id: jobId }] : []);
    setOutput('changes', String(!!jobId));
    console.log(jobId ? '✅ An admin reviewed this job and un-hid it for everyone.' : 'This report isn\'t about a job from a board or company page, so there was nothing to un-hide.');
  } else if (mode === 'apply') {
    const { state, result } = applyOps(readState(), JSON.parse(fs.readFileSync(process.argv[3] || OPS, 'utf8')));
    for (const k of Object.keys(FILES)) writeJson(k, state[k]);
    fs.writeFileSync(RESULT, JSON.stringify(result));
  } else if (mode === 'expire') {
    const { state, expired } = expire(readState());
    for (const k of Object.keys(FILES)) writeJson(k, state[k]);
    console.log(expired.join(' '));
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
}

if (require.main === module) {
  main(process.argv[2]).catch((e) => {
    console.log(`❌ The job-post script crashed: ${safe(e.message)}`);
    process.exitCode = 1;
  });
}

module.exports = { decide, decideReport, parseReport, applyOps, reportNotes, expire, REPORT_THRESHOLD };
