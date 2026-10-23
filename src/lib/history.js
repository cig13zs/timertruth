/* TimerTruth - what is kept between visits, and how it is trimmed.
 *
 * Storage layout (chrome.storage.local, or the userscript manager's storage):
 *   p:<host><path>  one record per product page: every tracked item and its
 *                   readings, at most one reading per page load
 *   h:<host>        a small index per shop, used only for the "same timer on
 *                   every product" and "same viewer count everywhere" checks
 *   off:<host>      true when the user switched the shop off
 *   demo            progress of a running "Test this timer" (a few seconds long)
 * Nothing here is ever sent anywhere.
 */
(function () {
  'use strict';
  const NODE = typeof module === 'object' && module !== null && !!module.exports;

  const MAX_OBS = 30;        // readings kept per item
  const MAX_ITEMS = 40;      // items kept per page
  const MAX_INDEX = 300;     // index entries kept per shop
  const MAX_PAGES = 500;     // page records kept in total

  const hostOf = (hostname) => String(hostname || '').toLowerCase().replace(/^www\./, '');

  // The page a reading belongs to. Query strings and hashes are dropped: they
  // carry tracking and session ids, and they differ between two visits to the
  // same product. Amazon puts a changing slug in front of the product id, so
  // its product pages are keyed on the id alone.
  function pagePath(pathname, host) {
    let p = String(pathname || '/');
    if (/(^|\.)amazon\./.test(host || '')) {
      const m = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(p);
      if (m) return `/dp/${m[1].toUpperCase()}`;
    }
    p = p.replace(/\/+$/, '') || '/';
    return p.slice(0, 200);
  }

  const pageKey = (host, path) => `p:${host}${path}`;
  const indexKey = (host) => `h:${host}`;
  const offKey = (host) => `off:${host}`;

  const newRecord = (host, path, now) => ({ host, path, first: now, last: now, items: {} });

  /* Adds one reading. Returns false when this load already has one for that
   * item, so a page re-rendering its timer cannot count as a second load.
   */
  function addObservation(rec, cand, obs, loadId, now) {
    let it = rec.items[cand.key];
    if (!it) it = rec.items[cand.key] = { kind: cand.kind, label: cand.label, anchor: cand.anchor || '', obs: [] };
    const last = it.obs[it.obs.length - 1];
    if (last && last.l === loadId) return false;
    it.obs.push({ ...obs, l: loadId });
    if (it.obs.length > MAX_OBS) it.obs.splice(0, it.obs.length - MAX_OBS);
    it.text = String(cand.text || '').slice(0, 80);
    it.seen = now;
    rec.last = now;
    const keys = Object.keys(rec.items);
    if (keys.length > MAX_ITEMS) {
      keys.sort((a, b) => (rec.items[a].seen || 0) - (rec.items[b].seen || 0));
      for (const k of keys.slice(0, keys.length - MAX_ITEMS)) delete rec.items[k];
    }
    return true;
  }

  /* Keeps the shop index in step with a page's item. Only timers and live
   * counters are indexed; that is all the cross-product checks read.
   */
  function updateIndex(index, path, key, item) {
    if (!index.entries) index.entries = [];
    const o = item.obs;
    if (!o || !o.length) return index;
    const last = o[o.length - 1];
    let e = null;
    if (item.kind === 'timer') e = { p: path, key, k: 'timer', s: last.s, e: last.e, tol: last.tol, t: last.t };
    else if (['viewers', 'carts', 'bought'].includes(item.kind)) {
      e = { p: path, key, k: item.kind, v: last.v, varied: new Set(o.map((x) => x.v)).size > 1, t0: o[0].t, t: last.t };
    }
    if (!e) return index;
    index.entries = index.entries.filter((x) => !(x.p === path && x.key === key));
    index.entries.push(e);
    if (index.entries.length > MAX_INDEX) {
      index.entries.sort((a, b) => a.t - b.t);
      index.entries.splice(0, index.entries.length - MAX_INDEX);
    }
    return index;
  }

  // Which page records to drop once there are too many: the least recently seen.
  function prunePlan(records, max = MAX_PAGES) {
    const keys = Object.keys(records).filter((k) => k.startsWith('p:'));
    if (keys.length <= max) return [];
    keys.sort((a, b) => (records[a].last || 0) - (records[b].last || 0));
    return keys.slice(0, keys.length - max);
  }

  const api = {
    MAX_OBS, MAX_ITEMS, MAX_INDEX, MAX_PAGES, hostOf, pagePath, pageKey, indexKey, offKey,
    newRecord, addObservation, updateIndex, prunePlan,
  };
  if (NODE) module.exports = api;
  else globalThis.TT.history = api;
})();
