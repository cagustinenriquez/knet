// Small text helpers shared by sources and the matcher.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

// Some feeds send UTF-8 that was decoded as Latin-1 ("â\x80\x94" instead of "—").
// Re-decode just those byte runs; leave the text alone if it doesn't decode cleanly.
function fixMojibake(s) {
  return s.replace(/[\xC2-\xF4][\x80-\xBF]{1,3}/g, (run) => {
    const fixed = Buffer.from(run, 'latin1').toString('utf8');
    return fixed.includes('�') ? run : fixed;
  });
}

function stripHtml(html = '') {
  return fixMojibake(String(html))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e[0] === '#') {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches a term as a whole "word", treating + # . as part of words so that
// "c++", "c#", ".net" and "node.js" work, while "java" doesn't match "javascript".
function termRegex(term) {
  return new RegExp(`(?<![a-z0-9+#])${escapeRe(term.toLowerCase())}(?![a-z0-9+#]|\\.[a-z0-9])`, 'i');
}

module.exports = { stripHtml, termRegex, fixMojibake };
