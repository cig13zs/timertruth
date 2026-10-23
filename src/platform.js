/* TimerTruth - extension storage. The userscript build swaps this file for
 * one backed by the userscript manager's own storage; content.js only ever
 * talks to TT.platform. Callback style on purpose: it works the same on
 * Chrome, Edge and Firefox.
 */
(function () {
  'use strict';
  const TT = (globalThis.TT = globalThis.TT || {});
  if (TT.platform) return;
  const call = (fn) => new Promise((resolve, reject) => {
    try {
      fn((v) => {
        const err = chrome.runtime.lastError;
        if (err) reject(err); else resolve(v);
      });
    } catch (e) { reject(e); }
  });
  TT.platform = {
    kind: 'extension',
    get: (keys) => call((done) => chrome.storage.local.get(keys, done)),
    all: () => call((done) => chrome.storage.local.get(null, done)),
    set: (obj) => call((done) => chrome.storage.local.set(obj, done)),
    remove: (keys) => call((done) => chrome.storage.local.remove(keys, done)),
    onChange: (fn) => chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local') fn(ch); }),
    menu: () => {},
  };
})();
