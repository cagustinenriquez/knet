# knet — job alerts MVP

A desktop app that watches job boards and sends you a desktop notification when a
new posting matches your profile: tech stack, desired roles, years of experience,
soft skills and location.

## Run

```bash
npm install
npm start      # opens the app; closing the window keeps it running in the tray
npm test       # matcher unit tests
```

On first launch, register with your email (required; it stays on this computer for now and
will identify your account once there's a backend), then fill in **My profile**. The app checks for jobs right away and then
every 30 minutes (configurable). The first check loads existing postings into the app
without notifying; only jobs that appear later trigger notifications.

## How matching works

Each job gets a 0–100 score ([src/main/matcher.js](src/main/matcher.js)):

| Part | Max | How |
|---|---|---|
| Tech skills | 45 | Your skills found in the job's tags, title or description. 4 matches = full marks. Knows common aliases (k8s → Kubernetes, postgres → PostgreSQL). Short words like "Go" only count in tags/title. |
| Role | 25 | Your desired titles vs. the job title. "Front-end"/"frontend" treated alike; generic words like "engineer" count only a little. |
| Experience | 15 | Seniority inferred from "5+ years" in the text or from words like junior/senior/staff. |
| Soft skills | 10 | Your soft skills found in the description. |
| Location | 5 | Open worldwide, or open to one of your locations. |

Location is also a hard filter ([src/main/location.js](src/main/location.js)). If you list
places (e.g. "Argentina"), jobs limited to other places are hidden. "Limited" is read from
the job's location field ("Europe", "Munich"), its title ("… - Mainland Europe") or its
description ("must be based in the US", "Remote - USA / Canada"). Countries match the
regions they belong to: Argentina matches LATAM, Latin America and Americas. Entries like
"remote" or "worldwide" in your locations mean "I want remote jobs open to anyone", not a place.

Jobs whose title or company contains an "exclude" keyword are hidden. With "Remote only"
on, on-site jobs are hidden.

You get notified for new jobs at or above the threshold (default 60) posted in the last
3 days. Up to 3 notifications per check, then one summary.

## Tracking applications

Clicking **Applied** on a job adds it to the **Applications** board, with columns for
Applied, Screening, Interview, Offer and Closed (Rejected, No response, Withdrew). You
move a job between stages yourself, from the menu on its card or the stage buttons in
the job detail. Each change is saved with its date, so the detail shows a timeline, and
each application has a notes box. Job sites don't share candidate status, so stages are
manual for now. Reading confirmation and rejection emails is a possible next step.

## Job sources

**Job boards** (free public APIs, no keys): [Remotive](https://remotive.com),
[Remote OK](https://remoteok.com), [Arbeitnow](https://www.arbeitnow.com),
[Jobicy](https://jobicy.com) and [Get on Board](https://www.getonbrd.com) (LATAM tech jobs,
many in Spanish). Their terms ask that you link to the original posting and credit them,
which the app does. Remotive's terms also forbid passing their jobs on to other job sites.
Read each source's terms before launching publicly.

**Company career pages.** Most companies don't host their own job lists. They use a
hiring platform (ATS) that publishes a public JSON feed, and the app reads those feeds
([src/main/ats.js](src/main/ats.js)) instead of scraping HTML. Supported: Greenhouse,
Lever, Ashby, Workable, SmartRecruiters, Recruitee, Breezy HR, BambooHR, Workday and
Get on Board company pages.

A default list of ~20 nearshore/outsourcing companies that hire across LATAM is in
[src/main/companies.js](src/main/companies.js) (Endava, Truelogic, N-iX, Wizeline,
Turing, Azumo, Coderio, Flux IT, ...). In **Settings → Company career pages** you can turn
companies on/off, remove them, or add one by pasting its careers page URL. The app finds
which platform it uses.

**RSS / Atom feeds.** Many job boards publish one (e.g. `weworkremotely.com/remote-jobs.rss`).
Paste the feed URL in the same box. Items titled "Company: Job title" are split into company
and title ([src/main/rss.js](src/main/rss.js)).

If you paste a page that links to several companies' boards (a job board rather than one
company's careers page), the app says so instead of guessing.

Not supported yet: companies with custom-built job portals (Globant, EPAM, BairesDev,
Encora, ...) and platforms that need a login token (Hiringroom, Teamtailor, Manatal).

Some platforms need one request per job to get its description (SmartRecruiters,
BambooHR, Workday). The app fetches up to 40 new descriptions per company per check and
remembers them, so big boards fill in over a few checks. Breezy HR has no descriptions,
so those jobs are matched on title and location only.

When a job board or company is loaded for the first time, its existing postings go into
the app without notifications. Only postings that appear after that trigger alerts.

## Posting a job

Anyone can post a listing from **Post a job** in the app:

1. Fill in the form. **Check post** runs the same checks the server runs, so problems show up
   before submitting.
2. **Continue on GitHub** opens a pre-filled "Post a job" issue
   ([post-job.yml](.github/ISSUE_TEMPLATE/post-job.yml)). Tick the confirmation box and submit.
   A GitHub account is required; it stands in for a captcha.
3. The [Job posts](.github/workflows/job-posts.yml) workflow checks it
   ([auditPost in src/main/audit.js](src/main/audit.js)):

   | Check | Fails when |
   |---|---|
   | Required fields, field lengths | Title, company, location, how to apply or description missing / too long |
   | Real description | Under 150 characters |
   | No scam signals | Fees, WhatsApp/Telegram contact, crypto investing, daily earnings, "no interview"... |
   | Apply link | Not an https:// link or email, or a link shortener |
   | Poster confirmation | The "real position, no fees" box isn't ticked |
   | Poster account | GitHub account under 14 days old |
   | Post limit | The poster already has 3 live posts |

   If nothing fails, the post is published to [jobs/posted.json](jobs/posted.json) right away
   and labeled `published`. Otherwise it's labeled `needs-review`; the poster can edit the issue
   to fix it, or an admin can publish it anyway with the `approved` label.
4. Every app reads `jobs/posted.json` on each check as the "Posted on knet" source. Posts go
   through normal matching, so users whose profile fits get a notification.

Descriptions support Markdown (headings, **bold**, lists, links, code); the form has a
Preview tab. It's rendered by a small built-in parser ([src/renderer/markdown.js](src/renderer/markdown.js))
that never inserts HTML and only opens http(s)/mailto links.

**Reporting.** Every job has a **⚑ Report** button. It opens a pre-filled "Report a job" issue
([report-job.yml](.github/ISSUE_TEMPLATE/report-job.yml)) and moves the job to "Dismissed" for
you. When 3 different people report the same job, it's hidden for everyone until an admin
reviews it:
- Jobs posted on knet are taken down and their post issue labeled `reported` / `needs-review`.
  `approved` on the post restores it (and clears the reports); `revoke` removes it.
- Jobs from boards and company pages are added to [jobs/hidden.json](jobs/hidden.json), which
  every app reads. The third report stays open, labeled `reported` / `needs-review`;
  `approved` on it un-hides the job. Entries are dropped after 90 days.

The poster's own reports, repeat reports and reports from GitHub accounts under 14 days old
don't count.

**Verified posters.** An admin adds the `verified-poster` label to one of a poster's job issues
after checking them (company site, LinkedIn, a call). All their posts then show a **✓ Verified**
badge and skip the new-account and post-limit checks. Their posts aren't auto-hidden by reports
(reports go to the admin instead). Removing the label un-verifies them. The list lives in
[jobs/verified.json](jobs/verified.json); reports in [jobs/reports.json](jobs/reports.json).

Editing the issue re-checks and updates the post (an edit that fails takes it down). Closing
the issue removes it from every app. Posts expire after 30 days: a daily run removes them and
closes their issues. Posts can be turned off in Settings → Job sources.

## Shared sources (suggest → audit → admin review → everyone)

A source you add is only on your computer. Press **Suggest** next to it to share it:

1. The app opens a pre-filled GitHub issue ([new-source.yml](.github/ISSUE_TEMPLATE/new-source.yml)),
   labeled `source-request`. Submitting needs a GitHub account.
2. The [Source review](.github/workflows/source-review.yml) workflow audits the URL
   ([src/main/audit.js](src/main/audit.js)) and comments with a report:

   | Check | Fails when |
   |---|---|
   | Not already in knet | It's a default company or already shared |
   | Looks like job postings | Under 40% of items read like jobs (blog / news feeds) |
   | No scam signals (fees, WhatsApp/Telegram contact, crypto investing, "no interview", ...) | Over 10% of postings flagged (any = warning) |
   | Links go to real job pages | Over 10% use link shorteners or broken links |
   | Recently updated | Newest posting older than 60 days |
   | Adds new jobs | 95%+ of its jobs already come from other sources |
   | Relevant to knet users (tech roles, open to LATAM/worldwide) | Never; warns only |
   | Board matches the company name | Never; warns only |
   | Site allows automated reading (robots.txt, feeds only) | Never; warns only |

   The comment also has a checklist for the admin: is the company real, do its terms allow
   showing its jobs elsewhere, do the samples look like real jobs.
3. An admin (anyone with triage access to the repo) adds the `approved` label. The workflow
   re-audits, adds the source to [sources/approved.json](sources/approved.json), commits, and
   closes the issue. If any check fails, approval is refused; adding `approved-override`
   approves it anyway, and the overridden checks are recorded.
4. Every app downloads `sources/approved.json` on each check and adds new entries, marked
   "shared". If you remove a shared source, it stays removed.

**After approval:**
- Every Monday the workflow re-audits all shared sources and opens a `source-audit` issue for
  each one that newly fails (broken, stale, scams...).
- Adding the `revoke` label to that issue, or to the original request, removes the source from
  `approved.json`. Apps then drop it and its jobs on their next check, keeping jobs the user
  saved or applied to.

Labels the repo needs: `source-request`, `approved`, `approved-override`, `revoke`, `source-audit`,
plus `job-post`, `published`, `needs-review`, `job-report`, `reported` and `verified-poster` for job posts.
The list is read from the `dev` branch. Set `KNET_APPROVED_URL` to use another URL (e.g. for
testing). Entries are validated before use, since the file is public. You can run an audit
locally: `ISSUE_BODY="$(cat issue.md)" node scripts/review-source.js check`.

## Layout

```
src/main/main.js      window, tray, scheduled checks, notifications, IPC
src/main/sources.js   job-board fetchers; fetchAll() merges boards + companies
src/main/ats.js       company hiring-platform feeds + careers-URL detection
src/main/companies.js default company list
src/main/rss.js       RSS / Atom feed reader
src/main/shared.js    admin-approved shared sources (download, merge, revoke)
src/main/audit.js     source and job-post audit checks (scams, freshness, overlap, ...)
src/main/posts.js     jobs posted on knet: issue parsing, validation, GitHub form links
src/renderer/markdown.js  safe Markdown renderer for posted job descriptions
scripts/review-source.js  run by the GitHub workflow to check / approve suggestions
scripts/review-job.js     run by the GitHub workflow: publish / remove posts, reports, verification
src/main/location.js  location / region filter
src/main/profile.js   profile validation (email required)
src/main/applications.js  application stages, history and notes
src/main/matcher.js   scoring + explanations (pure functions, unit tested)
src/main/store.js     JSON file in the OS app-data folder
src/preload.js        safe bridge between UI and main process
src/renderer/         UI (plain HTML/CSS/JS, no build step; panels resizable by dragging the dividers)
```

Data lives in `~/.config/knet/knet-data.json` on Linux
(`%APPDATA%\knet` on Windows, `~/Library/Application Support/knet` on macOS).

## Packaging (Snap Store)

The app is **OkNetwork**; "knet" is the short name (logo, data folder, repo).

```bash
npm run icons       # re-render build/icon.png from assets/icon.svg (only after changing it)
npm run dist:snap   # → dist/oknetwork_<version>_amd64.snap
```

Try it locally: `sudo snap install --dangerous dist/oknetwork_*.snap`, then run `oknetwork`.
A snap keeps its data in `~/snap/oknetwork/current/.config/knet/`, separate from a
development run (`~/.config/knet/`).

Publish (one time: `sudo snap install snapcraft --classic`, `snapcraft login`,
`snapcraft register oknetwork`):

```bash
snapcraft upload --release=edge dist/oknetwork_*.snap   # test channel
snapcraft release oknetwork <revision> stable           # when it's ready
```

The store listing needs the privacy policy: [PRIVACY.md](PRIVACY.md) (a draft, so fill in
the placeholders first). The app links to it from the registration screen and Settings.

## Known limits / next steps

- LinkedIn, Indeed and Glassdoor have no open APIs, and scraping them breaks their
  terms. Other options: Adzuna (free key), custom adapters for big companies with their
  own portals (Globant, EPAM), or paid aggregators.
- Matching is keyword-based. Next step: embeddings or an LLM for semantic matching
  ("Vue" ≈ "frontend framework"), plus CV upload to fill in the profile.
- Single user, local only. A real product needs a backend so alerts arrive when the
  laptop is off, plus email/mobile push.
- Packaged for the Snap Store only so far (see "Packaging"). Windows (Microsoft Store)
  and macOS (Mac App Store, needs an Apple Developer account) come next.
- On GNOME, the tray icon needs the AppIndicator extension.
- Stack: Electron was picked so the MVP could be built quickly. If it works out, the UI
  can be reused as-is in a Tauri (Rust) app for a smaller, lighter build.
