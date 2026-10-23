/* TimerTruth - userscript storage, in place of src/platform.js.
 * Uses the manager's own storage (Tampermonkey, Violentmonkey, Greasemonkey),
 * never the shop's localStorage, which the shop's own scripts could read.
 */
(function () {
  'use strict';
  const TT = (globalThis.TT = globalThis.TT || {});
  if (TT.platform) return;
  /* global GM, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_registerMenuCommand, GM_addValueChangeListener */
  const gm4 = typeof GM === 'object' && GM && typeof GM.getValue === 'function';
  const getOne = (k) => (gm4 ? GM.getValue(k) : Promise.resolve(GM_getValue(k)));
  const setOne = (k, v) => (gm4 ? GM.setValue(k, v) : Promise.resolve(GM_setValue(k, v)));
  const delOne = (k) => (gm4 ? GM.deleteValue(k) : Promise.resolve(GM_deleteValue(k)));
  const list = () => (gm4 ? GM.listValues() : Promise.resolve(GM_listValues()));
  const listeners = [];
  const notify = (ch) => { for (const fn of listeners) fn(ch); };
  TT.platform = {
    kind: 'userscript',
    async get(keys) {
      const out = {};
      for (const k of [].concat(keys)) { const v = await getOne(k); if (v !== undefined) out[k] = v; }
      return out;
    },
    async all() { return this.get(await list()); },
    async set(obj) {
      const ch = {};
      for (const [k, v] of Object.entries(obj)) { await setOne(k, v); ch[k] = { newValue: v }; }
      notify(ch);
    },
    async remove(keys) {
      const ch = {};
      for (const k of [].concat(keys)) { await delOne(k); ch[k] = { newValue: undefined }; }
      notify(ch);
    },
    onChange(fn) { listeners.push(fn); },
    menu(name, fn) {
      if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(name, fn);
      else if (gm4 && typeof GM.registerMenuCommand === 'function') GM.registerMenuCommand(name, fn);
    },
  };
})();
