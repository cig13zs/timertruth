# Privacy policy - TimerTruth

Last updated: 23 October 2026

## What is collected

Nothing leaves your device.

TimerTruth does not collect, transmit, sell or share any data. There is no server, no account,
no analytics, no tracking pixel, no crash reporter, no remote configuration and no third-party
service of any kind. The extension never makes a network request.

## What it reads

On the shopping sites listed in the extension's manifest (Shopee, Lazada, Temu, Shein,
AliExpress and Amazon, plus the TimerTruth demo shop on GitHub Pages) the extension reads text
that is already on the page you are looking at, looking for four kinds of claims:

- sale countdowns, such as "Flash sale ends in 09:58"
- live counters, such as "23 people are viewing this" or "50 bought in the past hour"
- low-stock claims, such as "Only 3 left"
- "ends today" claims

To find them it looks over the visible text of the page, the same text you see. It keeps only
the readings listed below. It never reads what you type into forms, and it never stores prices,
addresses, payment details or anything about your account.

## What is stored, and where

To tell whether a countdown restarted, TimerTruth has to remember what it showed last time. For
each product page where it found one of the claims above, it keeps:

- the shop's host name and the page path, with the query string and anything after `#`
  removed (store URLs often carry session and referral ids)
- for each claim on that page: the claim's own text cut to 80 characters (for example "Flash
  sale ends in 09:58"), a short label made from the words around it with the digits removed
  (for example "flash sale ends in"), the link of the product tile it sits in on a search page,
  and up to 30 readings, each with the time of the reading and the number shown (or, for a
  countdown, the deadline it implied)
- a small per-shop index of the latest reading from each page, used only to notice the same
  countdown or the same viewer count on many products
- whether you switched TimerTruth off for a shop
- the progress of a running "Test this timer", which lasts a few seconds
- the list of sites you chose to watch with "Watch this site"

This is kept in the browser's local extension storage on your own computer (or, for the
userscript, in your userscript manager's storage). It is not synced and not transmitted. At
most 500 pages are kept; the least recently visited go first. **Forget this page** in the popup
deletes a page's record. Removing the extension removes all of it.

The userscript never uses the shop's own cookies or local storage, which the shop's scripts
could read.

## Test this timer

The **Test this timer** button reloads the current tab three times and compares the readings.
It runs only when you press it, only on that tab, and stops after the third reload.

## Copy evidence

**Copy evidence** puts a plain-text summary of the readings for the current page on your
clipboard. Nothing is sent anywhere; what you do with the text is up to you.

## Permissions

**`storage`** - keeps the readings and settings described above on your device.

**`activeTab`** - lets **Check this page once** work on a site that is not listed, for that one
tab, only when you press it.

**`scripting`** - the mechanism the popup uses to run the extension's own bundled files in the
current tab and to start the reload test. No code is downloaded or generated at runtime.

**Access to the listed shopping sites** - the extension runs by itself only on those sites,
because those are the pages it checks. It has no access to your browsing history, your other
tabs, or any account you are signed in to.

**Optional access to one more site at a time** - when you press **Watch this site** on a shop
that is not listed, the browser asks you to allow TimerTruth on that one site. Without that it
could not keep reading the countdown after the page reloads. Nothing is granted at install, and
you can remove it in the browser's extension settings.

## Accuracy

TimerTruth reports what your browser saw on the page across reloads and visits. A mark is a
reading of the page's behaviour, not a legal finding about a shop, and it says nothing about
whether a discount is genuine. When the evidence is thin it shows a softer amber label or
nothing at all.

## Contact

Open an issue on https://github.com/cig13zs/timertruth.
