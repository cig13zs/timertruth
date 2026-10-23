process.env.TZ = 'Asia/Manila';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/sim.js');
const J = require('../src/lib/judge.js');

const { fixture, fill, hms, mmss, p2, rng, shownLeft, newState, runLoad, verdicts, byKind } = S;
const T0 = Date.UTC(2026, 10, 9, 4, 0, 0);   // 9 Nov 2026, 12:00 in Manila
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

// The classic fake: every load starts the clock at 10:00 again.
function fakeShop(loadStart, n, { viewers = [23, 41, 17, 38, 29], stock = [3, 7, 2, 5, 4] } = {}) {
  return (t) => {
    const left = Math.max(0, 600 - Math.floor((t - loadStart) / 1000));
    const clock = new Date(t);
    return fill(fixture('fake-shop.html'), {
      hh: p2(Math.floor(left / 3600)), mm: p2(Math.floor(left / 60) % 60), ss: p2(left % 60),
      viewers: viewers[n % viewers.length], stock: stock[n % stock.length],
      vid: p2(30 - Math.floor((t - loadStart) / 1000) % 30), cut: '3 hrs 12 mins',
      clock: `${p2(clock.getUTCHours())}:${p2(clock.getUTCMinutes())}:${p2(clock.getUTCSeconds())}`,
    });
  };
}

// A real sale: one fixed deadline, drawn by the page's own ticker at a random phase each load.
function realShop(deadline, loadStart, { phase = 0, round = 'ceil', viewers = 1203, stock = 9 } = {}) {
  return (t) => {
    const left = shownLeft(deadline, t, loadStart, phase, round);
    return fill(fixture('real-shop.html'), {
      h: Math.floor(left / 3600), m: Math.floor(left / 60) % 60, s: p2(left % 60), viewers, stock, vdays: 2,
    });
  };
}

test('fake timer: four loads three seconds apart -> FAKE: reset 3×, starts at 10:00 every time', () => {
  const st = newState();
  for (let i = 0; i < 4; i++) runLoad(st, fakeShop(T0 + i * 3000, i), T0 + i * 3000);
  const timers = byKind(st, 'timer');
  assert.deepEqual(timers, ['timer|flash sale ends in||1/1'], 'the up-counting "sale time" clock is dropped');
  const v = verdicts(st)[timers[0]];
  assert.equal(v.level, 'fake');
  assert.equal(v.title, 'FAKE: reset 3×');
  assert.ok(v.lines.some((l) => l === 'It starts at 10:00 on every load.'), v.lines.join('\n'));
  const demo = J.demoVerdict(Object.values(st.rec.items), T0);
  assert.equal(demo.level, 'fake');
  assert.equal(demo.headline, 'FAKE: reset 3×');
});

test('fake timer: one reload is only a warning, the second makes it FAKE', () => {
  const st = newState();
  runLoad(st, fakeShop(T0, 0), T0);
  assert.equal(verdicts(st)['timer|flash sale ends in||1/1'].level, 'watch');
  runLoad(st, fakeShop(T0 + 5000, 1), T0 + 5000);
  assert.equal(verdicts(st)['timer|flash sale ends in||1/1'].title, 'Reset 1× (reload to confirm)');
  runLoad(st, fakeShop(T0 + 9000, 2), T0 + 9000);
  assert.equal(verdicts(st)['timer|flash sale ends in||1/1'].title, 'FAKE: reset 2×');
});

test('real timer: 200 loads with random tick phase, rounding, scan delay and gaps never get flagged', () => {
  const r = rng(42);
  for (const round of ['ceil', 'floor']) {
    const st = newState();
    const deadline = T0 + 5 * HOUR + 1234;
    let t = T0;
    for (let i = 0; i < 100; i++) {
      // Gaps from 2.5 s (a quick reload) to 20 minutes.
      t += i % 3 ? 2500 + r() * 2000 : r() * 20 * MIN;
      runLoad(st, realShop(deadline, t, { phase: r() * 1000, round }), t, { scanDelay: 50 + r() * 1500 });
    }
    const v = verdicts(st)['timer|ends in||1/1'];
    assert.equal(v.level, 'ok', `${round}: ${v.title}\n${v.lines.join('\n')}`);
    assert.equal(v.badge, '✓ consistent · 30 loads', 'history is capped at 30 readings');
    for (const [k, x] of Object.entries(verdicts(st))) assert.notEqual(x.level, 'fake', k);
  }
});

test('real timer: the server clock offset wobbling by half a second per load is still consistent', () => {
  const r = rng(7);
  const st = newState();
  const deadline = T0 + 3 * HOUR;
  for (let i = 0; i < 25; i++) {
    const t = T0 + i * 3000;
    const skew = (r() - 0.5) * 900;    // network latency in the page's server-time sync
    runLoad(st, realShop(deadline + skew, t, { phase: r() * 1000 }), t);
  }
  assert.equal(verdicts(st)['timer|ends in||1/1'].level, 'ok');
});

test('real timer: a printed date and an up-counting clock never become timers', () => {
  const st = newState();
  for (let i = 0; i < 3; i++) runLoad(st, realShop(T0 + HOUR, T0 + i * 4000), T0 + i * 4000);
  assert.deepEqual(byKind(st, 'timer').sort(), ['timer|ends in||1/1', 'timer|left||1/1']);
  // "2 days left" is day-precision: kept, and consistent.
  assert.equal(verdicts(st)['timer|left||1/1'].level, 'ok');
});

test('minute-precision timer ("2h 13m"): consistent across loads minutes apart, fake when it restarts', () => {
  const page = (left) => () => `<body><div class="deal">Deal ends in <b>${Math.floor(left / 3600)}h ${Math.floor(left / 60) % 60}m</b></div></body>`;
  const real = newState();
  const deadline = T0 + 2 * HOUR + 13 * MIN + 30e3;
  for (let i = 0; i < 4; i++) {
    const t = T0 + i * 7 * MIN;
    runLoad(real, page(Math.ceil((deadline - t) / 60e3) * 60), t);
  }
  assert.equal(Object.values(verdicts(real))[0].level, 'ok');
  const fake = newState();
  for (let i = 0; i < 4; i++) runLoad(fake, page(2 * HOUR + 13 * MIN), T0 + i * 7 * MIN);
  assert.equal(Object.values(verdicts(fake))[0].title, 'FAKE: reset 3×');
});

test('a stale cached copy of a real timer does not make it FAKE', () => {
  const st = newState();
  const deadline = T0 + HOUR;
  let t = T0;
  runLoad(st, realShop(deadline, t), t);
  t += 20e3;
  runLoad(st, realShop(deadline + 20e3, t), t);     // served a 20 s old page once
  assert.equal(verdicts(st)['timer|ends in||1/1'].level, 'warn');
  t += 5000;
  runLoad(st, realShop(deadline, t), t);             // fresh page again: back on the old deadline
  assert.equal(verdicts(st)['timer|ends in||1/1'].level, 'ok', 'jump and snap-back cancel out');
  // A stale copy that sticks for a while, then steady loads: one move, then calm.
  const st2 = newState();
  t = T0;
  runLoad(st2, realShop(deadline, t), t);
  for (let i = 0; i < 4; i++) { t += 5000; runLoad(st2, realShop(deadline + 20e3, t), t); }
  assert.equal(verdicts(st2)['timer|ends in||1/1'].level, 'ok');
  // ...whereas a timer that keeps landing on new deadlines is not a stale copy.
  const st3 = newState();
  [0, 20e3, 45e3, 70e3].forEach((d, i) => runLoad(st3, realShop(deadline + d, T0 + i * 5000), T0 + i * 5000));
  assert.equal(verdicts(st3)['timer|ends in||1/1'].title, 'FAKE: reset 3×');
});

test('a new sale after the old one ended is not a reset', () => {
  const st = newState();
  const first = T0 + 10 * MIN;
  runLoad(st, realShop(first, T0), T0);
  runLoad(st, realShop(first, T0 + 5 * MIN), T0 + 5 * MIN);
  const second = T0 + 3 * HOUR + 17 * MIN;
  runLoad(st, realShop(second, T0 + HOUR), T0 + HOUR);
  runLoad(st, realShop(second, T0 + HOUR + 4 * MIN), T0 + HOUR + 4 * MIN);
  const v = verdicts(st)['timer|ends in||1/1'];
  assert.equal(v.level, 'ok');
  assert.ok(v.lines.some((l) => /new countdown started/.test(l)));
});

test('random viewer counts are flagged; steady and small real ones are not', () => {
  const st = newState();
  for (let i = 0; i < 4; i++) runLoad(st, fakeShop(T0 + i * 3000, i), T0 + i * 3000);
  const v = verdicts(st)['viewers|viewers||1/1'];
  assert.equal(v.level, 'warn');
  assert.equal(v.badge, 'RANDOM: 23→41→17→38');

  const page = (n) => () => `<body><p>${n} people are viewing this</p></body>`;
  const steady = newState();
  [1203, 1210, 1198, 1215].forEach((n, i) => runLoad(steady, page(n), T0 + i * 30e3));
  assert.equal(Object.values(verdicts(steady))[0].level, 'none');
  const small = newState();
  [3, 5, 2, 6].forEach((n, i) => runLoad(small, page(n), T0 + i * 30e3));
  assert.equal(Object.values(verdicts(small))[0].level, 'none', 'small live counts move a little');
  const slow = newState();
  [23, 41, 17].forEach((n, i) => runLoad(slow, page(n), T0 + i * 2 * DAY));
  assert.equal(Object.values(verdicts(slow))[0].level, 'none', 'days apart, any number is plausible');
});

test('"bought in the past hour" that jumps is random; Amazon-style "2K+ past month" is left alone', () => {
  const page = (n) => () => `<body><span>${n} bought in the past hour</span></body>`;
  const st = newState();
  [12, 48, 9, 51].forEach((n, i) => runLoad(st, page(n), T0 + i * 4000));
  assert.equal(Object.values(verdicts(st))[0].badge, 'RANDOM: 12→48→9→51');
  const amz = newState();
  for (let i = 0; i < 4; i++) {
    runLoad(amz, () => fill(fixture('amazon-like.html'), { hms: hms(5 * 3600 - i * 4), stock: 3, bought: '2K+', cut: '3 hrs' }), T0 + i * 4000);
  }
  assert.equal(verdicts(amz)['bought|bought per month||1/1'].level, 'none');
});

test('stock: going back up within minutes is flagged, falling or one slow restock is not', () => {
  const st = newState();
  for (let i = 0; i < 3; i++) runLoad(st, fakeShop(T0 + i * 3000, i), T0 + i * 3000);
  assert.equal(verdicts(st)['stock|stock||1/1'].badge, 'Stock went up: 3→7→2');

  const page = (n) => () => `<body><div>Only ${n} items left</div></body>`;
  const falling = newState();
  [9, 8, 8, 6].forEach((n, i) => runLoad(falling, page(n), T0 + i * 10 * MIN));
  assert.equal(Object.values(verdicts(falling))[0].level, 'none');
  const restock = newState();
  [3, 2, 20, 18].forEach((n, i) => runLoad(restock, page(n), T0 + i * DAY));
  assert.equal(Object.values(verdicts(restock))[0].level, 'none', 'one restock a day later is normal');
  const stuck = newState();
  [3, 3, 3, 3].forEach((n, i) => runLoad(stuck, page(n), T0 + i * 1.5 * DAY));
  assert.equal(Object.values(verdicts(stuck))[0].badge, 'Still "3 left" after 4 days');
});

test('evergreen: a countdown to midnight that is back the next day, and "ends today" on two days', () => {
  const st = newState();
  const midnight = (t) => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };
  for (const t of [T0, T0 + 3 * MIN, T0 + DAY + 2 * HOUR, T0 + DAY + 2 * HOUR + 5 * MIN]) {
    runLoad(st, (x) => fill(fixture('evergreen.html'), { hms: hms(shownLeft(midnight(t), x, t, 0)) }), t);
  }
  const v = verdicts(st);
  assert.equal(v['timer|sale ends today||1/1'].badge, 'Ends at midnight, every night');
  assert.equal(v['today|sale ends today||1/1'].badge, '"Ends today" on 2 different days');
});

test('same timer on every product: three products opened minutes apart all start at 15:00', () => {
  const st = newState('shop.test', '/products/a');
  const product = (name, start) => (t) => fill(fixture('product.html'), {
    name, mmss: mmss(Math.max(0, 900 - Math.floor((t - start) / 1000))), viewers: 17,
  });
  runLoad(st, product('Linen shirt', T0), T0, { path: '/products/a' });
  assert.equal(Object.values(verdicts(st)).find((x) => x.state === 'watching').level, 'watch');
  runLoad(st, product('Canvas tote', T0 + 4 * MIN), T0 + 4 * MIN, { path: '/products/b' });
  runLoad(st, product('Straw hat', T0 + 11 * MIN), T0 + 11 * MIN, { path: '/products/c' });
  const v = verdicts(st);
  assert.equal(v['timer|offer ends in||1/1'].title, 'FAKE: same timer on 3 products');
  assert.equal(v['viewers|viewers||1/1'].badge, 'Same "17 viewing" on 3 products');
});

test('a shared real deadline across products is not "the same timer everywhere"', () => {
  const st = newState('shop.test', '/products/a');
  const deadline = T0 + 2 * HOUR;
  const product = (start) => (t) => fill(fixture('product.html'), {
    name: 'x', mmss: hms(shownLeft(deadline, t, start, 0)), viewers: 17,
  });
  ['a', 'b', 'c', 'd'].forEach((p, i) => runLoad(st, product(T0 + i * 3 * MIN), T0 + i * 3 * MIN, { path: `/products/${p}` }));
  assert.notEqual(verdicts(st)['timer|offer ends in||1/1'].level, 'fake');
});

test('same viewer number on products opened within ten minutes is not enough evidence', () => {
  const st = newState('shop.test', '/products/a');
  const page = () => '<body><p>17 people are viewing this</p></body>';
  ['a', 'b', 'c'].forEach((p, i) => runLoad(st, page, T0 + i * MIN, { path: `/products/${p}` }));
  assert.equal(verdicts(st)['viewers|viewers||1/1'].level, 'none');
});

test('grid that reshuffles between loads: every tile stays consistent', () => {
  const st = newState('shop.test', '/search');
  const deadline = T0 + HOUR;
  const tile = fixture('grid-tile.html');
  const orders = [[1, 2, 3, 4], [3, 1, 4, 2], [2, 4, 1, 3]];
  orders.forEach((order, i) => {
    const t = T0 + i * 4000;
    runLoad(st, (x) => fill(fixture('grid.html'), {
      tiles: order.map((id) => fill(tile, { id, price: 100 + id, left: hms(shownLeft(deadline, x, t, 300)) })).join(''),
    }), t);
  });
  const v = verdicts(st);
  assert.equal(Object.keys(v).length, 4);
  for (const [k, x] of Object.entries(v)) assert.equal(x.level, 'ok', k);
});

test('demo verdict counts only the loads since the test started', () => {
  const st = newState();
  for (let i = 0; i < 6; i++) runLoad(st, fakeShop(T0 + i * 3000, i, { viewers: [23, 41, 17, 38, 12, 44] }), T0 + i * 3000);
  const since = T0 + 2 * 3000;
  const d = J.demoVerdict(Object.values(st.rec.items), since);
  assert.equal(d.headline, 'FAKE: reset 3×');
  assert.equal(d.lines[0], '"Flash sale ends in" restarted on every reload: 3 resets in 4 loads, always from 10:00.');
  assert.ok(d.lines.includes('"People viewing" jumped around: 17 → 38 → 12 → 44.'), d.lines.join('\n'));
  const real = newState();
  for (let i = 0; i < 4; i++) runLoad(real, realShop(T0 + HOUR, T0 + i * 3000, { phase: i * 230 }), T0 + i * 3000);
  assert.equal(J.demoVerdict(Object.values(real.rec.items), T0).headline, 'This timer looks real');
  assert.equal(J.demoVerdict([], T0).headline, 'No live countdown found here');
});
