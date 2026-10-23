const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, fill, hms, parse, scan } = require('./helpers/sim.js');

const kinds = (cands) => cands.map((c) => `${c.kind}:${c.label}`).sort();

test('fake-shop fixture: finds the flash-sale boxes, viewers and stock, and nothing else', () => {
  const html = fill(fixture('fake-shop.html'), {
    hh: '00', mm: '09', ss: '58', viewers: 23, stock: 3, vid: '23', cut: '3 hrs 12 mins', clock: '14:05:33',
  });
  const cands = scan(parse(html).body);
  // "Sale time now 14:05:33" is kept here; it is thrown out later for counting up.
  assert.deepEqual(kinds(cands), ['stock:stock', 'timer:flash sale ends in', 'timer:sale time now', 'viewers:viewers']);
  const t = cands.find((c) => c.label === 'flash sale ends in');
  assert.equal(t.el.getAttribute('class'), '_1Az5', 'smallest element holding the whole timer');
  assert.equal(t.parsed.seconds, 598);
  assert.equal(t.key, 'timer|flash sale ends in||1/1');
  const v = cands.find((c) => c.kind === 'viewers');
  assert.equal(v.el.tagName, 'P');
  assert.equal(v.parsed.value, 23);
  assert.ok(!cands.some((c) => /0:23/.test(c.text)), 'video player time is ignored');
  assert.ok(!cands.some((c) => /Order within/.test(c.text)), 'delivery cut-off is ignored');
  assert.ok(!cands.some((c) => /Ends in 00:10:00/.test(c.text)), 'script text is never read');
});

test('real-shop fixture: unit-form timer, steady counters, a printed date is not a timer', () => {
  const html = fill(fixture('real-shop.html'), { h: 2, m: 13, s: '05', viewers: 1203, stock: 9, vdays: 2 });
  const cands = scan(parse(html).body);
  assert.deepEqual(kinds(cands), ['stock:stock', 'timer:ends in', 'timer:left', 'timer:mega sale ends', 'viewers:viewers']);
  const date = cands.find((c) => c.label === 'mega sale ends');
  assert.equal(date.parsed.gran, 1, 'the printed date parses as a clock, so it must be seen ticking to count');
});

test('amazon-like fixture: deal timer, stock, bought-in-past-month; delivery countdown ignored', () => {
  const html = fill(fixture('amazon-like.html'), { hms: '05:12:33', stock: 3, bought: '2K+', cut: '3 hrs 12 mins' });
  const cands = scan(parse(html).body);
  assert.deepEqual(kinds(cands), ['bought:bought per month', 'stock:stock', 'timer:ends in']);
  assert.equal(cands.find((c) => c.kind === 'bought').parsed.value, 2000);
  assert.equal(cands.find((c) => c.kind === 'stock').parsed.value, 3);
});

test('grid fixture: each tile is keyed by its product link, not its position', () => {
  const tile = fixture('grid-tile.html');
  const tiles = [3, 1, 2].map((id) => fill(tile, { id, price: 100 + id, left: hms(3600) })).join('');
  const cands = scan(parse(fill(fixture('grid.html'), { tiles })).body);
  assert.deepEqual(cands.map((c) => c.key), [
    'timer|ends in|/item-3|1/1', 'timer|ends in|/item-1|1/1', 'timer|ends in|/item-2|1/1',
  ]);
});

test('identical timers with no link between them are numbered, and the count is in the key', () => {
  const html = '<body><div>Ends in <span>01:00:00</span></div><div>Ends in <span>01:00:00</span></div></body>';
  const cands = scan(parse(html).body);
  assert.deepEqual(cands.map((c) => c.key), ['timer|ends in||1/2', 'timer|ends in||2/2']);
});

test('ends-today claims and timers without any deadline words', () => {
  const html = fill(fixture('evergreen.html'), { hms: '05:00:00' });
  const cands = scan(parse(html).body);
  assert.deepEqual(kinds(cands), ['timer:sale ends today', 'today:sale ends today']);
  const bare = scan(parse('<body><p>Duration 01:02:03</p><p class="x">12:30:00</p></body>').body);
  assert.equal(bare.length, 0, 'no keyword and no timer-like class: not a countdown');
  const classed = scan(parse('<body><span class="countdown">12:30:00</span></body>').body);
  assert.equal(classed.length, 1, 'a timer-like class is enough to watch it');
});
