# TODO

Feature ideas, roughly in order of value. Suggested first: 5 (follow-up reminders) and
7 (CSV export): both small and built on data the app already stores. Then 1 (smarter
matching), the biggest improvement but more work.

## Finding better jobs

- [ ] **1. Smarter matching.** Count related skills: "Vue" and "React" are both frontend
  frameworks; "Postgres" means SQL. Today a job only scores for the exact words in your
  profile.
- [ ] **2. Salary filter.** Read salaries from postings, convert them to one currency, and set
  a minimum. Jobs with no salary listed still show, ranked a little lower.
- [ ] **3. More free sources.** Jobs with official feeds or APIs: We Work Remotely, Working
  Nomads, Himalayas, HN "Who's hiring" (monthly), more company boards. (Checked and not
  usable: TalentHop and RemoteHunter, same paid service under two names; robots.txt
  blocks their job pages.)
- [ ] **4. "Not interested" that learns.** Hiding a job lets you say why (wrong stack, too
  senior, the location), and similar jobs score lower.

## Applying

- [ ] **5. Follow-up reminders.** "No reply in 7 days, follow up?" as a notification.
  Optionally move jobs with no reply after N days to "No response" automatically.
- [ ] **6. Application stats.** Response rate, average days to a reply, and which sources lead
  to interviews, from the Applications board's history.
- [ ] **7. Export to CSV.** For unemployment-benefit reports (many countries ask for a list of
  applications), or for backups.

## Everyday use

- [ ] **8. Daily digest.** One summary notification or email a day instead of one per job.
- [ ] **9. Search box** across all jobs, saved ones and applications.
- [ ] **10. Keyboard shortcuts:** j/k to move through jobs, s to save, a for applied, x to hide.

## Reach

- [ ] **11. Spanish and Portuguese interface.** The store keywords already cover those
  languages, but the app is English-only.
- [ ] **12. Windows in a tagged release (v0.1.1)** with the drag-and-drop board and the
  duplicate merging.
