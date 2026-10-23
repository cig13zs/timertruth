/* TimerTruth - finds countdowns, live counters, stock claims and "ends today"
 * claims in a page.
 *
 * Selector-free on purpose, same as Per Piece: Shopee, Lazada and Temu ship
 * obfuscated class names that rotate on deploy. Candidates are found by the
 * shape of their text, and each one is the SMALLEST element whose text still
 * parses, so "Flash sale ends in <b>09:58</b>" resolves to the <b>.
 *
 * Only touches a small slice of the DOM API (children, childNodes, nodeValue,
 * parentElement, getAttribute, getElementsByTagName, tagName) so the tests can
 * run it against fixture HTML in Node without a browser.
 */
(function () {
  'use strict';
  const NODE = typeof module === 'object' && module !== null && !!module.exports;
  const P = NODE ? require('./parse.js') : globalThis.TT.parse;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'INPUT',
    'TEXTAREA', 'SELECT', 'OPTION', 'HEAD', 'TITLE', 'IFRAME', 'VIDEO', 'AUDIO', 'TIMERTRUTH-LAYER']);
  const TIMER = 1, COUNTER = 2, STOCK = 4, TODAY = 8;
  const LONG = 400;          // longer than this and an element is a container, not a claim
  const CONTEXT_MAX = 220;   // how much surrounding text may count as a timer's label
  const MAY_UNITS = /\d\s*(?:d|h|m|s|days?|hours?|hrs?|min|sec)/i;
  const MAY_COUNTER = /view|look|watch|brows|checking|cart|bought|purchas|order|sold/i;
  const MAY_STOCK = /left|remain|stock|availab/i;
  const MAY_TODAY = /today|tonight|midnight|last day/i;
  const MEDIA_ATTR = /\b(?:video|player|vjs|plyr|jwplayer|media-?controls?)\b/i;

  const isOurs = (el) => el.getAttribute && el.getAttribute('data-tt') !== null;

  function attrs(el) {
    if (!el.getAttribute) return '';
    return ['class', 'id', 'data-testid', 'data-test', 'aria-label']
      .map((a) => el.getAttribute(a) || '').join(' ');
  }

  // Text of an element with script and style skipped, both run together (as
  // textContent would) and with a space at every node boundary, which is the
  // only way to read digit boxes that carry no separator.
  function readText(el, memo) {
    let compact = '';
    const parts = [];
    let long = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const v = n.nodeValue || '';
        compact += v;
        if (v.trim()) parts.push(v.trim());
      } else if (n.nodeType === 1) {
        if (SKIP.has(String(n.tagName).toUpperCase()) || isOurs(n)) continue;
        const sub = memo && memo.has(n) ? memo.get(n) : readText(n, memo);
        if (!sub) { long = true; break; }
        compact += sub.raw;
        if (sub.spaced) parts.push(sub.spaced);
      }
      if (compact.length > LONG) { long = true; break; }
    }
    const raw = compact.replace(/\s+/g, ' ');
    const out = long ? null : {
      raw,
      compact: raw.trim(),
      spaced: parts.join(' ').replace(/\s+/g, ' ').trim(),
    };
    if (memo) memo.set(el, out);
    return out;
  }

  function hrefPath(href) {
    try { return new URL(href, 'https://x.invalid').pathname.replace(/\/+$/, '') || '/'; }
    catch { return ''; }
  }

  // The product a candidate belongs to on a grid: the link wrapping its tile.
  // Without it, a reshuffled search page would pair one product's timer with
  // another's and call the difference a reset.
  function anchorOf(el) {
    for (let n = el, i = 0; n && i < 10; n = n.parentElement, i++) {
      if (String(n.tagName).toUpperCase() === 'A' && n.getAttribute('href')) return hrefPath(n.getAttribute('href'));
    }
    return '';
  }

  // A player's "time left in this clip" counts down and restarts on reload,
  // exactly like a fake. Only ancestors that are still small (a control bar,
  // not the whole product section that happens to hold a video) are checked.
  function nearMedia(el, memo) {
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      const t = memo.has(n) ? memo.get(n) : readText(n, memo);
      if (!t || t.compact.length > 60) break;
      if (MEDIA_ATTR.test(attrs(n))) return true;
      if (n.getElementsByTagName && (n.getElementsByTagName('video').length || n.getElementsByTagName('audio').length)) return true;
    }
    return false;
  }

  // Walk up through short ancestors looking for the words that make this a
  // sale deadline, and for the words that make it something else.
  function timerContextOf(el, memo) {
    let keyword = null, label = '', excluded = false, timerish = false;
    for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
      if (P.isTimerish(attrs(n))) timerish = true;
    }
    // The nearest words win: climb until a level says "deadline" or says
    // "delivery cut-off / OTP / video", and stop there. Otherwise a product
    // block that mentions "Order within" would veto its own sale timer.
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      const t = memo.has(n) ? memo.get(n) : readText(n, memo);
      if (!t || t.compact.length > CONTEXT_MAX) break;
      const ctx = P.timerContext(t.compact);
      if (ctx.excluded) { excluded = true; break; }
      if (ctx.keyword) { keyword = ctx.keyword; label = P.normLabel(t.compact); break; }
    }
    return { keyword, label: label || 'timer', excluded, timerish };
  }

  /* Every candidate under root, in document order:
   *   { el, kind: 'timer'|'viewers'|'carts'|'bought'|'stock'|'today', key, label,
   *     text, parsed, anchor, keyword?, timerish? }
   * key is stable across reloads of the same page; it never includes a value.
   */
  function scan(root) {
    const memo = new Map();
    const found = [];

    function visit(el) {
      const tag = String(el.tagName).toUpperCase();
      if (SKIP.has(tag) || isOurs(el)) return 0;
      let mask = 0;
      for (const c of el.children) mask |= visit(c);
      const t = readText(el, memo);
      if (!t || !t.compact || t.compact.length > 160) return mask;
      const text = t.compact;
      // Cheap gates first: on a big grid almost every element fails all of
      // them, and the full parsers never run.
      if (/\d/.test(text)) {
        if (!(mask & TIMER) && (text.includes(':') || MAY_UNITS.test(text) || /^[\d\s]{6,}$/.test(text))) {
          const p = P.parseCountdown(text, t.spaced);
          if (p) { found.push({ el, kind: 'timer', text, parsed: p }); mask |= TIMER; }
        }
        if (!(mask & COUNTER) && MAY_COUNTER.test(text)) {
          const c = P.parseCounter(text);
          if (c) { found.push({ el, kind: c.kind, text, parsed: c }); mask |= COUNTER; }
        }
        if (!(mask & STOCK) && MAY_STOCK.test(text)) {
          const s = P.parseStock(text);
          if (s) { found.push({ el, kind: 'stock', text, parsed: s }); mask |= STOCK; }
        }
      }
      if (!(mask & TODAY) && MAY_TODAY.test(text) && P.claimsEndsToday(text)) {
        found.push({ el, kind: 'today', text, parsed: {} });
        mask |= TODAY;
      }
      return mask;
    }
    visit(root);

    const out = [];
    for (const c of found) {
      if (c.kind === 'timer') {
        if (nearMedia(c.el, memo)) continue;
        const ctx = timerContextOf(c.el, memo);
        if (ctx.excluded) continue;
        // A seconds-precision timer is only kept if something says it is a
        // timer; whether it really counts down is checked by watching it.
        if (!ctx.keyword && !ctx.timerish) continue;
        Object.assign(c, { label: ctx.label, keyword: ctx.keyword, timerish: ctx.timerish });
      } else if (c.kind === 'bought') {
        c.label = `bought per ${c.parsed.window}`;
      } else if (c.kind === 'today') {
        c.label = P.normLabel(c.text);
      } else {
        c.label = c.kind;
      }
      c.anchor = anchorOf(c.el);
      out.push(c);
    }

    // Number repeats so two identical timers on one page keep separate
    // histories. The group size is part of the key: if the page shows a
    // different number of them next time, they start fresh instead of being
    // compared with the wrong partner.
    const groups = new Map();
    for (const c of out) {
      const g = `${c.kind}|${c.label}|${c.anchor}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    for (const [g, list] of groups) list.forEach((c, i) => { c.key = `${g}|${i + 1}/${list.length}`; });
    return out;
  }

  const api = { scan, readText, anchorOf };
  if (NODE) module.exports = api;
  else globalThis.TT.scan = api;
})();
