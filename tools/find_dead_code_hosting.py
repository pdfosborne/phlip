#!/usr/bin/env python3
"""Find top-level Kotlin functions in phlip-hosting/ that are never referenced.

Companion to tools/find_dead_code.py, same idea applied to the hosting
libraries instead of the JS web client. `phlip-hosting/` (`core` / `server` /
`tunnel`) is the open-source sibling repo for the hosting libraries; the proprietary
`:app` consumes it through Maven coordinates or a local Gradle composite build (see CONTEXT.md's "Module split").
That means a function declared in phlip-hosting can be "used" only from
`phlip-android/app`, so the usage search has to cover both trees even though
only phlip-hosting is scanned for declarations.

Scope, deliberately narrow to avoid false positives from Kotlin features a
regex heuristic can't reason about:
  - Only **top-level** (file-scope, column-0) `fun` declarations are
    considered — not class/object members. Kotlin dispatches member calls
    polymorphically (`override fun`, interface implementations,
    `ServiceLoader` entries in `tunnel/src/main/resources/META-INF/services/*`
    load classes by fully-qualified name, not by an identifier this script
    could see), so member-level "unused" detection needs real type/override
    info a tokenizer doesn't have and would be full of false positives.
  - `fun interface Foo { ... }` (a functional-interface declaration, not a
    callable) is explicitly excluded.

As with the JS version: this is a heuristic (tokenize + count, not a real
compiler/scope analysis), biased toward false negatives over false
positives — treat the output as a review list, not an auto-delete list.

Usage:
  python tools/find_dead_code_hosting.py
  python tools/find_dead_code_hosting.py --strict     # exit 1 if any candidates found (CI use)
  python tools/find_dead_code_hosting.py --json       # write tools/dead_code_report_hosting.json
  python tools/find_dead_code_hosting.py --json --json-out some/other/path.json
  python tools/find_dead_code_hosting.py --ignore tools/dead_code_ignore.txt

Ignore file format: one identifier per line, '#' starts a comment.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOSTING_DIR = ROOT / "phlip-hosting"
# Declarations are only collected from these; production source, not tests.
DECL_ROOTS = [
    HOSTING_DIR / "core",
    HOSTING_DIR / "server",
    HOSTING_DIR / "tunnel",
]
# The usage corpus additionally covers the proprietary consumer, since
# only
# phlip-android/app actually calls into them at the top of the dependency
# graph.
CORPUS_ROOTS = [HOSTING_DIR, ROOT / "phlip-android"]
DEFAULT_JSON_OUT = ROOT / "tools" / "dead_code_report_hosting.json"

TEST_DIR_NAMES = {"test", "androidTest", "commonTest", "androidUnitTest", "iosTest"}

EXCLUDE_DIR_NAMES = {
    ".git", "build", ".gradle", ".kotlin", ".idea", "node_modules",
    "DerivedData", "xcuserdata", "gradle",
}

# Top-level `fun name(` / `private fun name(` / `internal fun name(` /
# `suspend fun name(`, optionally with an extension-function receiver
# (`fun Receiver.name(`) or generic params (`fun <T> Thing<T>.name(`).
# Explicitly rejects `fun interface Name` (a declaration, not a callable).
DECL_RE = re.compile(
    r"^(?:private\s+|internal\s+|public\s+)?(?:suspend\s+)?fun\s+"
    r"(?:<[^>]*>\s*)?"
    r"(?:[\w$]+(?:<[^>]*>)?\.)?"
    r"(?!interface\b)([A-Za-z_$][\w$]*)\s*\("
)

IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")


def iter_files(roots, exclude_test_dirs=False):
    for root in roots:
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            parts = set(Path(dirpath).parts)
            dirnames[:] = [
                d for d in dirnames
                if d not in EXCLUDE_DIR_NAMES and not d.startswith(".")
                and not (exclude_test_dirs and d in TEST_DIR_NAMES)
            ]
            if exclude_test_dirs and parts & TEST_DIR_NAMES:
                continue
            for fn in filenames:
                if fn.endswith(".kt") or fn.endswith(".kts"):
                    yield Path(dirpath) / fn


def collect_declarations():
    """Return {name: [(rel_path, line_no, line_text), ...]}."""
    decls = defaultdict(list)
    for path in sorted(iter_files(DECL_ROOTS, exclude_test_dirs=True)):
        rel = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            m = DECL_RE.match(line)
            if not m:
                continue
            decls[m.group(1)].append((rel, i, line.strip()))
    return decls


def build_identifier_counts():
    """Return Counter of every identifier occurrence across the usage corpus."""
    counts = Counter()
    for path in iter_files(CORPUS_ROOTS, exclude_test_dirs=True):
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

    if not HOSTING_DIR.is_dir():
        print(f"{HOSTING_DIR} not found (it's a sibling-repo checkout, gitignored in ASH) - nothing to check.", file=sys.stderr)
        return 0

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
            print("No dead top-level Kotlin functions found in phlip-hosting.")
        else:
            print(f"{len(dead)} likely-dead top-level function(s) in phlip-hosting:\n")
            for name, sites in dead:
                for f, ln, text in sites:
                    print(f"  {f}:{ln}  {name}")
                    print(f"      {text}")
            print(
                f"\n{len(dead)} candidate(s). This is a heuristic (see script docstring) - "
                "member functions, overrides, and ServiceLoader-instantiated classes are "
                "intentionally out of scope; verify before deleting."
            )

    if args.strict and dead:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
