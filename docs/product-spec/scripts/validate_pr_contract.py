#!/usr/bin/env python3
"""Validate that a Ship Dễ Pull Request is reviewable as one Work Item."""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK_ITEM_PATTERN = re.compile(r"\b(?:FEAT-[A-Z0-9-]+|TASK-FOUND-[0-9]+|TASK-AI-[0-9]+)\b")
REQUIRED_HEADINGS = [
    "## Work Item",
    "## Source requirements",
    "## Scope integrity",
    "## Implementation",
    "## Acceptance evidence",
    "## Verification",
    "## Safety and recovery",
    "## Documentation and traceability",
    "## Risks and limitations",
    "## Codex review",
]


def changed_files(base_ref: str) -> list[str]:
    command = ["git", "diff", "--name-only", f"origin/{base_ref}...HEAD"]
    result = subprocess.run(
        command,
        cwd=ROOT.parent.parent,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    args = parser.parse_args()

    event = json.loads(Path(args.event).read_text(encoding="utf-8"))
    pull_request = event.get("pull_request") or {}
    title = pull_request.get("title") or ""
    body = pull_request.get("body") or ""
    base_ref = (pull_request.get("base") or {}).get("ref") or "main"
    errors: list[str] = []

    title_ids = WORK_ITEM_PATTERN.findall(title)
    if len(title_ids) != 1:
        errors.append("PR title must contain exactly one FEAT-*, TASK-FOUND-* or TASK-AI-* Work Item ID")
    work_item_id = title_ids[0] if len(title_ids) == 1 else ""

    for heading in REQUIRED_HEADINGS:
        if heading not in body:
            errors.append(f"missing PR section: {heading}")

    if work_item_id and work_item_id not in body:
        errors.append(f"PR body does not reference title Work Item {work_item_id}")

    if re.search(r"<[^>\n]+>", body):
        errors.append("PR body still contains required template placeholders")
    if re.search(r"\b(?:TBD|TODO)\b", body):
        errors.append("PR body contains TBD/TODO instead of evidence or an explicit blocker")
    if "- [ ]" in body:
        errors.append("PR contains unchecked mandatory checklist items")
    if "Review status: READY_FOR_CODEX" not in body:
        errors.append("PR is not marked READY_FOR_CODEX")

    files = changed_files(base_ref)
    work_item_changes = [
        path
        for path in files
        if re.search(r"docs/product-spec/work-items/(?:FEAT|TASK)-", path)
    ]
    distinct_changed_ids = {
        match.group(0)
        for path in work_item_changes
        for match in [WORK_ITEM_PATTERN.search(path)]
        if match
    }
    if len(distinct_changed_ids) > 1:
        errors.append(f"multiple Work Items changed: {sorted(distinct_changed_ids)}")
    if any(Path(path).name == ".env" for path in files):
        errors.append("tracked .env file is prohibited; use .env.example with safe placeholders")

    if work_item_id:
        register = ROOT / "docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"
        with register.open(encoding="utf-8", newline="") as handle:
            register_rows = list(csv.DictReader(handle))
        matching_rows = [
            row for row in register_rows if row.get("work_item_id") == work_item_id
        ]
        if len(matching_rows) != 1:
            errors.append(
                f"Work Item must have exactly one feature-register row: {work_item_id}"
            )
        else:
            registered_path = matching_rows[0].get("work_item_path") or ""
            work_item = ROOT.parent.parent / registered_path
            if not registered_path or not work_item.is_file():
                errors.append(
                    f"registered Work Item file is missing: {registered_path or work_item_id}"
                )
            if registered_path not in files:
                errors.append(
                    f"PR must update its registered Work Item file: {registered_path}"
                )

        if distinct_changed_ids and distinct_changed_ids != {work_item_id}:
            errors.append(
                "changed Work Item files do not match PR title: "
                f"title={work_item_id} changed={sorted(distinct_changed_ids)}"
            )

    if errors:
        print("Pull Request contract validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        f"Pull Request contract passed for {work_item_id}; "
        f"{len(files)} changed files inspected."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
