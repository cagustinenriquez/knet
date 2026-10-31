// Small, safe Markdown renderer for job descriptions.
// parseMarkdown() turns text into a plain tree (unit tested in Node); toDom() builds DOM
// nodes from it with createElement/textContent only. Raw HTML is never interpreted: it
// shows as text. Links work only for http(s) and mailto URLs.
//
// Supported: # headings, paragraphs (single newlines = line breaks), **bold**, *italic*,
// ~~strike~~, `code`, ``` code blocks ```, - / 1. lists (nested by indent), [ ] task items,
// > quotes, --- rules, [links](https://…) and bare https:// links.

(function (root) {
  const MAX_INPUT = 20000;
  const MAX_DEPTH = 6;

  const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const FENCE = /^\s{0,3}(```|~~~)/;
  const QUOTE = /^\s{0,3}>\s?(.*)$/;
  const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length;
  const isBlockStart = (l) => HEADING.test(l) || RULE.test(l) || FENCE.test(l) || QUOTE.test(l) || LIST_ITEM.test(l);

  function parseBlocks(lines, depth = 0) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if (FENCE.test(line)) {
        const fence = line.trim().slice(0, 3);
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
        i++; // closing fence
        out.push({ t: 'pre', v: body.join('\n') });
      } else if ((m = line.match(HEADING))) {
        out.push({ t: 'h', level: m[1].length, c: parseInline(m[2]) });
        i++;
      } else if (RULE.test(line)) {
        out.push({ t: 'hr' });
        i++;
      } else if (QUOTE.test(line)) {
        const inner = [];
        while (i < lines.length && (m = lines[i].match(QUOTE))) { inner.push(m[1]); i++; }
        out.push({ t: 'quote', c: depth < MAX_DEPTH ? parseBlocks(inner, depth + 1) : [{ t: 'p', c: [{ t: 'text', v: inner.join(' ') }] }] });
      } else if (LIST_ITEM.test(line)) {
        const r = parseList(lines, i, depth);
        out.push(r.node);
        i = r.next;
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) para.push(lines[i++].trim());
        out.push({ t: 'p', c: para.flatMap((l, k) => (k ? [{ t: 'br' }, ...parseInline(l)] : parseInline(l))) });
      }
    }
    return out;
  }

  // A run of list items at one indent; deeper-indented lines belong to the previous item.
  function parseList(lines, start, depth) {
    const first = lines[start].match(LIST_ITEM);
    const base = indentOf(first[1]);
    const ordered = /\d/.test(first[2]);
    const node = { t: ordered ? 'ol' : 'ul', start: ordered ? parseInt(first[2], 10) : 1, items: [] };
    let i = start;
    while (i < lines.length) {
      const m = lines[i].match(LIST_ITEM);
      if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
      const body = [m[3]];
      i++;
      // Continuation lines: indented deeper than the bullet, or a lazy line right after.
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          if (i + 1 < lines.length && lines[i + 1].trim() && indentOf(lines[i + 1]) > base) { body.push(''); i++; continue; }
          break;
        }
        const sub = l.match(LIST_ITEM);
        if (sub && indentOf(sub[1]) <= base) break;
        if (!sub && indentOf(l) <= base && isBlockStart(l)) break;
        body.push(indentOf(l) > base ? l.replace(/\t/g, '    ').slice(Math.min(indentOf(l), base + 2)) : l);
        i++;
      }
      let task = null;
      const tm = body[0].match(/^\[([ xX])\]\s+(.*)$/);
      if (tm) { task = tm[1] !== ' '; body[0] = tm[2]; }
      const blocks = depth < MAX_DEPTH ? parseBlocks(body, depth + 1) : [{ t: 'p', c: [{ t: 'text', v: body.join(' ') }] }];
      // A one-paragraph item renders inline (no <p> spacing).
      node.items.push({ task, c: blocks.length === 1 && blocks[0].t === 'p' ? blocks[0].c : blocks, inline: blocks.length === 1 && blocks[0].t === 'p' });
      while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST_ITEM.test(lines[i + 1]) && indentOf(lines[i + 1].match(LIST_ITEM)[1]) === base) i++;
    }
    return { node, next: i };
  }

  const safeHref = (url) => {
    const u = String(url).trim();
    return /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+)$/i.test(u) ? u : null;
  };

  // Inline: earliest match wins; emphasis/link text is parsed recursively.
  const INLINE = [
    ['code', /`([^`\n]{1,500})`/],
    ['link', /\[([^\]\n]{1,300})\]\(([^)\s]{1,800})(?:\s+"[^"]{0,200}")?\)/],
    ['auto', /\bhttps?:\/\/[^\s<>()[\]"']{2,800}[^\s<>()[\]"'.,;:!?]/],
    ['b', /\*\*(?=\S)([^\n]{0,500}?\S)\*\*|__(?=\S)([^\n]{0,500}?\S)__(?![a-z0-9])/i],
    ['s', /~~(?=\S)([^\n]{0,500}?\S)~~/],
    ['i', /\*(?=[^\s*])([^*\n]{0,500}?[^\s*])\*|(?<![a-z0-9])_(?=\S)([^_\n]{0,500}?\S)_(?![a-z0-9])/i],
  ];

  function parseInline(text, depth = 0) {
    const src = String(text);
    const out = [];
    // Each pattern's next match is cached and only searched again once we've moved past
    // it, so a long line is scanned a handful of times, not once per token.
    const state = INLINE.map(([type, re]) => ({ type, re: new RegExp(re.source, `${re.flags}g`), m: undefined }));
    let pos = 0;
    while (pos < src.length) {
      let best = null;
      for (const st of state) {
        if (st.m === null) continue; // no more matches for this pattern
        if (st.m === undefined || st.m.index < pos) { st.re.lastIndex = pos; st.m = st.re.exec(src); }
        if (st.m && (!best || st.m.index < best.m.index)) best = st;
      }
      if (!best) { out.push({ t: 'text', v: src.slice(pos) }); break; }
      const { type, m } = best;
      if (m.index > pos) out.push({ t: 'text', v: src.slice(pos, m.index) });
      const inner = (s) => (depth < MAX_DEPTH ? parseInline(s, depth + 1) : [{ t: 'text', v: s }]);
      if (type === 'code') out.push({ t: 'code', v: m[1] });
      else if (type === 'link') {
        const href = safeHref(m[2]);
        out.push(href ? { t: 'a', href, c: inner(m[1]) } : { t: 'text', v: m[0] });
      } else if (type === 'auto') out.push({ t: 'a', href: m[0], c: [{ t: 'text', v: m[0] }] });
      else out.push({ t: type, c: inner(m[1] ?? m[2]) });
      pos = m.index + m[0].length;
    }
    return out;
  }

  function parseMarkdown(text) {
    const src = String(text ?? '').slice(0, MAX_INPUT).replace(/\r\n?/g, '\n');
    return parseBlocks(src.split('\n'));
  }

  // ---------- DOM (browser only) ----------

  function toDom(nodes, opts = {}) {
    const frag = document.createDocumentFragment();
    for (const n of nodes) frag.append(node(n, opts));
    return frag;
  }

  function el(tag, children, opts, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (children) e.append(toDom(children, opts));
    return e;
  }

  function node(n, opts) {
    switch (n.t) {
      case 'text': return document.createTextNode(n.v);
      case 'br': return document.createElement('br');
      case 'b': return el('strong', n.c, opts);
      case 'i': return el('em', n.c, opts);
      case 's': return el('s', n.c, opts);
      case 'code': { const e = document.createElement('code'); e.textContent = n.v; return e; }
      case 'a': {
        const a = el('a', n.c, opts);
        a.href = '#';
        a.title = n.href;
        a.addEventListener('click', (e) => { e.preventDefault(); opts.openUrl?.(n.href); });
        return a;
      }
      case 'p': return el('p', n.c, opts);
      case 'h': return el(`h${Math.min(6, n.level + 2)}`, n.c, opts, 'md-h'); // h3–h6: stay below the job title
      case 'hr': return document.createElement('hr');
      case 'pre': { const pre = document.createElement('pre'); const c = document.createElement('code'); c.textContent = n.v; pre.append(c); return pre; }
      case 'quote': return el('blockquote', n.c, opts);
      case 'ul': case 'ol': {
        const list = document.createElement(n.t);
        if (n.t === 'ol' && n.start !== 1) list.start = n.start;
        for (const it of n.items) {
          const li = el('li', it.c, opts, it.task == null ? '' : 'task');
          if (it.task != null) {
            const box = document.createElement('span');
            box.className = `md-check${it.task ? ' done' : ''}`;
            box.textContent = it.task ? '✓' : '';
            li.prepend(box);
          }
          list.append(li);
        }
        return list;
      }
      default: return document.createTextNode('');
    }
  }

  const api = { parseMarkdown, toDom, renderMarkdown: (text, opts) => toDom(parseMarkdown(text), opts) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.md = api;
})(typeof window !== 'undefined' ? window : globalThis);
