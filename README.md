# TimerTruth

![A flash-sale countdown is reloaded three times, starts over from 10:00 each time, and gets stamped FAKE: reset 3×](docs/media/hero.gif)

**This sale timer is fake. Watch it reset.**

TimerTruth is a browser extension, and a userscript, that catches fake urgency on shopping
sites. It notes when every sale countdown says it will end. Reload the page, and if the deadline
has moved later, the countdown gets a red stamp: **FAKE: reset 3×**. A countdown that holds its
deadline gets a small green "consistent" mark instead, because most of them are real.

It also catches "23 people are viewing this" numbers that jump around between reloads, and
"Only 3 left" badges that go back up.

[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/jju1s)

## Install

<!-- Replace each "pending review" with the store link once it is live. -->
- Chrome: Chrome Web Store (pending review)
- Edge: Edge Add-ons (pending review)
- Firefox: Firefox Add-ons (pending review)
- Tampermonkey or Violentmonkey: Greasy Fork (pending review), or install
  [`timertruth.user.js`](https://github.com/cig13zs/timertruth/releases/latest/download/timertruth.user.js)
  from the latest release
- From source: `node build.mjs`, then load `dist/chrome` (Chrome, Edge) or `dist/firefox`
  (Firefox) as an unpacked extension

## Try it in ten seconds

1. Install it.
2. Open the [demo shop](https://cig13zs.github.io/timertruth/demo/), or any product page with a
   countdown on it.
3. Click the TimerTruth button and press **Test this timer**.

The tab reloads itself three times while a small panel counts the resets. Then the verdict lands
on the timer. On the demo shop that is a FAKE stamp on the flash sale, a green check on the
free-shipping countdown next to it (that one is real), and two amber labels on the viewer count
and the stock count.

You don't have to press anything for it to work. It takes one reading per page load in the
background, so a countdown you happen to see twice gets judged on its own.

## What it catches

| On the page | What TimerTruth looks for | Mark |
|---|---|---|
| "Flash sale ends in 09:58" | The deadline moved later before it was reached, twice or more | **FAKE: reset 3×** |
| The same countdown on every product | Three products, opened at different times, all showing the same time left when the page opened | **FAKE: same timer on 3 products** |
| A countdown to midnight | It ran out, and the next day there was a new one to the next midnight | Ends at midnight, every night |
| "Sale ends today!" | The same claim seen on two different days | "Ends today" on 2 different days |
| "23 people are viewing this", "50 bought in the past hour" | Big jumps both up and down between reloads a few minutes apart | RANDOM: 23→41→17→38 |
| "17 people are viewing this" | The exact same number on three unrelated products, never changing | Same "17 viewing" on 3 products |
| "Only 3 left" | The count went back up within half an hour, or went up twice | Stock went up: 3→7→2 |
| "Only 3 left" | The count has not moved in three days or more | Still "3 left" after 5 days |
| A countdown that holds its deadline | Two or more loads agree | ✓ consistent · 4 loads |

Click any mark to see the readings behind it: each load, the time it showed, and the deadline
that implies. The popup lists everything on the current page, keeps a running total across
shops, and has a **Copy evidence** button that puts the readings on your clipboard as plain text.

## How it decides

A countdown that shows 09:58 at 10:41:03 is promising a deadline of 10:51:01. TimerTruth
writes that deadline down. On the next load it reads the countdown again and compares.

**Reading precisely.** A countdown on screen can be up to a second stale and rounded either
way, so a naive reading wobbles by about two seconds, which is as long as a quick reload. So
TimerTruth watches each countdown until its digits change and takes the deadline at that
moment. That pins it to within about a second however the page draws its timer. Two readings of
a real deadline then agree to within 2 seconds (or one unit plus 2 seconds for a timer that only
shows hours and minutes).

**What counts as a reset.** The deadline moved later by more than that margin, before the old
deadline had arrived. One reset only gets an amber "Reset 1×, reload to confirm". It takes two
to stamp FAKE. A countdown that starts again after the old one ran out is a new sale, not a
reset, and is left alone (unless it always lands on midnight).

**Not stamping real sales.** Accuracy matters more than catching everything, so:

- A seconds countdown only counts if it is seen ticking down. A printed date like "Sale ends
  2026-11-11 23:59:59" is never read as "23 hours left", and a clock counting up is dropped.
- A countdown needs deadline words near it ("ends", "sale", "left", "hurry", "reserved"…) or
  timer-like markup.
- Countdowns that restart by design are ignored: delivery cut-offs ("Order within 3 hrs"),
  one-time-code and login timers, video players, and auctions.
- If the deadline jumps and a later load lands back on the old one, that was a stale copy of the
  page from a cache. Both moves are struck off.
- One odd reading followed by three steady loads goes back to "consistent".
- On a search grid, each countdown is tied to its product's link, so a reshuffled grid does not
  pair one product's timer with another's.
- Counters only count as random when they swing by at least 5 and by at least 30% both ways, on
  loads within 15 minutes of each other. "3 → 5 → 2 people viewing" is left alone.

The tests replay 200 loads of a real countdown with a random tick phase, rounding, scan delay and
reload gap, plus clock skew between loads, and check that none of them is ever stamped.

## Limits

It catches countdowns that **reset**. That is the common trick, not the only one.

- A fake countdown that saves its deadline in your browser (in cookies or local storage) keeps
  the same deadline on every reload, so it looks consistent until you clear the site's data or
  come back days later. The "ends at midnight, every night" and "same timer on every product"
  checks catch some of these over time.
- Countdowns drawn on a canvas or as an image cannot be read.
- If a shop serves cached pages with "seconds left" baked into the HTML, quick reloads inside
  the cache window can look like resets. The snap-back rule handles the usual case, and one
  reset alone never stamps FAKE, but this is the main way it could be wrong. Wait a minute and
  test again if a big shop's timer gets stamped.
- It reads English shop text, plus a few Filipino words. A shop in another language may show
  nothing.
- It records what your browser saw. It says nothing about whether the discount itself is real.

Supported first: Shopee and Lazada in every market they run, Temu, Shein, AliExpress and
Amazon's country sites. On any other site, open the popup and press **Check this page once**
(no extra permission), or **Watch this site and test its timer**, which asks for access to that
one site so it can keep reading the timer after each reload.

## Privacy

Everything stays in your browser. There is no server, no account, no analytics and no network
request of any kind. Readings are kept in the extension's local storage (or your userscript
manager's storage) so the next load has something to compare with: per page, the time each
reading was taken and the numbers it showed. Query strings are dropped from page addresses.
At most 500 pages are kept, the oldest go first, and **Forget this page** in the popup deletes a
page's record. Details in [PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
|---|---|
| `storage` | Keeps the readings and the per-shop on/off switch on your device. |
| `activeTab` | Lets **Check this page once** run on a site that is not listed, for that tab, when you press it. |
| `scripting` | How the popup runs the extension's own files on that tab and starts the reload test. No code is downloaded. |
| Host access to the listed shops | The content script runs by itself on Shopee, Lazada, Temu, Shein, AliExpress and Amazon, and on the demo shop. |
| Optional host access, one site at a time | Asked only when you press **Watch this site** on a site that is not listed. Nothing is granted at install. |

## Build

Needs Node 22 or later. No dependencies for the build or the unit tests.

```bash
node --test tests/     # unit tests: parsers, scanner, verdicts, history
node build.mjs         # dist/chrome, dist/firefox, their zips, dist/timertruth.user.js
```

The end-to-end test and the media script use Playwright's Chromium:

```bash
npm install
node tests/e2e.mjs     # loads dist/chrome and runs the reload test against the demo shop
node tests/media.mjs   # re-records docs/media (needs ffmpeg)
node store/make-art.mjs  # icons and the promo tile
```

| Path | Does |
|---|---|
| `src/lib/parse.js` | Reads countdowns, live counters, stock and "ends today" claims out of text. Pure. |
| `src/lib/scan.js` | Finds them in the page by the shape of their text, no CSS selectors. |
| `src/lib/judge.js` | Turns readings into verdicts. Pure, so the tests replay days of visits instantly. |
| `src/lib/history.js` | What is stored, how it is keyed, and how it is trimmed. |
| `src/content.js` | One reading per load, the reload test, marks on the page. |
| `src/ui.js` | The stamp, the labels and the test panel, in a shadow root over the page. |
| `src/popup.*` | Page list, totals, switch, evidence copy, and the per-site permission flow. |
| `userscript/platform.js` | Storage for the userscript build, in place of `src/platform.js`. |
| `docs/demo/` | The demo shop (GitHub Pages). |
| `tests/fixtures/` | Fixture pages with resetting timers, random viewer counts and fake stock. |

## Licence

MIT. Free, and it stays free. If it saved you from a fake deadline, you can
[buy me a coffee](https://ko-fi.com/jju1s).
