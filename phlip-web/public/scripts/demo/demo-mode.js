/* demo-mode.js — namespace demo localStorage so phlipapp.com Publish stays clean.
 *
 * Globals in:  isDemoMode (theme-boot.js)
 * Globals out: DemoMode (prefix, raw localStorage accessors)
 * Load after:  storage.js
 * Load before: local-sync-store.js, net, personal
 *
 * Must not: talk to a host, register a service worker, or write ash_* keys unprefixed
 */
(function () {
  "use strict";

  const PREFIX = "phlip-demo-";

  if (typeof isDemoMode !== "function" || !isDemoMode()) {
    window.DemoMode = { prefix: PREFIX, active: false };
    return;
  }

  const proto = Storage.prototype;
  const origGet = proto.getItem;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  const origClear = proto.clear;
  const origKey = proto.key;
  const lengthDesc = Object.getOwnPropertyDescriptor(proto, "length");
  const origLength = lengthDesc && lengthDesc.get;

  proto.getItem = function (key) {
    if (this !== localStorage) return origGet.call(this, key);
    return origGet.call(this, PREFIX + key);
  };
  proto.setItem = function (key, value) {
    if (this !== localStorage) return origSet.call(this, key, value);
    return origSet.call(this, PREFIX + key, value);
  };
  proto.removeItem = function (key) {
    if (this !== localStorage) return origRemove.call(this, key);
    return origRemove.call(this, PREFIX + key);
  };
  proto.clear = function () {
    if (this !== localStorage) return origClear.call(this);
    const drop = [];
    const len = origLength ? origLength.call(this) : this.length;
    for (let i = 0; i < len; i++) {
      const k = origKey.call(this, i);
      if (k && k.startsWith(PREFIX)) drop.push(k);
    }
    for (const k of drop) origRemove.call(this, k);
  };

  window.DemoMode = {
    prefix: PREFIX,
    active: true,
    rawGet: (key) => origGet.call(localStorage, key),
    rawSet: (key, value) => origSet.call(localStorage, key, value),
    rawRemove: (key) => origRemove.call(localStorage, key),
    rawKey: (i) => origKey.call(localStorage, i),
    rawLength: () => (origLength ? origLength.call(localStorage) : localStorage.length),
    clearPrefixed() {
      const drop = [];
      const len = origLength ? origLength.call(localStorage) : localStorage.length;
      for (let i = 0; i < len; i++) {
        const k = origKey.call(localStorage, i);
        if (k && k.startsWith(PREFIX)) drop.push(k);
      }
      for (const k of drop) origRemove.call(localStorage, k);
    },
  };
})();
