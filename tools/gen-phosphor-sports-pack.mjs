#!/usr/bin/env node
/**
 * Generate phlip-web/public/scripts/helpers/icons-phosphor-sports-pack.js
 * from Phosphor Icons (MIT). Regular weight, sports-tagged, no airplane glyphs.
 *
 *   node tools/gen-phosphor-sports-pack.mjs
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "phlip-web/public/scripts/helpers/icons-phosphor-sports-pack.js");
const RAW_BASE = "https://raw.githubusercontent.com/phosphor-icons/core/main";
const SKIP = /airplane|paper-plane/i;
const SKIP_NAMES = new Set([
  "dribbble-logo",
  "horse",
  "ranking",
  "strategy",
  "timer",
  "baseball-cap",
  "beanie",
  "boot",
  "sneaker",
  "sneaker-move",
  "person-arms-spread",
  "sailboat",
]);

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

function sportsNamesFromCatalog(src) {
  const names = [];
  const nameRe = /^\s+name: "([^"]+)"/gm;
  let m;
  while ((m = nameRe.exec(src))) {
    const name = m[1];
    if (!name || SKIP.test(name) || SKIP_NAMES.has(name)) continue;
    const from = m.index;
    const codeIdx = src.indexOf("codepoint:", from);
    if (codeIdx < 0 || codeIdx - from > 1800) continue;
    const block = src.slice(from, codeIdx);
    const tagsIdx = block.indexOf("tags:");
    if (tagsIdx < 0) continue;
    if (!block.slice(tagsIdx).includes('"sports"')) continue;
    names.push(name);
  }
  return [...new Set(names)].sort();
}

async function main() {
  console.log("Fetching Phosphor catalog…");
  const catalog = await fetchText(`${RAW_BASE}/src/icons.ts`);
  const names = sportsNamesFromCatalog(catalog);
  if (!names.length) throw new Error("No sports-tagged Phosphor icons found");
  console.log(`Sports icons (excluding airplane/clothing/logos): ${names.join(", ")}`);

  const pack = Object.create(null);
  for (const name of names) {
    const url = `${RAW_BASE}/assets/regular/${name}.svg`;
    console.log(`  ${name}`);
    const svg = await fetchText(url);
    const inner = svgInner(svg);
    if (!inner) throw new Error(`empty SVG for ${name}`);
    pack[name] = inner;
  }

  const lines = [];
  lines.push(`/* Auto-generated — do not edit.`);
  lines.push(` * Phosphor Icons regular (MIT). Sports-tagged, airplane glyphs omitted.`);
  lines.push(` * Regenerate: node tools/gen-phosphor-sports-pack.mjs`);
  lines.push(` * ${names.length} icons.`);
  lines.push(` */`);
  lines.push(`const PHOSPHOR_SPORTS_PACK = {`);
  for (const name of names) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(pack[name])},`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`const PHOSPHOR_SPORTS_NAMES = ${JSON.stringify(names)};`);
  lines.push(``);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
