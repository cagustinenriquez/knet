// Email and cover letter templates with {{variables}}, filled in per job.
// Shared by the UI (window.tpl) and the main process / MCP tools (require), and unit tested.
//
// Variables come from the job ({{company}}, {{role}}, {{matched_skills}}, …), the profile
// ({{my_name}}, {{years}}, …) and the user's own fields in Templates → Your details
// ({{linkedin}}, {{portfolio}}, … any name they add). A variable with no value is left as
// "[name]" so it stands out before sending.

(function (root) {
  const VARIABLES = [
    { key: 'company', from: 'job', label: 'Company name' },
    { key: 'role', from: 'job', label: 'Job title' },
    { key: 'location', from: 'job', label: 'Job location' },
    { key: 'matched_skills', from: 'job', label: 'Skills the job asks for that you have, e.g. "React, TypeScript and Node.js"' },
    { key: 'top_skill', from: 'job', label: 'The first of those skills' },
    { key: 'job_keywords', from: 'job', label: 'Main keywords of the posting (its tags and skills)' },
    { key: 'apply_url', from: 'job', label: 'Link to the posting' },
    { key: 'my_name', from: 'profile', label: 'Your name' },
    { key: 'my_email', from: 'profile', label: 'Your email' },
    { key: 'my_role', from: 'profile', label: 'Your first desired role, e.g. "Frontend Developer"' },
    { key: 'years', from: 'profile', label: 'Your years of experience' },
    { key: 'my_skills', from: 'profile', label: 'Your top 5 skills' },
    { key: 'today', from: 'date', label: 'Today\'s date, e.g. "November 2, 2026"' },
  ];
  const BUILT_IN = new Set(VARIABLES.map((v) => v.key));
  const FIELD_KEY = /^[a-z][a-z0-9_]{0,30}$/;
  const MAX_TEXT = 8000;

  const DEFAULTS = {
    email: {
      subject: '{{role}} at {{company}}: {{my_name}}',
      body: `Hi {{company}} team,

I'm {{my_name}}, a {{my_role}} with {{years}} years of experience, and I'd love to be considered for the {{role}} role.

Your posting mentions {{matched_skills}}, which is what I work with every day. I'd be glad to show you what I've built: {{portfolio}}

Would you be open to a short call this week or next?

Best regards,
{{my_name}}
{{linkedin}}`,
    },
    coverLetter: {
      body: `{{today}}

Dear {{company}} hiring team,

I'm writing to apply for the {{role}} position. I'm a {{my_role}} with {{years}} years of experience, and the role is a strong fit for what I do best.

Your posting asks for {{matched_skills}}. These are the tools I use every day, most of all {{top_skill}}, and I've used them to ship products people rely on. You can see some of that work at {{portfolio}}.

I'm especially interested in {{company}} because [why this company: its product, mission or team].

I'd welcome the chance to talk about how I can help your team. Thank you for your time and consideration.

Sincerely,
{{my_name}}
{{my_email}} · {{linkedin}}`,
    },
    fields: [
      { key: 'linkedin', value: '' },
      { key: 'portfolio', value: '' },
      { key: 'phone', value: '' },
    ],
  };

  // Skills are stored lowercase for matching; letters need "TypeScript", not "typescript".
  // Use the posting's own spelling when it has one, else a known spelling, else as typed.
  const SPELLING = Object.fromEntries(['React', 'React Native', 'TypeScript', 'JavaScript', 'Node.js', 'Next.js', 'Vue', 'Nuxt',
    'Angular', 'Svelte', 'HTML', 'CSS', 'Sass', 'Tailwind', 'GraphQL', 'REST', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis',
    'Python', 'Django', 'Flask', 'FastAPI', 'Go', 'Golang', 'Rust', 'Java', 'Kotlin', 'Swift', 'iOS', 'Android', 'C#', '.NET', 'C++',
    'Ruby', 'Rails', 'PHP', 'Laravel', 'Elixir', 'Scala', 'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'Linux',
    'CI/CD', 'Git', 'Figma', 'UX', 'UI', 'SEO', 'Machine Learning', 'AI', 'LLM', 'NLP', 'Kafka', 'Spark', 'Snowflake', 'dbt',
    'Elasticsearch', 'Redux', 'Webpack', 'Jest', 'Cypress', 'Playwright', 'Storybook', 'Express', 'NestJS', 'Spring', 'Salesforce',
    'SAP', 'Excel', 'Tableau', 'Power BI', 'Jira', 'Agile', 'Scrum'].map((s) => [s.toLowerCase(), s]));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function spell(skill, job = {}) {
    const lower = String(skill).toLowerCase();
    const inTags = (job.tags || []).find((t) => String(t).toLowerCase() === lower && t !== lower);
    if (inTags) return inTags;
    if (SPELLING[lower]) return SPELLING[lower];
    const m = `${job.title || ''} ${job.description || ''}`.match(new RegExp(`(?<![\\w.+#-])${escRe(lower)}(?![\\w+#-])`, 'i'));
    return m && m[0] !== lower ? m[0] : skill;
  }

  // "React, TypeScript and Node.js"
  function listJoin(items) {
    const a = items.filter(Boolean);
    return a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
  }

  // Ways to reach someone about a job, found in the posting: emails, LinkedIn profiles, apply link.
  // From the posting's text, so treat as untrusted (the user reviews before sending).
  const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|privacy|gdpr|abuse|unsubscribe)@|@(example\.(com|org)|sentry\.io)$|\.(png|jpe?g|gif|svg|webp)$/i;
  function contactsOf(job) {
    const text = `${job.description || ''} ${job.url || ''}`;
    const emails = [...new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase().replace(/\.$/, '')))]
      .filter((e) => !NOT_A_PERSON.test(e)).slice(0, 5);
    const linkedin = [...new Set(text.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-z0-9_%-]+/gi) || [])].slice(0, 5);
    return { emails, linkedin, apply_url: job.url };
  }

  // All variable values for one job.
  function variables(job, profile = {}, fields = [], now = new Date()) {
    const m = job.match || {};
    const matched = (m.matchedSkills || []).slice(0, 4).map((s) => spell(s, job));
    const seen = new Set();
    const keywords = [...(m.matchedSkills || []).map((s) => spell(s, job)), ...(job.tags || [])]
      .filter((k) => k && k.length <= 30 && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase())).slice(0, 6);
    const vars = {
      company: job.company || '',
      role: job.title || '',
      location: job.location || (job.remote ? 'Remote' : ''),
      matched_skills: listJoin(matched),
      top_skill: matched[0] || '',
      job_keywords: listJoin(keywords),
      apply_url: job.url || '',
      my_name: profile.name || '',
      my_email: profile.email || '',
      my_role: (profile.titles || [])[0] || '',
      years: profile.years ? String(profile.years) : '',
      my_skills: listJoin((profile.skills || []).slice(0, 5).map((s) => spell(s))),
      today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    };
    for (const f of fields) if (FIELD_KEY.test(f.key) && !BUILT_IN.has(f.key)) vars[f.key] = String(f.value || '').trim();
    return vars;
  }

  // Template → parts: plain text, or { missing: key } for a variable with no value.
  function fillParts(text, vars) {
    const parts = [];
    let last = 0;
    const s = String(text || '');
    for (const m of s.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi)) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      const key = m[1].toLowerCase();
      if (vars[key]) parts.push(vars[key]);
      else parts.push({ missing: key });
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  }

  // Template → { text, missing[] }. Missing variables become "[name]".
  function fill(text, vars) {
    const missing = [];
    const out = fillParts(text, vars).map((p) => {
      if (typeof p === 'string') return p;
      if (!missing.includes(p.missing)) missing.push(p.missing);
      return `[${p.missing}]`;
    }).join('');
    // A line that only held empty variables (e.g. "{{linkedin}}" with no LinkedIn) is left as
    // "[linkedin]" on purpose: better to notice it than to send a half-finished signature.
    return { text: out, missing };
  }

  // The user's templates, with defaults for anything missing or invalid.
  function normalize(t = {}) {
    const str = (v, d) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : d);
    const fields = Array.isArray(t.fields) ? t.fields : DEFAULTS.fields;
    const keys = new Set();
    return {
      email: { subject: str(t.email?.subject, DEFAULTS.email.subject).slice(0, 300), body: str(t.email?.body, DEFAULTS.email.body) },
      coverLetter: { body: str(t.coverLetter?.body, DEFAULTS.coverLetter.body) },
      fields: fields
        .map((f) => ({ key: String(f?.key || '').trim().toLowerCase(), value: String(f?.value || '').slice(0, 500) }))
        .filter((f) => FIELD_KEY.test(f.key) && !BUILT_IN.has(f.key) && !keys.has(f.key) && keys.add(f.key))
        .slice(0, 30),
    };
  }

  // Both documents for one job.
  function fillAll(templates, job, profile, now) {
    const t = normalize(templates);
    const vars = variables(job, profile, t.fields, now);
    const subject = fill(t.email.subject, vars);
    const body = fill(t.email.body, vars);
    const letter = fill(t.coverLetter.body, vars);
    return {
      email: { subject: subject.text, body: body.text },
      coverLetter: letter.text,
      missing: [...new Set([...subject.missing, ...body.missing, ...letter.missing])],
    };
  }

  const api = { VARIABLES, DEFAULTS, FIELD_KEY, listJoin, spell, contactsOf, variables, fill, fillParts, normalize, fillAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.tpl = api;
})(typeof window !== 'undefined' ? window : globalThis);
