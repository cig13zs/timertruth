const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/lib/history.js');

test('page keys drop query strings and Amazon slugs', () => {
  assert.equal(H.hostOf('www.Amazon.com'), 'amazon.com');
  assert.equal(H.pagePath('/Stainless-Bottle-Insulated/dp/B0ABCDEF12/ref=sr_1_3', 'amazon.com'), '/dp/B0ABCDEF12');
  assert.equal(H.pagePath('/gp/product/b0abcdef12', 'amazon.co.uk'), '/dp/B0ABCDEF12');
  assert.equal(H.pagePath('/Wireless-Earbuds-i.123.456/', 'shopee.ph'), '/Wireless-Earbuds-i.123.456');
  assert.equal(H.pagePath('/', 'temu.com'), '/');
  assert.equal(H.pageKey('shopee.ph', '/x'), 'p:shopee.ph/x');
});

test('one reading per item per load, capped history, capped items', () => {
  const rec = H.newRecord('shop.test', '/x', 0);
  const cand = { key: 'timer|ends in||1/1', kind: 'timer', label: 'ends in', text: 'Ends in 09:58' };
  assert.ok(H.addObservation(rec, cand, { t: 1, e: 2 }, 'L1', 1));
  assert.ok(!H.addObservation(rec, cand, { t: 2, e: 3 }, 'L1', 2), 'same load again is ignored');
  for (let i = 0; i < 40; i++) H.addObservation(rec, cand, { t: 10 + i, e: 10 }, `M${i}`, 10 + i);
  assert.equal(rec.items[cand.key].obs.length, H.MAX_OBS);
  assert.equal(rec.items[cand.key].obs.at(-1).l, 'M39');
  for (let i = 0; i < H.MAX_ITEMS + 5; i++) {
    H.addObservation(rec, { key: `stock|stock||${i}`, kind: 'stock', label: 'stock' }, { t: 100 + i, v: 3 }, 'L9', 100 + i);
  }
  assert.equal(Object.keys(rec.items).length, H.MAX_ITEMS);
  assert.ok(!(cand.key in rec.items), 'least recently seen item goes first');
});

test('shop index keeps one entry per page item and only the kinds the cross checks read', () => {
  const idx = { entries: [] };
  H.updateIndex(idx, '/a', 'timer|x||1/1', { kind: 'timer', obs: [{ t: 1, e: 900, s: 600, tol: 2000 }] });
  H.updateIndex(idx, '/a', 'timer|x||1/1', { kind: 'timer', obs: [{ t: 2, e: 905, s: 600, tol: 2000 }] });
  H.updateIndex(idx, '/a', 'viewers|viewers||1/1', { kind: 'viewers', obs: [{ t: 1, v: 17 }, { t: 2, v: 18 }] });
  H.updateIndex(idx, '/a', 'stock|stock||1/1', { kind: 'stock', obs: [{ t: 1, v: 3 }] });
  assert.equal(idx.entries.length, 2);
  assert.equal(idx.entries.find((e) => e.k === 'timer').e, 905);
  assert.equal(idx.entries.find((e) => e.k === 'viewers').varied, true);
});

test('pruning drops the least recently seen pages first', () => {
  const recs = { 'p:a/1': { last: 5 }, 'p:a/2': { last: 1 }, 'p:a/3': { last: 3 }, 'off:a': true };
  assert.deepEqual(H.prunePlan(recs, 2), ['p:a/2']);
  assert.deepEqual(H.prunePlan(recs, 3), []);
});
