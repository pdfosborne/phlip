#!/usr/bin/env node
/**
 * Lightweight checks for hostingAvailable / isJoinOnlyNativeShell behaviour.
 * Run: node phlip-ios/scripts/check-hosting-gate.js
 */
const fs = require("fs");
const path = require("path");

const helpersPath = path.join(
  __dirname,
  "../../phlip-web/public/scripts/helpers/helpers-part3.js",
);
const hostPath = path.join(
  __dirname,
  "../../phlip-web/public/scripts/host/host-settings-part1.js",
);

const helpers = fs.readFileSync(helpersPath, "utf8");
const host = fs.readFileSync(hostPath, "utf8");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

assert(helpers.includes("function hostingAvailable()"), "hostingAvailable helper present");
assert(helpers.includes("function isJoinOnlyNativeShell()"), "isJoinOnlyNativeShell helper present");
assert(
  host.includes("Hosting is not available on Apple devices. Android is required to host a server."),
  "Apple hosting copy in host-settings.js",
);
assert(host.includes("mountHostUnavailableOverlay"), "unavailable overlay present");
assert(host.includes("isJoinOnlyNativeShell"), "host-settings gates on join-only shell");

// Behaviour simulation (mirrors helpers.js — keep in sync if those change).
function hostingAvailable(AshNative) {
  try {
    if (AshNative && typeof AshNative.hostingAvailable === "function") {
      return !!AshNative.hostingAvailable();
    }
  } catch { /* ignore */ }
  return false;
}
function isJoinOnlyNativeShell(AshNative) {
  try {
    return !!(AshNative
      && typeof AshNative.hostingAvailable === "function"
      && !AshNative.hostingAvailable());
  } catch { return false; }
}

assert(hostingAvailable({ hostingAvailable: () => true }) === true, "Android: hostingAvailable true");
assert(isJoinOnlyNativeShell({ hostingAvailable: () => true }) === false, "Android: not join-only");
assert(hostingAvailable({ hostingAvailable: () => false }) === false, "iOS: hostingAvailable false");
assert(isJoinOnlyNativeShell({ hostingAvailable: () => false }) === true, "iOS: join-only");
assert(hostingAvailable(undefined) === false, "browser: hostingAvailable false");
assert(isJoinOnlyNativeShell(undefined) === false, "browser: not join-only (no Apple copy)");

console.log("check-hosting-gate: OK");
