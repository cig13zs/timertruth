/* TimerTruth - text parsers. Pure functions, no DOM.
 *
 * Loaded as a plain script before scan.js (which reads TT.parse) and
 * require()d by the tests. Everything here answers one question about a short
 * piece of text: is this a countdown, a "people viewing" counter, a low-stock
 * claim or an "ends today" claim, and what number does it show?
 *
 * Rule that outranks coverage: a wrong FAKE stamp on a real sale is worse than
 * a missed fake. When text is ambiguous these return null.
 */
(function () {
  'use strict';
  const NODE = typeof module === 'object' && module !== null && !!module.exports;

  // ---- numbers ---------------------------------------------------------------

  // "17", "1,234", "1.234", "1.2k", "2K+", "12 k"
  function toCount(s) {
    if (s == null) return null;
    const t = String(s).trim().replace(/\+$/, '').trim();
    const k = /^(\d+(?:[.,]\d+)?)\s*[kK]$/.exec(t);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    if (/^\d{1,3}(?:[,.\s]\d{3})+$/.test(t)) return parseInt(t.replace(/[,.\s]/g, ''), 10);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return null;
  }

  // ---- countdowns --------------------------------------------------------------

  const UNIT_SEC = {
    d: 86400, day: 86400, days: 86400,
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
    m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  };
  // Long forms can stand alone ("Ends in 3 days"). A lone "3d" or "45s" is far
  // more likely to be something else (a pack size, a model name), so single
  // letters only count when two or more units appear together.
  const LONG_UNIT = /^(?:days?|hours?|hrs?|minutes?|mins?)$/i;
  const UNIT_RE = /(\d{1,3})\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;
  const UNIT_GAP = /^[\s:,\-]*(?:and)?[\s:,\-]*$/i;

  // h:mm:ss or d:hh:mm:ss, digits possibly in their own boxes ("01 : 23 : 45").
  const CLOCK_RE = /(?<![\d:.])(\d{1,3})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?(?![\d:])/g;
  const DAYS_BEFORE = /(\d{1,3})\s*(?:d|days?|day\(s\))[\s,:]*$/i;
  // mm:ss. Same shape as a clock time ("10:30") or a video length, so it is
  // only ever accepted later if it is seen ticking down.
  const MMSS_RE = /(?<![\d:.])(\d{1,2})\s*:\s*(\d{2})(?![\d:])/g;
  // Digit boxes with no separators at all: "01 23 45", read from text nodes
  // joined with spaces. Only used when the element holds nothing but digits.
  const BOX_RE = /^(?:(\d{1,2})\s+)?(\d{2})\s+(\d{2})\s+(\d{2})$/;

  function allMatches(re, text) {
    re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = re.exec(text))) out.push(m);
    return out;
  }

  function fromClock(m, text) {
    let d = 0, h, mi, s;
    if (m[4] !== undefined) { d = +m[1]; h = +m[2]; mi = +m[3]; s = +m[4]; if (h > 23) return null; }
    else {
      h = +m[1]; mi = +m[2]; s = +m[3];
      const before = DAYS_BEFORE.exec(text.slice(0, m.index));
      if (before) d = +before[1];
    }
    if (mi > 59 || s > 59) return null;
    return { seconds: d * 86400 + h * 3600 + mi * 60 + s, gran: 1, form: 'clock', groups: m[4] !== undefined ? 4 : 3 };
  }

  function fromUnits(text) {
    const ms = allMatches(UNIT_RE, text);
    if (!ms.length) return null;
    // Take the first contiguous, strictly descending run of units.
    let run = [ms[0]];
    for (let i = 1; i < ms.length; i++) {
      const prev = ms[i - 1];
      const gap = text.slice(prev.index + prev[0].length, ms[i].index);
      const desc = UNIT_SEC[ms[i][2].toLowerCase()] < UNIT_SEC[prev[2].toLowerCase()];
      if (UNIT_GAP.test(gap) && desc) run.push(ms[i]);
      else break;
    }
    if (run.length === 1 && !LONG_UNIT.test(run[0][2])) return null;
    let seconds = 0, gran = Infinity;
    for (const m of run) {
      const u = UNIT_SEC[m[2].toLowerCase()];
      const n = +m[1];
      if ((u === 60 || u === 1) && run.length > 1 && n > 59) return null;
      if (u === 3600 && run.length > 1 && run[0] !== m && n > 23) return null;
      seconds += n * u;
      gran = Math.min(gran, u);
    }
    return { seconds, gran, form: 'units', groups: run.length };
  }

  /* Remaining time shown by a countdown, or null.
   *   text   - textContent, whitespace collapsed
   *   spaced - optional: the element's text nodes joined with spaces, which
   *            is the only way to see "01 23 45" when every pair is its own box
   * gran is the smallest unit on screen in seconds: 1 when seconds tick, 60 for
   * "2h 13m", 86400 for "3 days". Callers use it as the measuring error.
   */
  function parseCountdown(text, spaced) {
    if (!text) return null;
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length > 120) return null;

    const clocks = allMatches(CLOCK_RE, t);
    if (clocks.length > 1) return null;             // two timers in one box: let the children speak
    if (clocks.length === 1) return fromClock(clocks[0], t);

    const units = fromUnits(t);
    if (units) return units;

    const mmss = allMatches(MMSS_RE, t);
    if (mmss.length === 1) {
      const mi = +mmss[0][1], s = +mmss[0][2];
      if (s > 59) return null;
      return { seconds: mi * 60 + s, gran: 1, form: 'mmss', groups: 2 };
    }
    if (mmss.length > 1) return null;

    if (spaced && /^[\d\s]+$/.test(t)) {
      let sp = String(spaced).replace(/\s+/g, ' ').trim();
      // One box per digit ("0 1 2 3 4 5"): pair them up.
      if (/^(?:\d ){5}\d$|^(?:\d ){7}\d$/.test(sp)) sp = sp.replace(/ /g, '').replace(/(\d\d)(?=\d)/g, '$1 ');
      const b = BOX_RE.exec(sp);
      if (b) {
        const d = b[1] ? +b[1] : 0, h = +b[2], mi = +b[3], s = +b[4];
        if (mi > 59 || s > 59 || (b[1] && h > 23)) return null;
        return { seconds: d * 86400 + h * 3600 + mi * 60 + s, gran: 1, form: 'boxes', groups: b[1] ? 4 : 3 };
      }
    }
    return null;
  }

  // Words that make a number read as a sale deadline rather than a clock time.
  const TIMER_WORDS = /\b(?:ends?|ending|expires?|expiring|left|remaining|remain|countdown|count down|hurry|limited[- ]time|flash|deal|sale|offer|promo|discount|price|closes?|closing|last chance|time left|starts?|begins?|reserved|held|hold|timer|matatapos|natitira)\b/i;
  // Countdowns that are real by nature, or not about a price at all. Delivery
  // cut-offs ("Order within 3 hrs 12 mins") restart every day by design; OTP
  // and session timers restart on every load by design; video players count
  // down the time left in the clip.
  const TIMER_EXCLUDE = /\b(?:order within|order in the next|within the next|delivery|deliver(?:ed|s|y)?|arrives?|get it (?:by|on|tomorrow|today)|dispatch(?:es|ed)?|pick ?up|video|duration|elapsed|ago|posted|updated|min read|episode|live stream|replay|otp|resend|verification|code expires|session|log ?in|sign ?in|auction|bid)\b/i;
  const TIMERISH = /count-?down|timer|time-?left|time-?remaining|remaining|deadline|clock|flash-?sale/i;

  function timerContext(text) {
    const t = String(text || '');
    const kw = TIMER_WORDS.exec(t);
    return { keyword: kw ? kw[0].toLowerCase() : null, excluded: TIMER_EXCLUDE.test(t) };
  }

  const isTimerish = (attrs) => TIMERISH.test(String(attrs || ''));

  // ---- counters ----------------------------------------------------------------

  const NUM = String.raw`(\d[\d,.]*\s*[kK]?\+?)`;
  const WHO = String.raw`(?:(?:people|persons|shoppers|customers|others|other people|users|visitors|buyers)\s+)?`;
  const VIEWERS_RE = new RegExp(String.raw`(?<![\d.,])${NUM}\s+${WHO}(?:are\s+|is\s+)?(?:currently\s+|now\s+|right now\s+)?(?:viewing|looking at|watching|browsing|checking out)\b`, 'i');
  const VIEWERS_RE2 = /\b(?:viewing (?:this )?(?:right )?now|watching now)\s*[:\-]?\s*(\d[\d,]*)\b/i;
  const CARTS_RE = new RegExp(String.raw`(?<![\d.,])${NUM}\s+${WHO}(?:have|has)\s+(?:this|it)\s+in\s+(?:their\s+)?carts?\b`, 'i');
  const CARTS_RE2 = /\bin\s+(\d[\d,]*\+?)\s+(?:other\s+)?(?:people'?s\s+|shoppers'?\s+)?carts\b/i;
  const WINDOW = String.raw`(?:(\d+)\s*)?(minutes?|mins?|hours?|hrs?|h|day|days|24\s*h(?:ours|rs)?|week|weeks|month|months)`;
  const BOUGHT_RE = new RegExp(String.raw`(?<![\d.,])${NUM}\s+${WHO}(?:have\s+|has\s+)?(?:bought|purchased|ordered|sold)\s+(?:this\s+|it\s+)?(?:item\s+)?(?:in\s+)?(?:the\s+)?(?:last|past)\s+${WINDOW}\b`, 'i');
  const BOUGHT_RE2 = new RegExp(String.raw`\b(?:sold|bought|purchased)\s+(\d[\d,]*)\s+(?:times\s+)?in\s+(?:the\s+)?(?:last|past)\s+${WINDOW}\b`, 'i');

  function windowLabel(n, unit) {
    const u = unit.toLowerCase().replace(/\s+/g, '');
    if (/^24h/.test(u)) return '24 hours';
    const base = /^m(in|inute)/.test(u) ? 'minute' : /^h/.test(u) ? 'hour' : /^d/.test(u) ? 'day' : /^w/.test(u) ? 'week' : 'month';
    return n && +n !== 1 ? `${n} ${base}s` : base;
  }

  /* "23 people are viewing this", "In 12 carts", "50+ bought in the past hour".
   * Returns { kind: 'viewers' | 'carts' | 'bought', value, window? } or null.
   * A plain "10k sold" is a lifetime total, not a live counter, and is ignored.
   */
  function parseCounter(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 140) return null;
    let m;
    if ((m = BOUGHT_RE.exec(t))) {
      const v = toCount(m[1]);
      return v == null ? null : { kind: 'bought', value: v, window: windowLabel(m[2], m[3]) };
    }
    if ((m = BOUGHT_RE2.exec(t))) {
      const v = toCount(m[1]);
      return v == null ? null : { kind: 'bought', value: v, window: windowLabel(m[2], m[3]) };
    }
    if ((m = CARTS_RE.exec(t) || CARTS_RE2.exec(t))) {
      const v = toCount(m[1]);
      return v == null ? null : { kind: 'carts', value: v };
    }
    if ((m = VIEWERS_RE.exec(t) || VIEWERS_RE2.exec(t))) {
      const v = toCount(m[1]);
      return v == null ? null : { kind: 'viewers', value: v };
    }
    return null;
  }

  // ---- stock -------------------------------------------------------------------

  const ITEMS = String.raw`(?:(?:items?|pcs|pieces?|units?|pairs?|sets?)\s+)?`;
  const STOCK_RES = [
    new RegExp(String.raw`\bonly\s+(\d{1,4})\s+${ITEMS}(?:left|remaining|in stock|available)\b`, 'i'),
    new RegExp(String.raw`\b(\d{1,4})\s+${ITEMS}(?:left|remaining)\s+in\s+stock\b`, 'i'),
    new RegExp(String.raw`\b(?:low stock|almost gone|selling fast|hurry)\b[:!,.\s-]+(\d{1,4})\s+${ITEMS}(?:left|remaining)\b`, 'i'),
  ];

  // "Only 3 left in stock", "Only 2 items left", "Hurry! 4 left". Not "3 days left".
  function parseStock(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 140) return null;
    for (const re of STOCK_RES) {
      const m = re.exec(t);
      if (m) return { value: +m[1] };
    }
    return null;
  }

  // ---- "ends today" --------------------------------------------------------------

  const TODAY_RE = /\b(?:ends?|ending|expires?)\s+(?:today|tonight|at midnight)\b|\btoday only\b|\bonly today\b|\blast day\b|\bends in today\b/i;
  const claimsEndsToday = (text) => {
    const t = String(text || '');
    return t.length <= 160 && TODAY_RE.test(t) && !TIMER_EXCLUDE.test(t);
  };

  // A stable name for a counter or timer, built from the words around it with
  // every digit removed, so "Flash sale ends in 09:58" and "... 09:41" match.
  function normLabel(text, max = 40) {
    return String(text || '')
      .toLowerCase()
      .replace(/\d+/g, ' ')
      .replace(/\b(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g, ' ')
      .replace(/[^a-zÀ-ɏ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .trim();
  }

  // "09:58", "1:02:03", "2d 05:12:33" - how a remaining time is written back to the user.
  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    if (d) return `${d}d ${p(h)}:${p(m)}:${p(s)}`;
    if (h) return `${h}:${p(m)}:${p(s)}`;
    return `${p(m)}:${p(s)}`;
  }

  const api = {
    toCount, parseCountdown, timerContext, isTimerish, parseCounter, parseStock,
    claimsEndsToday, normLabel, formatDuration,
  };
  if (NODE) module.exports = api;
  else (globalThis.TT = globalThis.TT || {}).parse = api;
})();
