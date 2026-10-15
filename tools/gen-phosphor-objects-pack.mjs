#!/usr/bin/env node
/**
 * Generate phlip-web/public/scripts/helpers/icons-phosphor-objects-pack.js
 * from Phosphor Icons (MIT). Regular weight, IconCategory.OBJECTS.
 *
 *   node tools/gen-phosphor-objects-pack.mjs
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "phlip-web/public/scripts/helpers/icons-phosphor-objects-pack.js");
const RAW_BASE = "https://raw.githubusercontent.com/phosphor-icons/core/main";
const CONCURRENCY = 8;

function svgInner(svgText) {
  return String(svgText || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<svg\b[^>]*>/i, "")
    .replace(/<\/svg>/i, "")
    .replace(/<rect[^>]*width="256"[^>]*\/?>(<\/rect>)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

function objectNamesFromCatalog(src) {
  const names = [];
  const nameRe = /^\s+name: "([^"]+)"/gm;
  let m;
  while ((m = nameRe.exec(src))) {
    const name = m[1];
    if (!name) continue;
    const from = m.index;
    const codeIdx = src.indexOf("codepoint:", from);
    if (codeIdx < 0 || codeIdx - from > 1800) continue;
    const block = src.slice(from, codeIdx);
    if (!block.includes("IconCategory.OBJECTS")) continue;
    names.push(name);
  }
  return [...new Set(names)].sort();
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  console.log("Fetching Phosphor catalog…");
  const catalog = await fetchText(`${RAW_BASE}/src/icons.ts`);
  const names = objectNamesFromCatalog(catalog);
  if (!names.length) throw new Error("No OBJECTS-category Phosphor icons found");
  console.log(`Objects icons: ${names.length}`);

  const pack = Object.create(null);
  await mapPool(names, CONCURRENCY, async (name) => {
    const url = `${RAW_BASE}/assets/regular/${name}.svg`;
    console.log(`  ${name}`);
    const svg = await fetchText(url);
    const inner = svgInner(svg);
    if (!inner) throw new Error(`empty SVG for ${name}`);
    pack[name] = inner;
  });

  const lines = [];
  lines.push(`/* Auto-generated — do not edit.`);
  lines.push(` * Phosphor Icons regular (MIT). Objects category.`);
  lines.push(` * Regenerate: node tools/gen-phosphor-objects-pack.mjs`);
  lines.push(` * ${names.length} icons.`);
  lines.push(` */`);
  lines.push(`const PHOSPHOR_OBJECTS_PACK = {`);
  for (const name of names) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(pack[name])},`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`const PHOSPHOR_OBJECTS_NAMES = ${JSON.stringify(names)};`);
  lines.push(``);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
