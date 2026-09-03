#!/usr/bin/env python3
"""Lightweight structural validation for the Ship Dễ specification repository."""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ROOT.parent.parent
REPOSITORY_REQUIRED = [
    "scripts/ai/README.md",
    "scripts/ai/common.ps1",
    "scripts/ai/control.ps1",
    "scripts/ai/install-clis.ps1",
    "scripts/ai/install-control-shortcut.ps1",
    "scripts/ai/bootstrap-worktrees.ps1",
    "scripts/ai/doctor.ps1",
    "scripts/ai/ecosystem.ps1",
    "scripts/ai/install-ecosystem.ps1",
    "scripts/ai/start-work-item.ps1",
    "scripts/ai/review-pr.ps1",
    "scripts/ai/protect-main.ps1",
    "tools/ecosystem-manifest.json",
    "tools/ecosystem-profiles.json",
]
REQUIRED = [
    "AGENTS.md",
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
    "docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md",
    "docs/10-ai-collaboration/FOUNDATION-WORK-ITEMS.md",
    "docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md",
    "docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md",
    "docs/10-ai-collaboration/GEMINI-START-PROMPT.md",
    "docs/10-ai-collaboration/NINEROUTER-START-PROMPT.md",
    "docs/10-ai-collaboration/CODEX-REVIEW-PROMPT.md",
    "docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md",
    "docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md",
    "docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv",
    "work-items/README.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/feature-implementation.yml",
    ".github/workflows/feature-contract-gate.yml",
    ".github/workflows/current-application.yml",
    "scripts/validate_pr_contract.py",
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

    for rel in REPOSITORY_REQUIRED:
        path = REPOSITORY_ROOT / rel
        if not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing-or-empty-repository-control: {rel}")

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

    register_path = ROOT / "docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"
    register_rows: list[dict[str, str]] = []
    if register_path.is_file():
        with register_path.open(encoding="utf-8", newline="") as handle:
            register_rows = list(csv.DictReader(handle))

    registered_features = [
        row.get("feature_id", "") for row in register_rows if row.get("feature_id")
    ]
    registered_set = set(registered_features)
    if len(registered_features) != len(registered_set):
        errors.append("feature-register-has-duplicate-feature-id")
    missing_features = sorted(core_features - registered_set)
    extra_features = sorted(registered_set - core_features)
    if missing_features:
        errors.append(f"feature-register-missing: {','.join(missing_features)}")
    if extra_features:
        errors.append(f"feature-register-extra: {','.join(extra_features)}")

    foundation_items = {
        row.get("work_item_id", "")
        for row in register_rows
        if row.get("work_item_id", "").startswith("TASK-FOUND-")
    }
    expected_foundation = {f"TASK-FOUND-{index:02d}" for index in range(1, 5)}
    if foundation_items != expected_foundation:
        errors.append(
            "foundation-register-mismatch: "
            f"expected={sorted(expected_foundation)} actual={sorted(foundation_items)}"
        )

    allowed_statuses = {
        "BACKLOG",
        "BLOCKED_BY_FOUNDATION",
        "BLOCKED_DEPENDENCY",
        "READY_FOR_AUTHOR",
        "IN_PROGRESS",
        "READY_FOR_CODEX",
        "CHANGES_REQUIRED",
        "CODEX_PASS",
        "MERGED",
        "BLOCKED",
    }
    invalid_statuses = sorted(
        {
            row.get("status", "")
            for row in register_rows
            if row.get("status", "") not in allowed_statuses
        }
    )
    if invalid_statuses:
        errors.append(f"feature-register-invalid-status: {invalid_statuses}")

    orders = [row.get("delivery_order", "") for row in register_rows]
    if len(orders) != len(set(orders)) or not all(order.isdigit() for order in orders):
        errors.append("feature-register-delivery-order-invalid")

    if errors:
        print("Documentation validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        f"Documentation validation passed: {len(markdown_files)} markdown files, "
        f"{len(core_features)} feature IDs, {len(register_rows)} delivery rows, "
        f"{len(ids)} unique identifiers."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

