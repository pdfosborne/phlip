#!/usr/bin/env python3
"""Find top-level JS functions in the Phlip web client that are never referenced.

The canonical client (`phlip-web/public/`) is a set of ordered classic-script
modules that share top-level `function`/`const`/`let` declarations through the
browser's global lexical environment (no ES modules, no bundler) — see
CONTEXT.md's "Canonical client" section. That means a normal single-file
linter (e.g. eslint no-unused-vars) can't see whether a function declared in
one module is used by another, and dead code can accumulate silently.

This script:
  1. Collects every top-level (column-0) `function name(...)` /
     `const name = (...) => ...` / `let name = function...` declaration in
     `phlip-web/public/*.js` and `phlip-web/public/scripts/**/*.js`
     (vendored libraries under `scripts/vendor/` excluded).
  2. Tokenizes a production-only corpus (production web JS/HTML, plus the Android Kotlin
     and iOS Swift shells, which call into JS by name via
     `webView.evaluateJavascript(...)` / `evaluateJavaScript(...)`) and counts
     every occurrence of each identifier.
  3. Flags any declared name whose only occurrence(s) in the corpus are its
     own declaration line(s) as dead-code candidate.

This is a heuristic (regex/tokenize, not a real AST + scope analysis), so:
  - It undercounts dead code that is only "used" via a recursive self-call
    with no external caller (still flagged as "used").
  - It is biased toward false negatives, not false positives — a name
    mentioned anywhere as an identifier (including inside a string or
    comment) counts as a use. Treat the output as a review list, not an
    auto-delete list.

Usage:
  python tools/find_dead_code.py
  python tools/find_dead_code.py --strict     # exit 1 if any candidates found (CI use)
  python tools/find_dead_code.py --json       # write tools/dead_code_report.json
  python tools/find_dead_code.py --json --json-out some/other/path.json
  python tools/find_dead_code.py --ignore tools/dead_code_ignore.txt

Ignore file format: one identifier per line, '#' starts a comment.
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
WEB_DIR = ROOT / "phlip-web" / "public"
DEFAULT_JSON_OUT = ROOT / "tools" / "dead_code_report.json"

DECL_RE = re.compile(
    r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("
    r"|^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*"
    r"(?:async\s*)?(?:\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|function\b)"
)

IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")


def iter_corpus_files():
    yield from iter_production_files(ROOT)


def collect_declarations():
    """Return {name: [(rel_path, line_no, line_text), ...]}."""
    decls = defaultdict(list)
    paths = list(WEB_DIR.glob("*.js")) + [
        p for p in (WEB_DIR / "scripts").rglob("*.js") if "vendor" not in p.parts
    ]
    for path in sorted(paths):
        rel = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            m = DECL_RE.match(line)
            if not m:
                continue
            name = m.group(1) or m.group(2)
            decls[name].append((rel, i, line.strip()))
    return decls


def build_identifier_counts():
    """Return Counter of every identifier occurrence across the usage corpus."""
    counts = Counter()
    for path in iter_corpus_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        counts.update(IDENT_RE.findall(text))
    return counts


def load_ignore(path: Path | None) -> set[str]:
    if not path:
        return set()
    names = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            names.add(line)
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true", help="exit 1 if any dead-code candidates are found")
    parser.add_argument("--json", action="store_true", help=f"write machine-readable JSON to {DEFAULT_JSON_OUT.relative_to(ROOT).as_posix()} (or --json-out) instead of printing text")
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON_OUT, help="path to write the JSON report (implies --json)")
    parser.add_argument("--ignore", type=Path, default=None, help="path to a file of identifier names to skip")
    args = parser.parse_args()

    ignore = load_ignore(args.ignore)
    declarations = collect_declarations()
    identifier_counts = build_identifier_counts()

    dead = []
    for name, sites in sorted(declarations.items()):
        if name in ignore:
            continue
        total = identifier_counts.get(name, 0)
        self_occurrences = len(sites)  # each declaration line contains the name once
        if total - self_occurrences <= 0:
            dead.append((name, sites))

    write_json = args.json or args.json_out != DEFAULT_JSON_OUT
    if write_json:
        payload = [
            {"name": name, "sites": [{"file": f, "line": ln, "text": t} for f, ln, t in sites]}
            for name, sites in dead
        ]
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {len(dead)} candidate(s) to {args.json_out.relative_to(ROOT).as_posix() if args.json_out.is_relative_to(ROOT) else args.json_out}")
    else:
        if not dead:
            print("No dead top-level functions found.")
        else:
            print(f"{len(dead)} likely-dead top-level function(s):\n")
            for name, sites in dead:
                for f, ln, text in sites:
                    print(f"  {f}:{ln}  {name}")
                    print(f"      {text}")
            print(
                f"\n{len(dead)} candidate(s). This is a heuristic (see script docstring) - "
                "verify before deleting; check native calls, HTML attribute handlers, and "
                "dynamic (computed) lookups by hand."
            )

    if args.strict and dead:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
