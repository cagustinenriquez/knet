#!/usr/bin/env node
// Reviews "Post a job" issues. Run by .github/workflows/job-posts.yml:
//   audit            issue opened/edited/reopened (or labeled "approved") → print a comment and
//                    write decision.json: publish the post, remove it, or do nothing
//   close            issue closed → decision.json removes the post
//   apply <file>     apply a decision to jobs/posted.json (fast, no network; retried on push races)
//   expire           drop posts past their expiry; print their issue numbers
// Issue text comes from env (ISSUE_BODY etc.). It's untrusted: never pass it to a shell.

const fs = require('fs');
const path = require('path');
const { parseJobIssue, toEntry, LIFETIME_DAYS } = require('../src/main/posts');
const { auditPost, formatAudit } = require('../src/main/audit');

const POSTED = path.join(__dirname, '..', 'jobs', 'posted.json');
const DECISION = 'decision.json';

const readPosted = () => JSON.parse(fs.readFileSync(POSTED, 'utf8'));
const writePosted = (data) => fs.writeFileSync(POSTED, `${JSON.stringify(data, null, 2)}\n`);
const safe = (s) => String(s).replace(/[<>`[\]]/g, '').replace(/@/g, '@​');
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

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

// Decide what to do with an open job-post issue.
async function decide({ body, number, poster, override, now = new Date(), ageDays, data = readPosted() }) {
  const post = parseJobIssue(body);
  const existing = data.jobs.find((j) => j.issue === number);
  const livePosts = data.jobs.filter((j) => j.poster === poster && j.issue !== number && Date.parse(j.expiresAt) > now).length;
  const audit = auditPost(post, { accountAgeDays: ageDays, livePosts, confirmed: post.confirmed });
  const publish = !audit.blocking || override;
  const decision = publish
    ? { action: 'upsert', entry: toEntry(post, { issue: number, poster, now, postedAt: existing?.postedAt }) }
    : { action: existing ? 'remove' : 'none', issue: number };

  const lines = [`### Post check: ${VERDICT[audit.status]}`, '', formatAudit(audit, safe), ''];
  if (publish) {
    lines.push(`📣 **${existing ? 'Updated' : 'Published'}${audit.blocking ? ' (approved by an admin)' : ''}.** knet users whose profile matches get notified on their next check (apps check every 30 minutes or so).`,
      '', `- The post stays up until ${decision.entry.expiresAt.slice(0, 10)} (${LIFETIME_DAYS} days).`,
      '- Editing this issue re-checks and updates the post.',
      '- **Close this issue when the position is filled**; it\'s then removed from every app.');
  } else {
    lines.push(`**Not published${existing ? ' (and taken down)' : ''}.** Edit the issue to fix the ❌ items and it's checked again.`,
      'If a check is wrong, an admin can publish it anyway by adding the `approved` label.');
  }
  return { decision, comment: lines.join('\n'), audit };
}

function applyDecision(data, d) {
  const others = data.jobs.filter((j) => j.issue !== (d.entry?.issue ?? d.issue));
  if (d.action === 'upsert') return { ...data, jobs: [...others, d.entry].sort((a, b) => a.issue - b.issue) };
  if (d.action === 'remove') return { ...data, jobs: others };
  return data;
}

function expire(data, now = Date.now()) {
  const expired = data.jobs.filter((j) => Date.parse(j.expiresAt) <= now);
  return { data: { ...data, jobs: data.jobs.filter((j) => Date.parse(j.expiresAt) > now) }, expired: expired.map((j) => j.issue) };
}

// ---------- CLI ----------

async function main(mode) {
  const number = Number(process.env.ISSUE_NUMBER);
  if (mode === 'audit') {
    const poster = String(process.env.POSTER || '');
    const { decision, comment } = await decide({
      body: process.env.ISSUE_BODY, number, poster, override: process.env.OVERRIDE === 'true', ageDays: await accountAgeDays(poster),
    });
    fs.writeFileSync(DECISION, JSON.stringify(decision));
    setOutput('action', decision.action);
    console.log(comment);
  } else if (mode === 'close') {
    const live = readPosted().jobs.some((j) => j.issue === number);
    fs.writeFileSync(DECISION, JSON.stringify({ action: live ? 'remove' : 'none', issue: number }));
    setOutput('action', live ? 'remove' : 'none');
    console.log(live ? '🗑️ Issue closed, so the post was removed from knet.' : '');
  } else if (mode === 'apply') {
    const d = JSON.parse(fs.readFileSync(process.argv[3] || DECISION, 'utf8'));
    writePosted(applyDecision(readPosted(), d));
  } else if (mode === 'expire') {
    const { data, expired } = expire(readPosted());
    writePosted(data);
    console.log(expired.join(' '));
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
}

if (require.main === module) {
  main(process.argv[2]).catch((e) => {
    console.log(`❌ The post check crashed: ${safe(e.message)}`);
    process.exitCode = 1;
  });
}

module.exports = { decide, applyDecision, expire };
