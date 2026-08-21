#!/usr/bin/env python3
"""Regenerate conformance/codes.toml from the SPEC.md code registry.

SPEC.md is the single authority for the diagnostic codes. Implementations need
that registry as data to enforce "MUST NOT emit an unprefixed code that is not
in this registry", and hand-copying 41 codes into six languages would drift.
This script derives the data file, and the registry guard test in each
implementation re-derives it and compares, so drift fails a test rather than
silently shipping.

Usage:
    python3 conformance/tools/gen_codes.py          # rewrite codes.toml
    python3 conformance/tools/gen_codes.py --check  # exit 1 if stale
"""

from __future__ import annotations

import argparse
import collections
import pathlib
import re
import sys

PHASE_OF = {
    "Discovery": "discovery",
    "Schema-Load": "schema-load",
    "Validation": "validation",
}
PHASE_ORDER = ["discovery", "schema-load", "validation"]
EXTENSION_PATTERN = "^x-[a-z][a-z0-9]*-[a-z0-9-]+$"


def repo_root() -> pathlib.Path:
    for parent in pathlib.Path(__file__).resolve().parents:
        if (parent / "SPEC.md").is_file() and (parent / "conformance").is_dir():
            return parent
    raise SystemExit("could not locate repository root from gen_codes.py")


def parse_registry(spec_text: str) -> "collections.OrderedDict[str, dict]":
    section = None
    rows: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
    for line in spec_text.split("\n"):
        heading = re.match(r"^#### (Discovery|Schema-Load|Validation) Codes\s*$", line)
        if heading:
            section = PHASE_OF[heading.group(1)]
            continue
        if section and re.match(r"^#{1,4} ", line):
            section = None
            continue
        if section is None or not line.startswith("| `"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        code, severity = cells[0].strip("`"), cells[1]
        entry = rows.setdefault(code, {"severity": severity, "phases": []})
        if entry["severity"] != severity:
            raise SystemExit(
                f"{code} has conflicting severities in SPEC.md: "
                f"{entry['severity']} and {severity}"
            )
        if section not in entry["phases"]:
            entry["phases"].append(section)

    if not rows:
        raise SystemExit("no registry rows found; did the SPEC.md headings change?")
    for code, entry in rows.items():
        entry["phases"].sort(key=PHASE_ORDER.index)
        if entry["severity"] not in ("error", "warning"):
            raise SystemExit(f"{code} has unknown severity {entry['severity']!r}")
    return rows


def render(rows: "collections.OrderedDict[str, dict]") -> str:
    out = [
        "# Machine-readable form of the `### Code Registry` tables in SPEC.md.",
        "#",
        "# GENERATED FILE - do not hand-edit.",
        "# Regenerate: python3 conformance/tools/gen_codes.py",
        "# Verify:     python3 conformance/tools/gen_codes.py --check",
        "#",
        '# SPEC.md: "Implementations MUST NOT emit an unprefixed code that is not',
        '# in this registry." Conformance runners use this file for that check.',
        "",
        "# Implementation-specific codes are not listed individually; they are",
        "# matched by this pattern instead.",
        f'extension_pattern = "{EXTENSION_PATTERN}"',
        "",
    ]
    for code, entry in rows.items():
        phases = ", ".join(f'"{p}"' for p in entry["phases"])
        out += [
            "[[code]]",
            f'name = "{code}"',
            f'severity = "{entry["severity"]}"',
            f"phases = [{phases}]",
            "",
        ]
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if codes.toml is stale")
    args = parser.parse_args()

    root = repo_root()
    target = root / "conformance" / "codes.toml"
    rendered = render(parse_registry((root / "SPEC.md").read_text(encoding="utf-8")))

    if args.check:
        current = target.read_text(encoding="utf-8") if target.is_file() else ""
        if current != rendered:
            print(
                f"{target} is stale; rerun: python3 conformance/tools/gen_codes.py",
                file=sys.stderr,
            )
            return 1
        print(f"{target} is up to date")
        return 0

    target.write_text(rendered, encoding="utf-8")
    print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
