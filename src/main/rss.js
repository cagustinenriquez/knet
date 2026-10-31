// RSS / Atom job feeds. Many job boards publish one (e.g. We Work Remotely).
// A tiny tolerant parser: job feeds are simple, and a full XML library isn't needed.

const crypto = require('crypto');
const { stripHtml } = require('./text');

const MAX_XML = 3_000_000;
const MAX_ITEMS = 500;

const decode = (s = '') => s
  .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
  .trim();

// First <name>…</name> in a block (name may include a namespace, e.g. "dc:creator").
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]{0,500})?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}
const tags = (block, name) => [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]{0,500})?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => decode(m[1]));

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]{0,1000})\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0];
  const href = pick?.match(/href=["']([^"']+)["']/i);
  return href ? decode(href[1]) : '';
}

const isFeed = (text) => /^(?:\s|<\?xml[^>]*>|<!--[\s\S]*?-->)*<(?:rss|feed|rdf:RDF)\b/i.test(text.slice(0, 5000));

// → [{ guid, title, link, description, date, categories, location, company }]
function parseFeed(xml) {
  const text = xml.slice(0, MAX_XML);
  // Linear scan for <item>…</item> / <entry>…</entry>; a regex here can blow up on broken feeds.
  const blocks = [];
  const open = /<(item|entry)(?=[\s>])/gi;
  let m;
  while (blocks.length < MAX_ITEMS && (m = open.exec(text))) {
    const kind = m[1];
    const close = new RegExp(`</${kind}>`, 'gi'); // kind is "item" or "entry"
    close.lastIndex = open.lastIndex;
    const c = close.exec(text);
    if (!c) break;
    const end = c.index;
    const start = text.indexOf('>', open.lastIndex) + 1;
    blocks.push([null, kind, text.slice(start, end)]);
    open.lastIndex = end;
  }
  return blocks.map(([, kind, b]) => {
    const atom = kind.toLowerCase() === 'entry';
    return {
      guid: tag(b, atom ? 'id' : 'guid'),
      title: stripHtml(tag(b, 'title')),
      link: atom ? atomLink(b) : (tag(b, 'link') || atomLink(b)),
      description: tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'content') || tag(b, 'summary'),
      date: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'),
      categories: [...tags(b, 'category'), ...[...b.matchAll(/<category\b[^>]{0,500}term=["']([^"']+)["']/gi)].map((m) => decode(m[1]))],
      location: tag(b, 'location') || tag(b, 'job_listing:location') || tag(b, 'region') || tag(b, 'country'),
      company: tag(b, 'company') || tag(b, 'job_listing:company') || tag(b, 'company_name'),
    };
  });
}

// The feed's own name: the first <title> before any item.
function feedTitle(xml) {
  const head = xml.slice(0, 200_000).split(/<(?:item|entry)(?=[\s>])/i)[0];
  return stripHtml(tag(head, 'title')).slice(0, 100);
}

const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// Feed URL ↔ slug. Job ids are split on ":", so the slug is the URL without "https://".
function feedSlug(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Feeds must use https://');
  if (u.port) throw new Error('Feeds on custom ports are not supported');
  return `${u.host}${u.pathname}${u.search}`;
}
const feedUrl = (slug) => `https://${slug}`;

// Feed items → shared job shape (see sources.js).
function feedToJobs(items, slug, feedName) {
  // Boards like We Work Remotely title items "Company: Job title".
  const split = items.length && items.filter((i) => /^[^:]{2,60}:\s+\S/.test(i.title)).length / items.length >= 0.8;
  return items.filter((i) => i.title && /^https?:\/\//i.test(i.link)).map((i) => {
    let { title, company } = i;
    if (!company && split) [, company, title] = i.title.match(/^([^:]{2,60}):\s+(.+)$/) || [, '', i.title];
    const location = stripHtml(i.location);
    const description = stripHtml(i.description).slice(0, 8000);
    const t = new Date(i.date);
    return {
      id: `rss:${slug}:${shortHash(i.guid || i.link || i.title)}`,
      title: title.trim(),
      company: (company || feedName).trim(),
      location,
      remote: /\bremot[eo]\b|anywhere|worldwide/i.test(`${location} ${title}`),
      tags: [...new Set(i.categories.map((c) => stripHtml(c)).filter((c) => c && c.length <= 40))].slice(0, 15),
      description,
      url: i.link,
      postedAt: Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString(),
    };
  });
}

module.exports = { feedTitle, isFeed, parseFeed, feedSlug, feedUrl, feedToJobs };
