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

On first launch, fill in **My profile**. The app checks for jobs right away and then
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
| Location | 5 | Remote/worldwide or one of your locations. |

Jobs whose title or company contains an "exclude" keyword are hidden. With "Remote only"
on, on-site jobs are hidden.

You get notified for new jobs at or above the threshold (default 60) posted in the last
3 days. Up to 3 notifications per check, then one summary.

## Job sources

Free public APIs, no keys needed: [Remotive](https://remotive.com), [Remote OK](https://remoteok.com),
[Arbeitnow](https://www.arbeitnow.com), [Jobicy](https://jobicy.com). Their terms ask that you
link to the original posting and credit them, which the app does. Remotive's terms also
forbid passing their jobs on to other job sites. Read each source's terms before
launching publicly.

## Layout

```
src/main/main.js      window, tray, scheduled checks, notifications, IPC
src/main/sources.js   fetchers that turn each API into one job shape
src/main/matcher.js   scoring + explanations (pure functions, unit tested)
src/main/store.js     JSON file in the OS app-data folder
src/preload.js        safe bridge between UI and main process
src/renderer/         UI (plain HTML/CSS/JS, no build step)
```

Data lives in `~/.config/knet/knet-data.json` on Linux
(`%APPDATA%\knet` on Windows, `~/Library/Application Support/knet` on macOS).

## Known limits / next steps

- Mostly remote tech jobs, because that's what free APIs cover. LinkedIn, Indeed and
  Glassdoor have no open APIs, and scraping them breaks their terms. Next options:
  Adzuna or USAJobs (free keys), Greenhouse/Lever/Ashby company boards (public JSON),
  or paid aggregators.
- Matching is keyword-based. Next step: embeddings or an LLM for semantic matching
  ("Vue" ≈ "frontend framework"), plus CV upload to fill in the profile.
- Single user, local only. A real product needs a backend so alerts arrive when the
  laptop is off, plus email/mobile push.
- Not packaged yet. Add `electron-builder` for .deb/.AppImage/.exe/.dmg installers.
- On GNOME, the tray icon needs the AppIndicator extension.
- Stack: Electron was picked so the MVP could be built quickly. If it works out, the UI
  can be reused as-is in a Tauri (Rust) app for a smaller, lighter build.
