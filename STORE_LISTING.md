# Store listings - TimerTruth

Copy-paste source for Chrome Web Store, Edge Add-ons, Firefox Add-ons (AMO) and Greasy Fork.
Current package: **v1.0.0** (`node build.mjs` writes both zips and the userscript to `dist/`).
The stores read the name and the short description from `manifest.json`, so changing either one
means a new package.

Do **not** put Shopee, Lazada, Temu, Shein, AliExpress or Amazon in the name. Naming them in the
description as the sites it supports is ordinary descriptive use. Do not call any named shop
dishonest or illegal anywhere in the listing or the screenshots: the demo shop is made up for
exactly that reason.

Order that fits the 11.11 window: Firefox AMO and Edge first (no extension-count cap, reviews
usually within days), Greasy Fork the same day (no review), Chrome when a slot is free.

---

## Shared text

### Name

Chrome and Edge (75 max):

```
TimerTruth - Fake Sale Timer Detector
```

Firefox (50 max; `build.mjs` sets it):

```
TimerTruth: fake sale timer detector
```

### Short description (132 max, from the manifest)

```
Catches sale countdowns that restart when you reload, and made-up "people viewing" and "only 3 left" counts. All local.
```

### Category

Chrome: Shopping. Edge: Shopping. Firefox: Shopping, and Privacy & Security as the second.

### Long description

```
This sale timer is fake. Watch it reset.

"Flash sale ends in 09:58." Reload the page and it says 10:00 again. TimerTruth
catches that. It notes the deadline every countdown promises, and when a reload
moves the deadline later, it stamps the timer: FAKE: reset 3x.

Most countdowns are real, and those get a small green "consistent" mark instead.

TRY IT IN TEN SECONDS

Open a product page with a countdown, click the TimerTruth button and press
"Test this timer". The tab reloads itself three times and the verdict lands on
the timer. A demo shop to try it on is linked from the project page.

WHAT IT CATCHES

- Countdowns that start over when you reload
- The same countdown on every product, starting from the same time
- "Ends today" sales that are back the next day, and timers that renew every midnight
- "23 people are viewing this" numbers that jump around between reloads
- The same "people viewing" number on unrelated products
- "Only 3 left" stock that goes back up

Click any mark to see the readings behind it. The popup lists what it found on
the page, keeps a running total, and can copy the evidence as plain text.

BUILT NOT TO CRY WOLF

A wrong FAKE stamp on a real flash sale is worse than a missed fake, so:
- one reset only gets an amber "reload to confirm"; it takes two to stamp FAKE
- a countdown has to be seen ticking down before it counts, so printed dates and
  clocks are never mistaken for timers
- delivery cut-offs ("Order within 3 hrs"), one-time-code timers and video
  players restart by design and are ignored
- a new sale after the old one ended is not a reset

WHERE IT WORKS

By itself on Shopee and Lazada in every market they run, and on Temu, Shein,
AliExpress and Amazon. On any other shop, open the popup and press "Check this
page once", or "Watch this site", which asks for access to that one site.

PRIVACY

No account, no server, no analytics. The extension never makes a network
request. Readings stay in your browser's local storage so the next reload has
something to compare with, and "Forget this page" deletes them.

Free and open source (MIT).

Not affiliated with, endorsed by, or connected to any of the shops named above.
A mark describes how the page behaved in your browser across reloads. It says
nothing about whether a discount is genuine.
```

### Single purpose (Chrome)

```
Detect fake urgency on shopping pages - sale countdowns that restart on reload,
made-up "people viewing" counts and low-stock claims that go back up - by
comparing what the page shows across reloads and visits, and mark them on the page.
```

### Permission justifications (Chrome; Edge asks the same in its notes field)

**`storage`**

```
Stores, on the user's device only, the readings the extension needs to compare
across reloads: for each product page, the page path without its query string,
the countdown/counter text it found, and the time and value of up to 30
readings. Also the per-shop on/off switch. Nothing is transmitted.
```

**`activeTab`**

```
The popup's "Check this page once" button runs the same check on a shop that is
not in the extension's host list, for the one tab the user is looking at, at
the moment they press it. It is used so that no access is held to sites the user
has not asked about.
```

**`scripting`**

```
Used to run the extension's own bundled files in the current tab when the user
presses a popup button: to start the "Test this timer" reload test, to rescan
the page, and to run the check on a site outside the host list. No code is
downloaded, fetched or generated at runtime.
```

**Host access - the listed shopping domains**

```
The content script reads sale countdowns, "people viewing" counters and
low-stock claims already shown on product and search pages of these shops, and
draws its marks over them. These are the shops the feature is for, so they are
the only pages it runs on by itself. The same domains are listed as host
permissions so the popup can start the reload test on them. The one non-shop
entry is the extension's own demo page on GitHub Pages.
```

**Optional host permissions (`https://*/*`, `http://*/*`)**

```
Never granted at install. When the user presses "Watch this site" on a shop that
is not listed, the extension requests access to that one origin only, so it can
keep reading the countdown after each reload of the test and on later visits.
The user can revoke it at any time in the browser's extension settings.
```

**Remote code**

No. All code is in the package. Nothing is fetched or evaluated at runtime.

### Data usage disclosures (Chrome)

Tick **Website content**: the extension reads text on shop pages and keeps readings of it on the
device. Google's User Data FAQ asks for disclosure even when data stays local. Then confirm all
three certifications (not sold, not used for unrelated purposes, not used for creditworthiness).

### Privacy policy URL

`https://github.com/cig13zs/timertruth/blob/main/PRIVACY.md`

### Screenshots (1280x800)

All in `docs/media/`, recorded from the real extension by `node tests/media.mjs`:

1. `store-1-fake-timer-1280x800.png` - the FAKE stamp after the reload test (the whole pitch)
2. `store-2-honest-timer-1280x800.png` - the same shop with an honest countdown: green checks, no stamp
3. `store-3-popup-1280x800.png` - the popup with the page list and totals
4. `store-4-evidence-1280x800.png` - the evidence card behind a stamp

Promo tile (Chrome small tile, Edge): `store/promo-440x280.png`. Icon: `src/icons/icon128.png`.

---

## Chrome Web Store specifics

- Upload `dist/timertruth-1.0.0-chrome.zip`.
- Language: English. Region: all.
- Account: the same Chrome Web Store developer account as Per Piece. The 2026-10-23 research
  note says the account's extension slots are the constraint; if none is free, one has to be
  freed first (it suggests Sift for AO3, which is the owner's call).

## Edge Add-ons specifics

- Upload `dist/timertruth-1.0.0-chrome.zip` (the Chrome build runs unchanged on Edge).
- Partner Center account: Microsoft Edge program, individual. Free.
- "Notes for certification": paste the permission justifications above and add:

```
To test: open https://cig13zs.github.io/timertruth/demo/ (a demo shop made for
this extension), click the TimerTruth toolbar button and press "Test this
timer". The page reloads three times and a FAKE stamp appears over the flash
sale countdown, while the free-shipping countdown gets a green "consistent" mark.
```

## Firefox Add-ons (AMO) specifics

- Upload `dist/timertruth-1.0.0-firefox.zip`. Listed. Firefox 140+ on desktop, 142+ on Android.
- Account: addons.mozilla.org developer account (free, Firefox account login).
- Summary (250 max): use the short description above.
- Tags: shopping, dark patterns, privacy, countdown, deals.
- Support site: `https://github.com/cig13zs/timertruth`. Licence: MIT.
- Source code: not required. Nothing is minified, transpiled or bundled; the zip holds the files
  from `src/` as written, plus the adapted manifest.
- Data collection: the manifest declares `data_collection_permissions: none`.
- Notes to reviewer: the same testing note as Edge.
- `addons-linter dist/firefox` reports 0 errors and 0 warnings for this build.

## Greasy Fork

- Upload `dist/timertruth.user.js` (rebuild first so the version matches).
- Account: greasyfork.org, sign in with GitHub. No review queue; it is live on posting.
- Name: `TimerTruth: fake sale timer detector`
- Description (the short line comes from the script's `@description`).
- Additional info:

```
This sale timer is fake. Watch it reset.

TimerTruth notes the deadline every sale countdown promises. When a reload moves
the deadline later, it stamps the timer FAKE with the number of resets. Real
countdowns get a small green "consistent" mark. It also flags "people viewing"
numbers that jump around between reloads, and "only 3 left" counts that go back
up.

Runs on Shopee, Lazada, Temu, Shein, AliExpress and Amazon. To add another shop,
add a @match line for it in your userscript manager.

Menu commands (in your userscript manager's menu):
- Test this timer (reloads 3 times): reloads the tab three times and shows the verdict
- Switch TimerTruth on/off for this shop
- Forget this page

Everything is stored in your userscript manager's own storage, never in the
shop's cookies or local storage. No network requests.

Source, tests and the browser extension version:
https://github.com/cig13zs/timertruth
```

- Licence: MIT. Greasy Fork rejects minified code; this file is plain source.
