const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/lib/parse.js');

const cd = (text, spaced) => P.parseCountdown(text, spaced);
const secs = (text, spaced) => (cd(text, spaced) || {}).seconds;

test('toCount reads the ways shops write a count', () => {
  assert.equal(P.toCount('17'), 17);
  assert.equal(P.toCount('1,234'), 1234);
  assert.equal(P.toCount('1.234'), 1234);
  assert.equal(P.toCount('1.2k'), 1200);
  assert.equal(P.toCount('2K+'), 2000);
  assert.equal(P.toCount('50+'), 50);
  assert.equal(P.toCount('abc'), null);
});

test('countdowns: clock forms', () => {
  assert.deepEqual(cd('09:58'), { seconds: 598, gran: 1, form: 'mmss', groups: 2 });
  assert.equal(secs('Ends in 1:02:03'), 3723);
  assert.equal(secs('00 : 09 : 58'), 598, 'digits in boxes with separators');
  assert.equal(secs('02:13:45:12'), 2 * 86400 + 13 * 3600 + 45 * 60 + 12, 'd:hh:mm:ss');
  assert.equal(secs('2 days 05:12:33'), 2 * 86400 + 5 * 3600 + 12 * 60 + 33);
  assert.equal(secs('2d 05:12:33'), 2 * 86400 + 5 * 3600 + 12 * 60 + 33);
  assert.equal(secs('Offer ends in 09:58.7'), 598, 'tenths are ignored');
  assert.equal(cd('Ends in 1:02:03').gran, 1);
});

test('countdowns: unit forms', () => {
  assert.deepEqual(cd('Ends in 2h 13m 05s'), { seconds: 2 * 3600 + 13 * 60 + 5, gran: 1, form: 'units', groups: 3 });
  assert.equal(secs('05h:13m:22s'), 5 * 3600 + 13 * 60 + 22);
  assert.equal(secs('13 hrs 22 mins'), 13 * 3600 + 22 * 60);
  assert.equal(cd('13 hrs 22 mins').gran, 60);
  assert.equal(secs('Ends in 3 days'), 3 * 86400);
  assert.equal(cd('Ends in 3 days').gran, 86400);
  assert.equal(secs('1 day, 4 hours and 10 minutes left'), 86400 + 4 * 3600 + 600);
});

test('countdowns: digit boxes with no separators need the spaced text', () => {
  assert.equal(cd('000958'), null);
  assert.equal(secs('000958', '00 09 58'), 598);
  assert.equal(secs('01020958', '01 02 09 58'), 86400 + 2 * 3600 + 598);
  assert.equal(cd('Sale 000958', 'Sale 00 09 58'), null, 'only bare digits count as boxes');
});

test('countdowns: things that are not countdowns', () => {
  for (const t of ['Biogesic 10s', 'Ships in 3d', 'iPhone 15 128GB', '45s', '1:75:00', '25:99',
    'Opens 10:30 and closes 21:00', '12:00:00 - 18:00:00', '₱1,299.00', '4.8 ★ 10.2k sold', '']) {
    assert.equal(cd(t), null, t);
  }
});

test('timer context: deadline words and the countdowns that are real by design', () => {
  assert.equal(P.timerContext('FLASH SALE ENDS IN').keyword, 'flash');
  assert.equal(P.timerContext('Your cart is reserved for 09:58').keyword, 'reserved');
  assert.equal(P.timerContext('Store time 14:05').keyword, null);
  for (const t of ['FREE delivery tomorrow. Order within 3 hrs 12 mins', 'Resend code in 0:59',
    'Your OTP expires in 04:59', 'Video 0:23', 'Auction ends in 1:02:03']) {
    assert.ok(P.timerContext(t).excluded, t);
  }
  assert.ok(!P.timerContext('Flash sale ends in 09:58').excluded);
  assert.ok(!P.timerContext('Free shipping voucher ends in 02:00:00').excluded, '"shipping" is not "ships"');
  assert.ok(P.isTimerish('countdown-timer'));
  assert.ok(P.isTimerish('_x hurrify-timer'));
  assert.ok(!P.isTimerish('_3UuD _1Az5'));
});

test('counters: viewers, carts and recent purchases', () => {
  assert.deepEqual(P.parseCounter('23 people are viewing this right now'), { kind: 'viewers', value: 23 });
  assert.deepEqual(P.parseCounter('17 others are looking at this'), { kind: 'viewers', value: 17 });
  assert.deepEqual(P.parseCounter('1,203 shoppers viewing'), { kind: 'viewers', value: 1203 });
  assert.deepEqual(P.parseCounter('Viewing now: 41'), { kind: 'viewers', value: 41 });
  assert.deepEqual(P.parseCounter('12 people have this in their cart'), { kind: 'carts', value: 12 });
  assert.deepEqual(P.parseCounter('In 30+ carts'), { kind: 'carts', value: 30 });
  assert.deepEqual(P.parseCounter('50+ bought in the past hour'), { kind: 'bought', value: 50, window: 'hour' });
  assert.deepEqual(P.parseCounter('2K+ bought in past month'), { kind: 'bought', value: 2000, window: 'month' });
  assert.deepEqual(P.parseCounter('8 people bought this in the last 24 hours'), { kind: 'bought', value: 8, window: '24 hours' });
  assert.deepEqual(P.parseCounter('Sold 14 times in the last 3 hours'), { kind: 'bought', value: 14, window: '3 hours' });
  for (const t of ['10.2k sold', '4.8 ★ · 10.2k sold', '1,234 ratings', 'Viewed products', '3 sold today']) {
    assert.equal(P.parseCounter(t), null, t);
  }
});

test('stock claims', () => {
  assert.deepEqual(P.parseStock('Only 3 left in stock - order soon.'), { value: 3 });
  assert.deepEqual(P.parseStock('Only 2 items left'), { value: 2 });
  assert.deepEqual(P.parseStock('Hurry! Only 4 left'), { value: 4 });
  assert.deepEqual(P.parseStock('Hurry! 4 left'), { value: 4 });
  assert.deepEqual(P.parseStock('5 left in stock'), { value: 5 });
  assert.deepEqual(P.parseStock('Low stock: 2 remaining'), { value: 2 });
  for (const t of ['Only 3 days left', '3 left', 'Stock: 120', '10.2k sold', 'Ends in 2 days left']) {
    assert.equal(P.parseStock(t), null, t);
  }
});

test('"ends today" claims', () => {
  for (const t of ['Sale ends today!', 'Offer ends tonight', 'Today only: 50% off', 'Last day to save', 'Deal expires at midnight']) {
    assert.ok(P.claimsEndsToday(t), t);
  }
  for (const t of ['Order today, get it tomorrow', 'FREE delivery today. Order within 2 hrs', 'Ends in 2 days']) {
    assert.ok(!P.claimsEndsToday(t), t);
  }
});

test('labels drop every digit and time unit so they survive the next tick', () => {
  assert.equal(P.normLabel('FLASH SALE ENDS IN 00 09 58'), 'flash sale ends in');
  assert.equal(P.normLabel('Ends in 2h 13m 05s'), 'ends in');
  assert.equal(P.formatDuration(598), '09:58');
  assert.equal(P.formatDuration(3723), '1:02:03');
  assert.equal(P.formatDuration(2 * 86400 + 3723), '2d 01:02:03');
});
