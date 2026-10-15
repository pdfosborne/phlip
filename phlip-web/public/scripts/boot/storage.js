/* storage.js — safe localStorage wrappers for JSON and text.
 *
 * Globals in:  none (uses window.localStorage)
 * Globals out: storageGetJson, storageSetJson, storageGetText, storageSetText, storageRemove
 * Load after:  core.js (early shared util)
 * Load before: feature scripts that adopt these helpers
 *
 * Malformed/missing JSON returns the caller fallback. Quota/privacy failures
 * do not throw into UI flows.
 */
(function () {
  "use strict";

  function storageGetText(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? (fallback === undefined ? null : fallback) : v;
    } catch {
      return fallback === undefined ? null : fallback;
    }
  }

  function storageSetText(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }

  function storageGetJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === "") return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function storageSetJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  window.storageGetText = storageGetText;
  window.storageSetText = storageSetText;
  window.storageGetJson = storageGetJson;
  window.storageSetJson = storageSetJson;
  window.storageRemove = storageRemove;
})();
