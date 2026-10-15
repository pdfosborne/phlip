#!/usr/bin/env python3
"""Count raw design values in the Phlip web client CSS that should be design tokens.

Companion to `design-system/` (the spec) and
`phlip-web/public/styles/00-foundation.css` (the tokens). Every stylesheet
under `phlip-web/public/styles/` is scanned declaration by declaration; a value
written as a literal (a hex colour, a `13px` font size, a `180ms` transition)
instead of a `var(--token)` counts as drift, per module and per category.

  - Custom-property declarations (`--x: ...;`) are not counted as drift: they
    *define* tokens (global ones in 00-foundation.css, local ones in
    components). Their values are still scanned for legacy/token var() uses.
  - Literals inside `var()` fallbacks are ignored (`var(--moss, #3d453c)`).

Categories:
  colour       hex / rgb() / rgba() / hsl() literals
  font-size    font-size literals          (+ off-scale: px not in the type scale)
  weight       font-weight literals        (+ off-scale: not 400 / 700)
  line-height  line-height literals
  radius       border-radius literals      (+ off-scale: px not in the radius scale)
  spacing      padding / margin / gap literals (+ off-scale: px not in the space scale)
  duration     transition / animation durations
  easing       transition / animation timing functions
  z-index      z-index literals above 9 (0-9 is component-local)
  shadow       box-shadow literals
  legacy       var() uses of deprecated alias tokens (--chalk, --sage, ...)
  tokens       var() uses of design-system tokens (adoption, not drift)

The scales mirror design-system/03-layout.md and 02-typography.md; update both
together.

Usage:
  python3 tools/design_token_audit.py
  python3 tools/design_token_audit.py --json tools/design_token_baseline.json
  python3 tools/design_token_audit.py --baseline tools/design_token_baseline.json
      # exit 1 if any module x category drift count rose above the baseline
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLES_DIR = ROOT / "phlip-web" / "public" / "styles"

TYPE_SCALE_PX = {9, 11, 12, 13, 14, 15, 16, 18, 22, 28}
RADIUS_SCALE_PX = {0, 2, 4, 8, 12, 16, 999}
SPACE_SCALE_PX = {0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48}

LEGACY_ALIASES = {
    "chalk", "sage", "marigold", "marigold-dim", "moss", "bottle", "bottle-2",
    "ember", "ink", "card-bg", "highlight", "highlight-dim", "highlight-tint",
    "ui-accent", "ui-accent-dim", "ui-tint", "tint-accent",
}
TOKEN_RE = re.compile(
    r"^(space-|radius-(gem|xs|sm|md|lg|pill|round)$|fs-|fw-|lh-|ls-|icon-|dur-|ease-|z-|"
    r"shadow-|scrim-|veil-|hit-min|row-min$|content-max$|gutter$|pad-|gap-feed$|"
    r"surface-|page-bg$|border$|border-strong$|border-control$|text-(primary|secondary|muted)$|"
    r"periwinkle-|notify-blue$|red-(border|text)$|success-text$|action-base$|on-action$|"
    r"menu-button-base$|on-menu-button$|focus-ring-color$|ring-selected$|danger-wash$)"
)

DRIFT = ["colour", "font-size", "weight", "line-height", "radius", "spacing",
         "duration", "easing", "z-index", "shadow", "legacy"]
OFF = ["font-size-off", "weight-off", "radius-off", "spacing-off"]

COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
RULE_RE = re.compile(r"([^{}]*)\{([^{}]*)\}")  # innermost blocks: (prelude, body)
COLOUR_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(")
PX_RE = re.compile(r"(-?\d*\.?\d+)px")
DURATION_RE = re.compile(r"(?<![\w.-])\d*\.?\d+m?s\b")
EASING_RE = re.compile(r"cubic-bezier\(|steps\(|\b(?:ease(?:-in-out|-in|-out)?|linear)\b")
NUMBER_RE = re.compile(r"-?\d+")
VAR_NAME_RE = re.compile(r"var\(\s*--([\w-]+)")
SPACING_PROPS = re.compile(r"^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(row-|column-)?gap$")


def strip_var_fallbacks(value: str) -> str:
    """`var(--a, #fff)` -> `var(--a)` (fallbacks may nest parentheses)."""
    out, i = [], 0
    while True:
        j = value.find("var(", i)
        if j < 0:
            out.append(value[i:])
            return "".join(out)
        out.append(value[i:j])
        depth, k = 0, j
        while k < len(value):
            if value[k] == "(":
                depth += 1
            elif value[k] == ")":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        inner = value[j + 4:k]
        out.append("var(" + inner.split(",", 1)[0].strip() + ")")
        i = k + 1


def off_scale(value: str, scale: set[int]) -> bool:
    return any(abs(float(px)) not in scale for px in PX_RE.findall(value))


def scan_declaration(prop: str, value: str, counts: Counter) -> None:
    names = VAR_NAME_RE.findall(value)
    counts["legacy"] += sum(1 for n in names if n in LEGACY_ALIASES)
    counts["tokens"] += sum(1 for n in names if TOKEN_RE.match(n))
    if prop.startswith("--"):
        return
    v = strip_var_fallbacks(value)
    literal = VAR_NAME_RE.sub("", v)  # value text with var() names removed
    if v.strip() in {"inherit", "initial", "unset", "none", "auto", "normal", "0"}:
        return
    counts["colour"] += len(COLOUR_RE.findall(literal))
    if prop == "font-size" and re.search(r"\d", literal):
        counts["font-size"] += 1
        counts["font-size-off"] += off_scale(literal, TYPE_SCALE_PX)
    elif prop == "font-weight" and re.search(r"\d|bold", literal):
        counts["weight"] += 1
        weight = {"bold": "700"}.get(literal.strip(), literal.strip())
        counts["weight-off"] += weight not in {"400", "700"}
    elif prop == "line-height" and re.search(r"\d", literal):
        counts["line-height"] += 1
    elif re.match(r"^border(-(top|bottom)-(left|right))?-radius$", prop) and re.search(r"\d", literal):
        counts["radius"] += 1
        counts["radius-off"] += off_scale(literal, RADIUS_SCALE_PX)
    elif SPACING_PROPS.match(prop) and re.search(r"[1-9]\d*(\.\d+)?px", literal):
        counts["spacing"] += 1
        counts["spacing-off"] += off_scale(literal, SPACE_SCALE_PX)
    elif prop.startswith(("transition", "animation")):
        counts["duration"] += bool(DURATION_RE.search(literal))
        counts["easing"] += bool(EASING_RE.search(literal))
    elif prop == "z-index":
        counts["z-index"] += any(abs(int(n)) > 9 for n in NUMBER_RE.findall(literal))
    elif prop == "box-shadow" and re.search(r"\d", literal):
        counts["shadow"] += 1


def scan_file(path: Path) -> Counter:
    counts = Counter({c: 0 for c in DRIFT + OFF + ["tokens"]})
    text = COMMENT_RE.sub(" ", path.read_text(encoding="utf-8-sig"))  # -sig: some files carry a BOM
    for rule in RULE_RE.finditer(text):
        if rule.group(1).strip().startswith("@font-face"):
            continue  # descriptors, not style declarations
        for decl in rule.group(2).split(";"):
            if ":" not in decl:
                continue
            prop, value = decl.split(":", 1)
            prop = prop.strip().lower()
            if prop:
                scan_declaration(prop, value.replace("!important", "").strip(), counts)
    return counts


def scan_all() -> dict[str, dict[str, int]]:
    return {
        path.relative_to(STYLES_DIR).as_posix(): dict(scan_file(path))
        for path in sorted(STYLES_DIR.rglob("*.css"))
    }


def print_table(modules: dict[str, dict[str, int]], cols: list[str], title: str) -> None:
    width = max(len(m) for m in modules) + 2
    print(title)
    print("module".ljust(width) + "".join(c[:11].rjust(12) for c in cols))
    totals = Counter()
    for module, counts in modules.items():
        totals.update({c: counts[c] for c in cols})
        print(module.ljust(width) + "".join(str(counts[c]).rjust(12) for c in cols))
    print("TOTAL".ljust(width) + "".join(str(totals[c]).rjust(12) for c in cols))
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", type=Path, metavar="PATH", help="write the report as JSON (use this to refresh the baseline)")
    parser.add_argument("--baseline", type=Path, metavar="PATH", help="exit 1 if any module x category drift count is above this report's")
    args = parser.parse_args()

    modules = scan_all()
    print_table(modules, DRIFT + ["tokens"], "Raw values that should be tokens (tokens = adoption):")
    print_table(modules, OFF, "Off-scale values (not on the design-system scales):")

    if args.json:
        totals = Counter()
        for counts in modules.values():
            totals.update(counts)
        payload = {"generated_by": "tools/design_token_audit.py", "modules": modules, "totals": dict(totals)}
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Wrote {args.json}")

    if args.baseline:
        base = json.loads(args.baseline.read_text(encoding="utf-8"))["modules"]
        rose, fell = [], 0
        for module, counts in modules.items():
            for cat in DRIFT + OFF:
                was = base.get(module, {}).get(cat, 0)
                if counts[cat] > was:
                    rose.append(f"  {module}: {cat} {was} -> {counts[cat]}")
                elif counts[cat] < was:
                    fell += 1
        if rose:
            print("Drift rose above the baseline (use tokens from design-system/):")
            print("\n".join(rose))
            return 1
        print("No drift above the baseline." + (
            f" {fell} count(s) dropped - refresh it with --json {args.baseline}." if fell else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
