// Tiny JSON-file store kept in Electron's userData folder.
// Good enough for an MVP; swap for SQLite once data or querying grows.

const fs = require('fs');
const path = require('path');
const { DEFAULT_COMPANIES } = require('./companies');

const MAX_JOBS = 6000;

const DEFAULTS = {
  profile: {
    email: '',        // required; set on the registration screen
    name: '',
    titles: [],       // desired roles, e.g. "Frontend Developer"
    skills: [],       // tech stack
    softSkills: [],
    years: 0,
    locations: [],    // e.g. "Europe", "USA", "Berlin"
    remoteOnly: false,
    exclude: [],      // keywords that disqualify a job (title/company)
  },
  settings: {
    theme: 'light',         // light | dark | dracula | pink | pride
    intervalMinutes: 30,
    threshold: 60,          // minimum score to notify
    notifications: true,
    maxAgeDays: 3,          // only notify for jobs posted recently
    sources: { posted: true, remotive: true, remoteok: true, arbeitnow: true, jobicy: true, getonbrd: true, companies: true },
    companies: DEFAULT_COMPANIES, // { name, platform, slug, enabled, url?, custom?, shared?, suggested? }
    removedShared: [],      // approved sources the user removed (so they don't come back)
  },
  jobs: {},       // id → job + { score, match, firstSeen, status }
  lastSync: null, // { at, added, errors[] }
  synced: false,  // false until the first fetch finishes (so we don't flood notifications)
  seededFeeds: null, // feeds (job boards / company boards) already loaded once; see main.js
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'knet-data.json');
    this.data = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...this.data,
        ...saved,
        profile: { ...DEFAULTS.profile, ...saved.profile },
        settings: { ...DEFAULTS.settings, ...saved.settings, sources: { ...DEFAULTS.settings.sources, ...saved.settings?.sources } },
      };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Could not read store, starting fresh:', e.message);
    }
  }

  save() {
    // Drop the oldest jobs nobody saved or applied to, so the file stays small.
    const ids = Object.keys(this.data.jobs);
    if (ids.length > MAX_JOBS) {
      ids
        .filter((id) => !['saved', 'applied'].includes(this.data.jobs[id].status))
        .sort((a, b) => this.data.jobs[a].firstSeen.localeCompare(this.data.jobs[b].firstSeen))
        .slice(0, ids.length - MAX_JOBS)
        .forEach((id) => delete this.data.jobs[id]);
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, DEFAULTS };
