#!/usr/bin/env node
/**
 * Generate phlip-web/public/scripts/helpers/icons-lucide-pack.js from Lucide.
 *
 * Pins Lucide 0.525.0 (ISC). Re-run after bumping LUCIDE_VERSION:
 *   node tools/gen-lucide-icon-pack.mjs
 *
 * Sources:
 *   - lucide-static (npm) — SVG path markup
 *   - lucide GitHub tag — per-icon categories + category titles
 */
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { Readable } from "stream";

const LUCIDE_VERSION = "0.525.0";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "phlip-web/public/scripts/helpers/icons-lucide-pack.js");

/** Lucide category ids → section order / display titles (plan allowlist). */
const CATEGORY_ORDER = [
  ["accessibility", "Accessibility"],
  ["account", "Accounts & access"],
  ["arrows", "Arrows"],
  ["buildings", "Buildings"],
  ["communication", "Communication"],
  ["connectivity", "Connectivity"],
  ["design", "Design"],
  ["devices", "Devices"],
  ["emoji", "Emoji"],
  ["files", "File icons"],
  ["finance", "Finance"],
  ["food-beverage", "Food & beverage"],
  ["gaming", "Gaming"],
  ["home", "Home"],
  ["mail", "Mail"],
  ["medical", "Medical"],
  ["nature", "Nature"],
  ["navigation", "Navigation and places"],
  ["notifications", "Notification"],
  ["people", "People"],
  ["seasons", "Seasons"],
  ["shapes", "Shapes"],
  ["social", "Social"],
  ["sports", "Sports"],
  ["time", "Time and calendar"],
  ["tools", "Tools"],
  ["transportation", "Transportation"],
  ["travel", "Travel"],
  ["weather", "Weather"],
];
const ALLOW = new Set(CATEGORY_ORDER.map(([id]) => id));

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extractTarGz(tgz, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", destDir], { stdio: "inherit" });
}

function svgInner(svgText) {
  return String(svgText || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<svg\b[^>]*>/i, "")
    .replace(/<\/svg>/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jsString(s) {
  return JSON.stringify(s);
}

async function main() {
  const work = join(tmpdir(), `phlip-lucide-${LUCIDE_VERSION}`);
  mkdirSync(work, { recursive: true });
  const staticTgz = join(work, "lucide-static.tgz");
  const srcTgz = join(work, "lucide-src.tgz");

  console.log(`Fetching lucide-static@${LUCIDE_VERSION}…`);
  await download(
    `https://registry.npmjs.org/lucide-static/-/lucide-static-${LUCIDE_VERSION}.tgz`,
    staticTgz,
  );
  console.log(`Fetching lucide@${LUCIDE_VERSION} source (categories)…`);
  await download(
    `https://github.com/lucide-icons/lucide/archive/refs/tags/${LUCIDE_VERSION}.tar.gz`,
    srcTgz,
  );

  const staticRoot = join(work, "static");
  const srcRoot = join(work, "src");
  extractTarGz(staticTgz, staticRoot);
  extractTarGz(srcTgz, srcRoot);

  const iconsSvgDir = join(staticRoot, "package/icons");
  const metaDir = join(srcRoot, `lucide-${LUCIDE_VERSION}/icons`);
  const catDir = join(srcRoot, `lucide-${LUCIDE_VERSION}/categories`);

  if (!existsSync(iconsSvgDir) || !existsSync(metaDir)) {
    throw new Error("Unexpected Lucide archive layout");
  }

  // Prefer official category titles when present.
  const titles = new Map(CATEGORY_ORDER);
  for (const [id] of CATEGORY_ORDER) {
    const p = join(catDir, `${id}.json`);
    if (!existsSync(p)) continue;
    try {
      const meta = JSON.parse(readFileSync(p, "utf8"));
      if (meta.title) titles.set(id, meta.title);
    } catch {}
  }

  const pack = Object.create(null);
  const byCat = new Map(CATEGORY_ORDER.map(([id]) => [id, []]));

  for (const file of readdirSync(metaDir)) {
    if (!file.endsWith(".json")) continue;
    const name = file.slice(0, -5);
    let meta;
    try {
      meta = JSON.parse(readFileSync(join(metaDir, file), "utf8"));
    } catch {
      continue;
    }
    const cats = Array.isArray(meta.categories) ? meta.categories.filter((c) => ALLOW.has(c)) : [];
    if (!cats.length) continue;

    const svgPath = join(iconsSvgDir, `${name}.svg`);
    if (!existsSync(svgPath)) {
      console.warn(`skip ${name}: missing SVG`);
      continue;
    }
    const inner = svgInner(readFileSync(svgPath, "utf8"));
    if (!inner) {
      console.warn(`skip ${name}: empty SVG`);
      continue;
    }
    pack[name] = inner;
    for (const c of cats) byCat.get(c)?.push(name);
  }

  for (const list of byCat.values()) list.sort((a, b) => a.localeCompare(b));

  const names = Object.keys(pack).sort((a, b) => a.localeCompare(b));
  const sections = CATEGORY_ORDER
    .map(([id]) => ({
      id,
      title: titles.get(id) || id,
      icons: byCat.get(id) || [],
    }))
    .filter((s) => s.icons.length);

  const lines = [];
  lines.push(`/* Auto-generated — do not edit.`);
  lines.push(` * Lucide ${LUCIDE_VERSION} (ISC). Regenerate: node tools/gen-lucide-icon-pack.mjs`);
  lines.push(` * ${names.length} unique icons across ${sections.length} picker categories.`);
  lines.push(` */`);
  lines.push(`const LUCIDE_ICON_PACK = {`);
  for (const name of names) {
    lines.push(`  ${jsString(name)}: ${jsString(pack[name])},`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`const ICON_PICKER_SECTIONS = [`);
  for (const s of sections) {
    lines.push(`  { id: ${jsString(s.id)}, title: ${jsString(s.title)}, icons: ${jsString(s.icons)} },`);
  }
  lines.push(`];`);
  lines.push(``);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(`Wrote ${OUT}`);
  console.log(`Unique icons: ${names.length}; section listings: ${sections.reduce((n, s) => n + s.icons.length, 0)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
