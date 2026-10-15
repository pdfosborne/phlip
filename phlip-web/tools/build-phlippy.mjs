#!/usr/bin/env node
/**
 * Compile vendor/bloub/player.ts to a classic IIFE for public/scripts/shell/phlippy.js.
 * Runtime stays script tags — this is a one-shot vendor build, not an app bundler.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const banner =
  "/* phlippy.js — live SVG idle face for the timeline Create FAB (Bloub engine, MIT).\n" +
  " * Globals out: Phlippy (mount, wake, sleep, lookAt, express, play, syncTheme, host)\n" +
  " * Load before: phlippy-fab.js\n" +
  " * Must not: Vue, ES modules at runtime\n" +
  " * Source: vendor/bloub/ — rebuild with: node tools/build-phlippy.mjs\n" +
  " */";

const result = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild",
    "vendor/bloub/player.ts",
    "--bundle",
    "--format=iife",
    "--outfile=public/scripts/shell/phlippy.js",
    "--target=es2018",
    "--minify",
    "--platform=browser",
    "--legal-comments=none",
    `--banner:js=${banner}`,
  ],
  { cwd: root, stdio: "inherit" }
);

process.exit(result.status ?? 1);
