#!/usr/bin/env python3
"""Find CSS class/id selectors in the Phlip web client that are never referenced.

Companion to tools/find_dead_code.py, same idea applied to CSS instead of JS.
`phlip-web/public/styles/*.css` holds the component stylesheets (imported by
`style.css`, see CONTEXT.md's "CSS" section); classes/ids are attached to
elements from JS (`className`, `classList.*`, template-string HTML,
`getElementById`) or from static `phlip-web/public/*.html`. A selector that
appears in no JS/HTML is very likely leftover styling for a removed or
renamed UI element (e.g. an old settings modal that was replaced).

This script:
  1. Collects every class (`.name`) and id (`#name`) selector token that
     appears in a real selector list in `phlip-web/public/styles/*.css`
     (at-rule preludes like `@media (...)`/`@keyframes name`/keyframe
     percentage selectors are skipped, since they aren't class/id names).
  2. Tokenizes a usage corpus (production web JS/HTML, plus the Android
     Kotlin and iOS Swift shells, for parity with find_dead_code.py even
     though native code referencing a CSS class name directly is rare) and
     counts every occurrence of each hyphenated identifier-like token.
  3. Flags any selector name with zero occurrences in the usage corpus
     (CSS files are not part of the usage corpus — a class only ever
     referenced by other CSS, e.g. via a compound selector, isn't proven to
     be attached to anything real).

This is a heuristic (regex tokenize, not a real CSS parser or DOM/JS scope
analysis), so:
  - It undercounts dead CSS that is only "referenced" by a coincidental
    identifier match elsewhere (e.g. a JS variable name that happens to
    collide with a class name) — biased toward false negatives, not false
    positives. Treat the output as a review list, not an auto-delete list.
  - Compound selectors (`.foo.bar`) and comma-separated lists share one
    rule body; deleting a dead name from such a rule means editing the
    selector list, not deleting the whole rule (check nearby selectors
    before deleting).

Usage:
  python tools/find_dead_css.py
  python tools/find_dead_css.py --strict     # exit 1 if any candidates found (CI use)
  python tools/find_dead_css.py --json       # write tools/dead_css_report.json
  python tools/find_dead_css.py --json --json-out some/other/path.json
  python tools/find_dead_css.py --ignore tools/dead_css_ignore.txt

Ignore file format: one selector name per line (without the `.`/`#`
prefix), '#' starts a comment. When `--ignore` is omitted and
`tools/dead_css_ignore.txt` exists, that file is used automatically
(covers dynamic template class names the tokenizer can't see).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from production_corpus import iter_production_files
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLES_DIR = ROOT / "phlip-web" / "public" / "styles"
DEFAULT_JSON_OUT = ROOT / "tools" / "dead_css_report.json"
DEFAULT_IGNORE = ROOT / "tools" / "dead_css_ignore.txt"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
# Every `{` is preceded by either a real selector list or an at-rule prelude
# (`@media (...)`, `@keyframes name`, a keyframe `50%`); splitting on brace
# boundaries this way needs no nesting-depth tracking since `[^{}]*` can't
# cross a `}` either, so the scan naturally resyncs after nested blocks.
RULE_OPEN_RE = re.compile(r"([^{}]*)\{")
SELECTOR_TOKEN_RE = re.compile(r"[.#]([A-Za-z_][\w-]*)")
USAGE_TOKEN_RE = re.compile(r"[A-Za-z_][\w-]*")


def iter_corpus_files():
    yield from iter_production_files(ROOT)


def collect_declarations():
    """Return {name: [(rel_path, line_no, selector_text), ...]}."""
    decls = defaultdict(list)
    for path in sorted(STYLES_DIR.glob("*.css")):
        rel = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        text = COMMENT_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)
        for m in RULE_OPEN_RE.finditer(text):
            selector = m.group(1).strip()
            if not selector or selector.startswith("@"):
                continue
            line_no = text.count("\n", 0, m.start()) + 1
            seen_on_line = set()
            for tok_m in SELECTOR_TOKEN_RE.finditer(selector):
                name = tok_m.group(1)
                if name in seen_on_line:
                    continue
                seen_on_line.add(name)
                decls[name].append((rel, line_no, selector))
    return decls


def build_identifier_counts():
    """Return Counter of every hyphenated identifier-like token in the usage corpus."""
    counts = Counter()
    for path in iter_corpus_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        counts.update(USAGE_TOKEN_RE.findall(text))
    return counts


def load_ignore(path: Path | None) -> set[str]:
    if not path:
        return set()
    names = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            names.add(line.lstrip(".#"))
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true", help="exit 1 if any dead-selector candidates are found")
    parser.add_argument("--json", action="store_true", help=f"write machine-readable JSON to {DEFAULT_JSON_OUT.relative_to(ROOT).as_posix()} (or --json-out) instead of printing text")
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON_OUT, help="path to write the JSON report (implies --json)")
    parser.add_argument(
        "--ignore", type=Path, default=None,
        help=f"path to a file of selector names (no ./# prefix) to skip "
             f"(defaults to {DEFAULT_IGNORE.relative_to(ROOT).as_posix()} when present)",
    )
    args = parser.parse_args()

    if not STYLES_DIR.is_dir():
        print(f"{STYLES_DIR} not found — nothing to check.", file=sys.stderr)
        return 0

    ignore_path = args.ignore
    if ignore_path is None and DEFAULT_IGNORE.is_file():
        ignore_path = DEFAULT_IGNORE
    ignore = load_ignore(ignore_path)
    declarations = collect_declarations()
    identifier_counts = build_identifier_counts()

    dead = []
    for name, sites in sorted(declarations.items()):
        if name in ignore:
            continue
        if identifier_counts.get(name, 0) <= 0:
            dead.append((name, sites))

    write_json = args.json or args.json_out != DEFAULT_JSON_OUT
    if write_json:
        payload = [
            {"name": name, "sites": [{"file": f, "line": ln, "selector": s} for f, ln, s in sites]}
            for name, sites in dead
        ]
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {len(dead)} candidate(s) to {args.json_out.relative_to(ROOT).as_posix() if args.json_out.is_relative_to(ROOT) else args.json_out}")
    else:
        if not dead:
            print("No dead CSS selectors found.")
        else:
            print(f"{len(dead)} likely-dead CSS selector(s):\n")
            for name, sites in dead:
                for f, ln, selector in sites:
                    print(f"  {f}:{ln}  .{name} / #{name}")
                    print(f"      {selector}")
            print(
                f"\n{len(dead)} candidate(s). This is a heuristic (see script docstring) - "
                "verify before deleting; compound/comma-separated selectors need editing, not "
                "whole-rule deletion, when only one name in the list is dead."
            )

    if args.strict and dead:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
