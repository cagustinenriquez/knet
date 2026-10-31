const test = require('node:test');
const assert = require('node:assert');
const { parseMarkdown } = require('../src/renderer/markdown');
const { auditPost } = require('../src/main/audit');

// Flatten a tree to readable text, e.g. "h2(About) p(We are b(Acme))".
const show = (nodes) => nodes.map((n) => {
  if (n.t === 'text') return n.v;
  if (n.t === 'br') return '/';
  if (n.t === 'code' || n.t === 'pre') return `${n.t}(${n.v})`;
  if (n.t === 'a') return `a[${n.href}](${show(n.c)})`;
  if (n.t === 'ul' || n.t === 'ol') return `${n.t}(${n.items.map((it) => `${it.task == null ? '' : it.task ? '[x]' : '[ ]'}${show(it.c)}`).join('|')})`;
  if (n.t === 'h') return `h${n.level}(${show(n.c)})`;
  if (n.t === 'hr') return 'hr';
  return `${n.t}(${show(n.c)})`;
}).join(nodes.some((n) => BLOCKS.has(n.t)) ? ' ' : '');
const BLOCKS = new Set(['p', 'h', 'ul', 'ol', 'quote', 'hr', 'pre']);

test('blocks: headings, paragraphs with line breaks, lists, quotes, rules, code', () => {
  assert.strictEqual(show(parseMarkdown('## About us\nWe are **Acme**.\nSecond line')), 'h2(About us) p(We are b(Acme)./Second line)');
  assert.strictEqual(show(parseMarkdown('- one\n- two\n  - nested\n- [x] done\n- [ ] todo')), 'ul(one|p(two) ul(nested)|[x]done|[ ]todo)');
  assert.strictEqual(show(parseMarkdown('1. Apply\n2. Interview')), 'ol(Apply|Interview)');
  assert.strictEqual(show(parseMarkdown('> quoted\n\n---\n\n```\nx = 1\n```')), 'quote(p(quoted)) hr pre(x = 1)');
  assert.strictEqual(show(parseMarkdown('Intro\n- a\n- b')), 'p(Intro) ul(a|b)');
});

test('inline: emphasis, code, links and bare URLs', () => {
  assert.strictEqual(show(parseMarkdown('*it* _it_ ~~no~~ `x*y`')), 'p(i(it) i(it) s(no) code(x*y))');
  assert.strictEqual(show(parseMarkdown('[site](https://acme.com) or https://acme.com/jobs.')),
    'p(a[https://acme.com](site) or a[https://acme.com/jobs](https://acme.com/jobs).)');
  assert.strictEqual(show(parseMarkdown('snake_case_name stays')), 'p(snake_case_name stays)');
  assert.strictEqual(show(parseMarkdown('**bold _and italic_**')), 'p(b(bold i(and italic)))');
});

test('unsafe content stays text', () => {
  assert.strictEqual(show(parseMarkdown('<script>alert(1)</script>')), 'p(<script>alert(1)</script>)');
  assert.ok(!JSON.stringify(parseMarkdown('[x](javascript:alert(1))')).includes('"t":"a"'));
  assert.ok(!JSON.stringify(parseMarkdown('[x](data:text/html,hi)')).includes('"t":"a"'));
  assert.strictEqual(show(parseMarkdown('[mail](mailto:jobs@acme.com)')), 'p(a[mailto:jobs@acme.com](mail))');
});

test('stays fast on hostile input', () => {
  const t = Date.now();
  parseMarkdown('`a` '.repeat(5000) + '_x_ '.repeat(3000));
  parseMarkdown('**'.repeat(10000));
  parseMarkdown('>'.repeat(5000) + ' deep');
  parseMarkdown(Array.from({ length: 2000 }, (_, i) => `${' '.repeat(i % 40)}- item`).join('\n'));
  assert.ok(Date.now() - t < 2000, `${Date.now() - t}ms`);
});

test('job posts: shortened links inside the description fail the check', () => {
  const post = { title: 'Backend Engineer', company: 'Acme', location: 'LATAM', apply: 'mailto:jobs@acme.com',
    description: `${'Build APIs with Python. '.repeat(8)}Details: https://bit.ly/abc` };
  assert.ok(auditPost(post).checks.some((c) => c.id === 'desclinks' && c.status === 'fail'));
  assert.ok(!auditPost({ ...post, description: post.description.replace('https://bit.ly/abc', '[site](https://acme.com)') }).checks.some((c) => c.id === 'desclinks'));
});
