// Just enough DOM to run src/lib/scan.js over fixture HTML in Node: elements, text nodes,
// attributes, children, parentElement, getElementsByTagName. Fixtures are well formed, so the
// parser only needs to handle void elements, comments, raw-text script/style and a few entities.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', middot: '·', hellip: '…' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});

class Text {
  constructor(v) { this.nodeType = 3; this.nodeValue = v; this.parentElement = null; }
}

class Element {
  constructor(tag, attrs = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.childNodes = [];
    this.parentElement = null;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  getAttribute(n) { const k = n.toLowerCase(); return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  get id() { return this.getAttribute('id') || ''; }
  get textContent() { return this.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join(''); }
  append(n) { n.parentElement = this; this.childNodes.push(n); }
  getElementsByTagName(t) {
    const want = t.toUpperCase();
    const out = [];
    const walk = (e) => { for (const c of e.children) { if (c.tagName === want) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  find(pred) {
    for (const c of this.children) { if (pred(c)) return c; const r = c.find(pred); if (r) return r; }
    return null;
  }
  byId(id) { return this.find((e) => e.id === id); }
}

function parseAttrs(src) {
  const out = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function parse(html) {
  const doc = new Element('#document');
  let cur = doc;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let n = cur; n && n !== doc; n = n.parentElement) {
        if (n.tagName === tag) { cur = n.parentElement; break; }
      }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const el = new Element(tag, parseAttrs(m[3] || ''));
      cur.append(el);
      if (RAW.has(tag)) {
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        const stop = end < 0 ? html.length : end;
        el.append(new Text(html.slice(re.lastIndex, stop)));
        re.lastIndex = stop;
      } else if (!VOID.has(tag) && !m[4]) {
        cur = el;
      }
    } else if (m[5]) {
      cur.append(new Text(decode(m[5])));
    }
  }
  doc.body = doc.find((e) => e.tagName === 'BODY') || doc;
  return doc;
}

module.exports = { parse, Element, Text };
