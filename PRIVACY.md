# OkNetwork Privacy Policy

> **DRAFT. Not yet reviewed by a lawyer.** Fill in the bracketed parts before publishing,
> and have it reviewed for the countries you distribute in.

**Effective date:** [YYYY-MM-DD]
**Applies to:** the OkNetwork desktop app ("knet") for Linux, Windows and macOS, version 0.1 and later.
**Who we are:** OkNetwork is made by [legal name of person or company], [country].
Contact: [support email].

## The short version

- Your profile, email, saved jobs, application stages and notes **stay on your computer**.
  OkNetwork has no account server and no database of users.
- The app downloads job listings directly from job boards and company career pages.
  Those sites see your IP address, like any website you visit.
- Posting a job, suggesting a source or reporting a job opens a **public GitHub issue**
  under your own GitHub account. Anyone can read it.
- No analytics, no tracking, no ads. We don't sell or share your data.

## What the app stores, and where

Everything below is saved in a file on your computer and nowhere else:

| Data | Why |
|---|---|
| Email (required) and name (optional) | Your profile. The email is never sent anywhere by the app. |
| Roles, skills, soft skills, experience, locations, blocked words | To score how well each job matches you |
| Jobs fetched from sources, and what you saved, dismissed or reported | So you don't see the same job twice |
| Application stages and private notes | Your application tracker |
| Settings (notification threshold, sources, panel widths) | So the app works the way you set it up |

Locations on disk:

- **Linux (Snap Store):** `~/snap/oknetwork/current/.config/knet/`
- **Linux (other installs):** `~/.config/knet/`
- **Windows:** `%APPDATA%\knet\`
- **macOS:** `~/Library/Application Support/knet/`

We cannot see, access, back up or recover this data.

## Network connections the app makes

The app connects to these services. It sends ordinary web requests and identifies itself as
`knet-desktop`. It never sends your profile, email or notes.

1. **Job boards and hiring platforms**, to download listings. These are Remotive, Remote OK,
   Arbeitnow, Jobicy, Get on Board, Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
   Recruitee, Breezy, BambooHR, Workday, and any company page or RSS feed you add yourself.
2. **GitHub (raw.githubusercontent.com)**, to download the shared lists of approved sources,
   jobs posted on OkNetwork, verified posters and hidden jobs.

Each of these services receives your **IP address** and the time of the request, and handles
it under its own privacy policy. When you open a job posting, the link opens in your web browser
and that website's policy applies.

## Things you choose to make public

These features don't send anything from the app. They open a pre-filled form on **github.com**
in your browser, and nothing is submitted until you press submit there:

- **Post a job:** the job details you enter.
- **Suggest a source:** the careers page or feed URL.
- **Report a job:** which job, and the reason you give.

The result is a **public GitHub issue** linked to your GitHub username. GitHub's
[privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
applies. Automated checks (GitHub Actions) read these issues to publish posts, count reports
and hide jobs. Published job posts are copied into a public file in the
[OkNetwork repository](https://github.com/cagustinenriquez/knet) and removed after 30 days,
when the issue is closed, or when an admin removes them. To remove something, close or edit
your issue, or contact us.

If a job description is too long for the form, the app copies it to your clipboard so you
can paste it in.

## Notifications

Job alerts are local desktop notifications from your operating system. No push service is used.

## What we don't do

- No analytics, telemetry, crash reporting or advertising.
- No selling, renting or sharing of personal data.
- No accounts, passwords or payment details.

## Children

OkNetwork is meant for job seekers and employers. It is not directed at children under 16.

## Your choices and rights

Because your data is only on your computer, you control it directly:

- **Edit** your profile in the app at any time.
- **Delete everything** by uninstalling the app and deleting the data folder listed above.
  On the Snap Store, `sudo snap remove --purge oknetwork` removes both.
- **Public GitHub content** can be edited or closed by you on GitHub. For removal help,
  write to [support email].

Depending on where you live, you may have rights under laws such as the EU/UK GDPR or
Argentina's Personal Data Protection Law (Ley 25.326), including access, correction and
deletion. Since we hold no personal data about app users, most requests are handled by the
steps above. For anything else, contact us at [support email].

## Changes

If this policy changes, we'll update the effective date and note the change in the release
notes. Material changes will be shown in the app.

## Contact

[legal name] · [support email] · [postal address, if required]
