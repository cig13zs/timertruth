/* TimerTruth - turns what was seen on each load into a verdict.
 *
 * Pure functions, no DOM, no clock of their own: every time comes in as an
 * argument so the tests can replay days of visits in a millisecond.
 *
 * How a timer is measured. A countdown showing 09:58 at time t implies a
 * deadline of t + 9:58. Read naively that has up to two seconds of slop (the
 * page may have drawn it up to a second ago, and rounds one way or the other),
 * which is as large as the gap between two quick reloads. So a seconds timer is
 * watched until its digits change, and the deadline is taken at that edge:
 * deadline = time of change + value shown just after it. That pins it to within
 * about a second whatever the page's tick phase, and a real deadline then
 * agrees with itself across loads to within EDGE_TOL.
 */
(function () {
  'use strict';
  const NODE = typeof module === 'object' && module !== null && !!module.exports;
  const P = NODE ? require('./parse.js') : globalThis.TT.parse;

  const EDGE_TOL = 2000;              // ms; real deadlines measured at the edge agree within ~1.1 s
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

  const round1 = (x) => Math.round(x * 10) / 10;

  // ---- observing -----------------------------------------------------------------

  /* One load's reading of a timer, or null when it turns out not to be a live
   * countdown at all.
   *   cand     - from scan(): { parsed, keyword, timerish }
   *   samples  - [{ t, text, spaced }] read every ~100 ms for ~1.3 s
   *   navTime  - when this page view started (ms)
   * Result: { t, e: deadline ms, s: seconds left at page start, tol, g, v: shown }
   */
  function observeTimer(cand, samples, navTime) {
    const vals = [];
    for (const s of samples) {
      const p = P.parseCountdown(s.text, s.spaced);
      if (p) vals.push({ t: s.t, p });
    }
    if (!vals.length) return null;
    const first = vals[0];
    const g = first.p.gran;
    let edge = null;
    for (const v of vals.slice(1)) {
      if (v.p.seconds === first.p.seconds) continue;
      const drop = first.p.seconds - v.p.seconds;
      // Counting up is a clock or a stopwatch. A jump is not a countdown.
      if (drop <= 0 || drop > 3 * v.p.gran + 1) return null;
      edge = v;
      break;
    }
    if (g === 1) {
      // Seconds on screen: must be seen ticking down, so a printed date like
      // "Sale ends 2026-11-11 23:59:59" can never be read as 23 hours left.
      if (!edge) return null;
      if (first.p.groups === 2 && !cand.keyword && !cand.timerish) return null;
    } else if (!cand.keyword) {
      return null;
    }
    const at = edge || first;
    const e = at.t + at.p.seconds * 1000;
    return {
      t: at.t,
      e,
      s: round1((e - navTime) / 1000),
      tol: edge ? EDGE_TOL : g * 1000 + 2000,
      g,
      v: at.p.seconds,
    };
  }

  const observeValue = (t, value) => ({ t, v: value });

  // ---- local-time helpers (the user's own clock; tests set TZ) --------------------

  function dayOf(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function nearMidnight(ts, slack = 2 * MIN) {
    const d = new Date(ts);
    const intoDay = ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
    return intoDay <= slack || DAY - intoDay <= slack;
  }
  function clock(ts) {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // ---- timers -----------------------------------------------------------------------

  /* resets   - the deadline moved later BEFORE the old one was reached
   * earlier  - the deadline moved earlier (random restarts do this too)
   * renewals - a new deadline after the old one had passed (a new sale, or an
   *            evergreen timer if it always lands on midnight)
   */
  function judgeTimer(obs) {
    const o = [...obs].sort((a, b) => a.t - b.t);
    let renewals = 0, midnight = true;
    const moves = [];               // { i, dir } where reading i disagrees with reading i-1
    for (let i = 1; i < o.length; i++) {
      const a = o[i - 1], b = o[i];
      const tol = Math.max(a.tol, b.tol);
      if (b.e > a.e + tol) {
        if (b.t < a.e) moves.push({ i, dir: 1 });
        else {
          renewals++;
          if (!nearMidnight(a.e) || !nearMidnight(b.e)) midnight = false;
        }
      } else if (b.e < a.e - tol) {
        moves.push({ i, dir: -1 });
      }
    }
    // An excursion: the deadline jumps, then a later load lands back on the
    // deadline from before the jump. That is a stale copy of the page (a CDN
    // or the browser cache), not a timer that restarts, and a restarting timer
    // never comes back to an old deadline. Both moves are struck off.
    for (const m of moves) {
      if (m.used) continue;
      const base = o[m.i - 1];
      const back = moves.find((n) => !n.used && n.i > m.i && Math.abs(o[n.i].e - base.e) <= Math.max(base.tol, o[n.i].tol));
      if (back) { m.used = true; back.used = true; }
    }
    const real = moves.filter((m) => !m.used);
    const resets = real.filter((m) => m.dir > 0).length;
    const earlier = real.length - resets;
    const lastMove = real.length ? real[real.length - 1].i : 0;
    const calmAfter = real.length ? o.length - 1 - lastMove : o.length - 1;
    const moveCount = resets + earlier;
    const tolS = Math.max(...o.map((x) => x.tol)) / 1000 + 1;
    const sameStart = o.length >= 3 && o.every((x) => Math.abs(x.s - o[0].s) <= tolS);

    let state = 'watching';
    if (moveCount >= 2) state = 'fake';
    else if (moveCount === 1 && calmAfter < 3) state = 'reset1';
    else if (renewals >= 1 && midnight) state = 'evergreen';
    else if (o.length >= 2) state = 'consistent';

    return { state, resets, earlier, moves: moveCount, renewals, loads: o.length, sameStart, start: o.length ? o[0].s : null, obs: o };
  }

  /* Same countdown on different products, each opened at a different time,
   * all showing the same time left when the page opened. A shared real deadline
   * gives the SAME END time and a different time left on each visit; this is
   * the opposite, so the timer is tied to the visit, not to any sale.
   */
  function crossTimer(entries, path, s, tol) {
    if (s == null) return { count: 0 };
    const tolS = tol / 1000 + 1;
    const near = entries.filter((x) => x.k === 'timer' && x.s != null && Math.abs(x.s - s) <= tolS);
    const paths = new Set(near.map((x) => x.p));
    paths.add(path);
    if (paths.size < 3) return { count: 0 };
    const ends = near.map((x) => x.e);
    const spread = Math.max(...ends) - Math.min(...ends);
    if (spread < 30e3) return { count: 0 };
    return { count: paths.size };
  }

  // ---- counters ("23 people viewing", "50 bought in the past hour") -------------------

  /* Random if, over loads close together, the number swung hard both ways at
   * least twice. Real live counts drift; generated ones jump. A small real
   * counter going 3 -> 5 -> 2 does not qualify: a jump must be at least 5 and
   * at least 30% of the larger value.
   */
  function judgeCounter(obs) {
    const o = [...obs].sort((a, b) => a.t - b.t);
    if (!o.length) return { state: 'watching', values: [] };
    const last = o[o.length - 1].t;
    const recent = o.filter((x) => last - x.t <= 30 * MIN);
    let jumps = 0, ups = 0, downs = 0;
    for (let i = 1; i < recent.length; i++) {
      const a = recent[i - 1], b = recent[i];
      if (b.t - a.t > 15 * MIN) continue;
      const d = b.v - a.v;
      if (Math.abs(d) >= Math.max(5, 0.3 * Math.max(a.v, b.v))) {
        jumps++;
        if (d > 0) ups++; else downs++;
      }
    }
    const values = recent.slice(-5).map((x) => x.v);
    let state = 'watching';
    if (jumps >= 2 && ups >= 1 && downs >= 1) state = 'random';
    else if (o.length >= 2) state = 'steady';
    return { state, values, jumps, varied: new Set(o.map((x) => x.v)).size > 1 };
  }

  /* The same number on three or more unrelated product pages, never changing,
   * over at least ten minutes: a hard-coded "17 people are viewing this".
   */
  function crossCounter(entries, path, kind, value) {
    if (value == null || value < 5) return { count: 0 };
    const same = entries.filter((x) => x.k === kind && x.v === value && !x.varied);
    const paths = new Set(same.map((x) => x.p));
    if (!paths.has(path) || paths.size < 3) return { count: 0 };
    const ts = same.flatMap((x) => [x.t0 ?? x.t, x.t]);
    if (Math.max(...ts) - Math.min(...ts) < 10 * MIN) return { count: 0 };
    return { count: paths.size };
  }

  // ---- stock ("Only 3 left") --------------------------------------------------------

  /* Stock that goes back up within half an hour, or goes up twice at any
   * pace, is not a stock count. A restock once in a while is normal and is
   * left alone. Stock that never moves over days is reported as a fact.
   */
  function judgeStock(obs) {
    const o = [...obs].sort((a, b) => a.t - b.t);
    let ups = 0, fastUp = false, downs = 0;
    for (let i = 1; i < o.length; i++) {
      const a = o[i - 1], b = o[i];
      if (b.v > a.v) { ups++; if (b.t - a.t <= 30 * MIN) fastUp = true; }
      else if (b.v < a.v) downs++;
    }
    const values = o.slice(-5).map((x) => x.v);
    const span = o.length ? o[o.length - 1].t - o[0].t : 0;
    let state = 'watching';
    if (fastUp || ups >= 2) state = 'up';
    else if (o.length >= 3 && ups === 0 && downs === 0 && span >= 3 * DAY) state = 'stuck';
    else if (o.length >= 2) state = 'steady';
    return { state, values, ups, days: Math.floor(span / DAY) };
  }

  // ---- "ends today" -------------------------------------------------------------------

  function judgeToday(obs) {
    const days = [...new Set(obs.map((x) => dayOf(x.t)))].sort();
    return { state: days.length >= 2 ? 'evergreen' : 'watching', days };
  }

  // ---- verdicts ------------------------------------------------------------------------

  const KIND_NAME = {
    timer: 'Countdown', viewers: 'Viewers', carts: 'In carts', bought: 'Bought', stock: 'Stock', today: 'Ends today',
  };

  function counterUnit(item) {
    if (item.kind === 'viewers') return 'viewing';
    if (item.kind === 'carts') return 'in carts';
    return item.label.replace(/^bought per /, 'bought / ');
  }

  /* Everything the UI needs for one tracked item:
   *   { level: 'fake' | 'warn' | 'ok' | 'watch', badge, sub, title, lines[] }
   * level decides the look: 'fake' is the red stamp, 'warn' an amber chip,
   * 'ok' a quiet green chip, 'watch' a faint grey one (timers only).
   */
  function verdict(item, entries, path) {
    const obs = item.obs || [];
    const lines = [];
    if (item.kind === 'timer') {
      const j = judgeTimer(obs);
      for (const [i, x] of j.obs.slice(-6).entries()) {
        lines.push(`Load ${j.obs.length - Math.min(6, j.obs.length) + i + 1} at ${clock(x.t)}: ${P.formatDuration(x.v)} left, deadline ${clock(x.e)}`);
      }
      const last = j.obs[j.obs.length - 1];
      const cross = last ? crossTimer(entries || [], path, last.s, last.tol) : { count: 0 };
      if (j.state === 'fake') {
        const how = j.earlier && !j.resets ? 'moved' : 'reset';
        lines.push(j.resets ? `The deadline moved later ${j.resets}× before it was reached.` : '');
        if (j.earlier) lines.push(`The deadline moved earlier ${j.earlier}×.`);
        if (j.sameStart) lines.push(`It starts at ${P.formatDuration(j.start)} on every load.`);
        return { level: 'fake', state: j.state, badge: 'FAKE', sub: `${how} ${j.moves}×`, title: `FAKE: ${how} ${j.moves}×`, lines: lines.filter(Boolean), moves: j.moves, loads: j.loads };
      }
      if (cross.count >= 3) {
        lines.push(`Showed ${P.formatDuration(last.s)} left at page open on ${cross.count} different products, opened at different times.`);
        return { level: 'fake', state: 'same-everywhere', badge: 'FAKE', sub: `same timer on ${cross.count} products`, title: `FAKE: same timer on ${cross.count} products`, lines, moves: j.moves, loads: j.loads };
      }
      if (j.state === 'reset1') {
        lines.push('The deadline moved once. One move can be a page served from cache, so reload again to confirm.');
        return { level: 'warn', state: j.state, badge: 'Reset 1×', sub: 'reload to confirm', title: 'Reset 1× (reload to confirm)', lines, moves: 1, loads: j.loads };
      }
      if (j.state === 'evergreen') {
        lines.push('Each time it ran out, a new countdown to the next midnight replaced it.');
        return { level: 'warn', state: j.state, badge: 'Ends at midnight, every night', sub: '', title: 'Ends at midnight, every night', lines, moves: 0, loads: j.loads };
      }
      if (j.state === 'consistent') {
        lines.push(`The deadline held to within ${Math.round(Math.max(...j.obs.map((x) => x.tol)) / 1000)} s across ${j.loads} loads.`);
        if (j.renewals) lines.push('A new countdown started after the previous one ended, which real sales do.');
        return { level: 'ok', state: j.state, badge: `✓ consistent · ${j.loads} loads`, sub: '', title: `Consistent across ${j.loads} loads`, lines, moves: 0, loads: j.loads };
      }
      return { level: 'watch', state: 'watching', badge: 'watching · reload to test', sub: '', title: 'Seen once. Reload or press Test this timer.', lines, moves: 0, loads: j.loads };
    }

    if (item.kind === 'stock') {
      const j = judgeStock(obs);
      if (j.state === 'up') {
        return { level: 'warn', state: j.state, badge: `Stock went up: ${j.values.join('→')}`, sub: '', title: 'Low-stock count went back up', lines: ['A real count of items left only goes up on a restock. This one went up between visits close together, or more than once.'] };
      }
      if (j.state === 'stuck') {
        return { level: 'warn', state: j.state, badge: `Still "${j.values[0]} left" after ${j.days} days`, sub: '', title: 'Low-stock count never moves', lines: [`Showed the same count on every visit for ${j.days} days.`] };
      }
      return { level: 'none', state: j.state, badge: '', sub: '', title: `${KIND_NAME.stock}: ${j.values.join('→')}`, lines: [] };
    }

    if (item.kind === 'today') {
      const j = judgeToday(obs);
      if (j.state === 'evergreen') {
        return { level: 'warn', state: j.state, badge: `"Ends today" on ${j.days.length} different days`, sub: '', title: 'Ends today, every day', lines: [`Seen on ${j.days.join(', ')}.`] };
      }
      return { level: 'none', state: j.state, badge: '', sub: '', title: 'Says it ends today', lines: [] };
    }

    // viewers, carts, bought
    const j = judgeCounter(obs);
    const last = obs.length ? obs[obs.length - 1].v : null;
    const unit = counterUnit(item);
    if (j.state === 'random') {
      return { level: 'warn', state: j.state, badge: `RANDOM: ${j.values.join('→')}`, sub: unit, title: `Random number (${unit})`, lines: [`Swung by large amounts both ways between loads minutes apart: ${j.values.join(' → ')}.`] };
    }
    const cross = crossCounter(entries || [], path, item.kind, last);
    if (cross.count >= 3) {
      return { level: 'warn', state: 'same-everywhere', badge: `Same "${last} ${unit}" on ${cross.count} products`, sub: '', title: 'Same number on every product', lines: [`The exact same number, never changing, on ${cross.count} different product pages.`] };
    }
    return { level: 'none', state: j.state, badge: '', sub: '', title: `${KIND_NAME[item.kind]}: ${j.values.join('→')}`, lines: [] };
  }

  /* The one-line answer for the demo's verdict card, from the items on a page,
   * judged on the observations made since the test started.
   */
  const QUOTE = { viewers: '"People viewing"', carts: '"In carts"', stock: '"Only N left"' };

  function demoVerdict(items, since) {
    const out = { level: 'none', headline: '', lines: [], timers: 0, moves: 0 };
    const bad = [], odd = [], good = [];
    const rank = { none: 0, ok: 1, warn: 2, fake: 3 };
    const raise = (level) => { if (rank[level] > rank[out.level]) out.level = level; };
    for (const it of items) {
      const obs = (it.obs || []).filter((x) => x.t >= since);
      if (!obs.length) continue;
      const name = it.label && it.label !== 'timer' ? `"${it.label[0].toUpperCase()}${it.label.slice(1)}"` : 'A countdown';
      if (it.kind === 'timer') {
        out.timers++;
        const j = judgeTimer(obs);
        if (j.moves >= 2) {
          raise('fake');
          out.moves = Math.max(out.moves, j.moves);
          bad.push(j.sameStart
            ? `${name} restarted on every reload: ${j.moves} resets in ${j.loads} loads, always from ${P.formatDuration(j.start)}.`
            : `${name} moved its deadline ${j.moves} times in ${j.loads} loads.`);
        } else if (j.moves === 1) {
          raise('warn');
          odd.push(`${name} moved its deadline once. Run the test again to confirm.`);
        } else if (j.loads >= 2) {
          raise('ok');
          good.push(`${name} kept the same deadline across ${j.loads} loads.`);
        }
      } else if (['viewers', 'carts', 'bought'].includes(it.kind)) {
        const j = judgeCounter(obs);
        if (j.state === 'random') {
          raise('warn');
          const what = QUOTE[it.kind] || `"${it.label.replace(/^bought per /, 'Bought in the last ')}"`;
          odd.push(`${what} jumped around: ${j.values.join(' → ')}.`);
        }
      } else if (it.kind === 'stock') {
        const j = judgeStock(obs);
        if (j.state === 'up') {
          raise('warn');
          odd.push(`${QUOTE.stock} went back up: ${j.values.join(' → ')}.`);
        }
      }
    }
    out.lines = [...bad, ...odd, ...good];
    out.headline = {
      fake: `FAKE: reset ${out.moves}×`,
      warn: 'Made-up numbers on this page',
      ok: 'This timer looks real',
      none: out.timers ? 'Not enough loads to tell' : 'No live countdown found here',
    }[out.level];
    return out;
  }

  const api = {
    EDGE_TOL, observeTimer, observeValue, judgeTimer, crossTimer, judgeCounter, crossCounter,
    judgeStock, judgeToday, verdict, demoVerdict, dayOf, nearMidnight, clock, KIND_NAME,
  };
  if (NODE) module.exports = api;
  else globalThis.TT.judge = api;
})();
