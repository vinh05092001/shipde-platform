#!/usr/bin/env python3
"""Lightweight structural validation for the Ship Dễ specification repository."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md",
    "docs/00-control/DOCUMENT-REGISTER.md",
    "docs/00-control/BASELINE-AND-DECISIONS.md",
    "docs/01-product/PRODUCT-VISION-SCOPE.md",
    "docs/01-product/MASTER-FEATURE-CATALOG.md",
    "docs/02-business/END-TO-END-PROCESSES.md",
    "docs/02-business/USE-CASES.md",
    "docs/02-business/BUSINESS-RULES-DECISION-TABLES.md",
    "docs/02-business/STATE-MACHINES.md",
    "docs/03-ux/SCREEN-SPECIFICATIONS.md",
    "docs/04-data/DOMAIN-MODEL-ERD.md",
    "docs/05-api-integrations/INTERNAL-API.md",
    "contracts/openapi.yaml",
    "docs/06-architecture/SYSTEM-ARCHITECTURE.md",
    "docs/07-ai-build/VERTICAL-SLICE-PLAN.md",
    "docs/08-testing/ACCEPTANCE-AND-E2E.md",
    "docs/09-delivery/DEVELOPER-HANDOVER.md",
]

ID_PATTERN = re.compile(
    r"\b(?:FEAT|UC|BR|SCR|API|EVT|ENT|ST|AC|TEST|EPIC|ADR|DEC|OI)-[A-Z0-9-]+\b"
)
LINK_PATTERN = re.compile(r"\[[^\]]+\]\((?!https?://|#|mailto:)([^)]+)\)")


def main() -> int:
    errors: list[str] = []
    for rel in REQUIRED:
        path = ROOT / rel
        if not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing-or-empty: {rel}")

    ids: dict[str, list[str]] = {}
    markdown_files = list(ROOT.rglob("*.md"))
    for path in markdown_files:
        text = path.read_text(encoding="utf-8")
        rel = str(path.relative_to(ROOT))
        for identifier in ID_PATTERN.findall(text):
            ids.setdefault(identifier, []).append(rel)
        for target in LINK_PATTERN.findall(text):
            clean = target.split("#", 1)[0]
            if not clean:
                continue
            resolved = (path.parent / clean).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                errors.append(f"link-outside-root: {rel} -> {target}")
                continue
            if not resolved.exists():
                errors.append(f"broken-link: {rel} -> {target}")

    for path in ROOT.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"invalid-json: {path.relative_to(ROOT)}: {exc}")

    feature_text = (ROOT / "docs/01-product/MASTER-FEATURE-CATALOG.md").read_text(
        encoding="utf-8"
    )
    trace_text = (ROOT / "docs/00-control/TRACEABILITY.md").read_text(
        encoding="utf-8"
    )
    core_features = set(re.findall(r"\bFEAT-[A-Z0-9-]+\b", feature_text))
    traced_features = set(re.findall(r"\bFEAT-[A-Z0-9-]+\b", trace_text))
    if len(core_features) < 80:
        errors.append(f"feature-catalog-too-small: {len(core_features)}")
    if not traced_features:
        errors.append("traceability-empty")

    if errors:
        print("Documentation validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        f"Documentation validation passed: {len(markdown_files)} markdown files, "
        f"{len(core_features)} feature IDs, {len(ids)} unique identifiers."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

