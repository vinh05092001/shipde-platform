#!/usr/bin/env python3
"""Validate a Ship Dễ Pull Request against its risk tier.

Tier B (default): the PR carries exactly one Work Item, its register row and
the full evidence contract. Tier A (maintenance): every changed path is inside
the maintenance scope declared by the policy at the protected base commit; the
PR carries its goal, scope and verification evidence and needs no Work Item
file or register row. The tier is derived from the actual Git delta and the
base policy only; the title, body and labels can never lower it.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ROOT.parent.parent
POLICY_PATH = "docs/product-spec/scripts/pr_contract_policy.json"
# GOAL-<GOAL>-<n> ids are the Work Items the Controller plans for a goal.
WORK_ITEM_PATTERN = re.compile(
    r"\b(?:FEAT-[A-Z0-9-]+|TASK-FOUND-[0-9]+|TASK-AI-[0-9]+|GOAL-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+)\b"
)
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


class ContractInputError(Exception):
    """A required input is missing or unreadable; the gate fails closed."""


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        raise ContractInputError(f"git {' '.join(args[:2])} failed: {result.stderr.strip()[:200]}")
    return result.stdout


def show_at(revision: str, path: str) -> str | None:
    """Return a file's content at a revision, or None when the file is absent there."""
    probe = subprocess.run(
        ["git", "cat-file", "-e", f"{revision}:{path}"],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
    )
    if probe.returncode != 0:
        return None
    return git("show", f"{revision}:{path}")


def resolve_revisions(pull_request: dict) -> tuple[str, str]:
    base = (pull_request.get("base") or {})
    head = (pull_request.get("head") or {})
    base_rev = base.get("sha") or f"origin/{base.get('ref') or 'main'}"
    head_rev = head.get("sha") or "HEAD"
    for revision in (base_rev, head_rev):
        git("rev-parse", "--verify", "--quiet", f"{revision}^{{commit}}")
    return base_rev, head_rev


def changed_entries(base_rev: str, head_rev: str) -> list[tuple[str, list[str]]]:
    """NUL-delimited name/status records; rename and copy carry both paths."""
    raw = git("diff", "--name-status", "-z", "-M", "-C", "--find-copies-harder", f"{base_rev}...{head_rev}")
    tokens = raw.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()
    entries: list[tuple[str, list[str]]] = []
    index = 0
    while index < len(tokens):
        status = tokens[index]
        kind = status[:1]
        if kind in ("R", "C"):
            paths = tokens[index + 1 : index + 3]
            index += 3
        elif kind in ("A", "M", "D", "T"):
            paths = tokens[index + 1 : index + 2]
            index += 2
        else:
            raise ContractInputError(f"unrecognized Git diff status: {status!r}")
        if len(paths) != (2 if kind in ("R", "C") else 1) or any(not p for p in paths):
            raise ContractInputError("incomplete record in Git diff")
        entries.append((kind, paths))
    return entries


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(f"^{out}$")


def matches(path: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(p.match(path) for p in patterns)


ALLOWED_SCOPED_KINDS = frozenset({"A", "M", "D"})
TOOL_MANIFEST_PATH = "tools/ai-brain/data/tool-manifest.json"
ECOSYSTEM_MANIFEST_PATH = "tools/ecosystem-manifest.json"
ECOSYSTEM_PROTECTED_FIELDS = (
    "pinned_version_or_commit",
    "install_method",
    "blocking_policy",
    "health_check",
    "lifecycle_state",
    "default_enabled",
)
TOOL_PROTECTED_FIELDS = ("id", "repo", "gate", "command", "installed", "blocked", "evidenceRef")


def validate_policy_object(policy: dict, label: str = "base policy") -> dict:
    required = (
        "maintenance_title_pattern",
        "maintenance_body_headings",
        "maintenance_paths",
        "protected_paths",
        "work_item_dir",
        "register_path",
        "terminal_statuses",
    )
    missing = [key for key in required if key not in policy]
    version = policy.get("version")
    if missing or version not in (1, 2):
        raise ContractInputError(f"{label} is malformed (missing {missing or 'supported version'})")
    if version == 1:
        # Strict v1 isolation: v1 base policies never interpret v2 scoped rules.
        if "scoped_governance_rules" in policy:
            raise ContractInputError(f"{label} v1 must not declare scoped_governance_rules")
        return policy
    # Strict v2 schema validation
    gov_headings = policy.get("governance_body_headings")
    if not isinstance(gov_headings, list) or not gov_headings or any(not isinstance(h, str) or not h.strip() for h in gov_headings):
        raise ContractInputError(f"{label} v2 requires non-empty governance_body_headings")
    rules = policy.get("scoped_governance_rules")
    if not isinstance(rules, list) or not rules:
        raise ContractInputError(f"{label} v2 requires non-empty scoped_governance_rules")
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ContractInputError(f"{label} scoped_governance_rules[{index}] must be an object")
        rule_path = rule.get("path")
        rule_kinds = rule.get("kinds")
        if not isinstance(rule_path, str) or not rule_path.strip():
            raise ContractInputError(f"{label} scoped_governance_rules[{index}].path is invalid")
        if (
            not isinstance(rule_kinds, list)
            or not rule_kinds
            or any(not isinstance(k, str) or k not in ALLOWED_SCOPED_KINDS for k in rule_kinds)
        ):
            raise ContractInputError(f"{label} scoped_governance_rules[{index}].kinds is invalid")
    return policy


def load_policy(revision: str, label: str = "base policy") -> dict | None:
    text = show_at(revision, POLICY_PATH)
    if text is None:
        return None
    try:
        policy = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ContractInputError(f"{label} is not valid JSON: {exc}") from exc
    if not isinstance(policy, dict):
        raise ContractInputError(f"{label} must be a JSON object")
    return validate_policy_object(policy, label=label)


REGISTER_REQUIRED_COLUMNS = ("delivery_order", "work_item_id", "status", "work_item_path")


def read_register(text: str, side: str) -> tuple[list[str], list[dict[str, str]]]:
    """Strict CSV: unique non-empty header with the required columns, every row the header's width."""
    try:
        records = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as exc:
        raise ContractInputError(f"{side} register is not valid CSV: {exc}") from exc
    if not records:
        raise ContractInputError(f"{side} register is empty")
    header = records[0]
    if any(not name for name in header) or len(set(header)) != len(header):
        raise ContractInputError(f"{side} register header has empty or duplicate columns")
    missing = [name for name in REGISTER_REQUIRED_COLUMNS if name not in header]
    if missing:
        raise ContractInputError(f"{side} register header lacks {missing}")
    rows: list[dict[str, str]] = []
    for number, record in enumerate(records[1:], start=2):
        if not record:
            continue
        if len(record) != len(header):
            raise ContractInputError(
                f"{side} register record {number} has {len(record)} fields, header has {len(header)}"
            )
        rows.append(dict(zip(header, record)))
    return header, rows


REVIEW_MARKER_LINE = re.compile(r"^[-*]?\s*Review status:\s*\S+$")


def section_has_content(body: str, heading: str) -> bool:
    """True when `heading` is a real Markdown heading line outside code fences with evidence under it.

    Evidence is a non-blank line before the next heading: text outside a fence or a line inside a
    fenced block. Fence markers alone and the review-status marker are not evidence.
    """
    in_fence = False
    collecting = False
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if not in_fence and re.match(r"^#{1,6}\s", stripped):
            if collecting:
                return False
            collecting = stripped == heading
            continue
        evidence = bool(stripped) and not REVIEW_MARKER_LINE.match(stripped)
        if collecting and evidence:
            return True
    return False


def classify(entries, policy) -> tuple[str, str]:
    """Return ('A'|'G'|'B', reason).

    - 'A': low-risk maintenance (PR-only evidence).
    - 'G': protected scoped governance (PR-only evidence + preservation & invariant checks).
    - 'B': Work Item + register required (product behavior, gates, undeclared paths).
    """
    if policy is None:
        return "B", "no contract policy at the base commit"
    if not entries:
        return "B", "empty diff"
    maintenance = [glob_to_regex(p) for p in policy["maintenance_paths"]]
    protected = [glob_to_regex(p) for p in policy["protected_paths"]]
    scoped_rules = (
        [
            (glob_to_regex(rule["path"]), frozenset(rule["kinds"]))
            for rule in policy.get("scoped_governance_rules", [])
        ]
        if policy.get("version") == 2
        else []
    )
    work_item_dir = policy["work_item_dir"]
    register = policy["register_path"]
    used_scoped = False
    for kind, paths in entries:
        if kind == "T":
            return "B", f"type change: {paths[0]}"
        if (
            len(paths) == 1
            and paths[0] != register
            and not paths[0].startswith(work_item_dir)
            and any(pattern.match(paths[0]) and kind in allowed_kinds for pattern, allowed_kinds in scoped_rules)
        ):
            used_scoped = True
            continue
        for path in paths:
            if path == register:
                if kind != "M":
                    return "B", f"register change {kind}"
                continue
            if path.startswith(work_item_dir):
                if kind != "D":
                    return "B", f"Work Item file {kind}: {path}"
                continue
            if matches(path, protected):
                return "B", f"protected path: {path}"
            if not matches(path, maintenance):
                return "B", f"path outside maintenance scope: {path}"
    if used_scoped:
        return "G", "declared scoped governance operations (protected risk, PR-only evidence)"
    return "A", "every path is inside the maintenance scope"


def index_unique_entries(items, label: str) -> dict[str, dict]:
    """Validate array schema and non-empty unique IDs (prevents first-match vs last-win shadowing)."""
    if not isinstance(items, list):
        raise ContractInputError(f"{label} must be a JSON array")
    indexed: dict[str, dict] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ContractInputError(f"{label}[{index}] must be a JSON object")
        entry_id = item.get("id")
        if not isinstance(entry_id, str) or not entry_id.strip():
            raise ContractInputError(f"{label}[{index}] has missing or empty id")
        if entry_id in indexed:
            raise ContractInputError(f"duplicate id in {label}: {entry_id}")
        indexed[entry_id] = item
    return indexed


def check_manifest_invariants(entries, base_rev: str, head_rev: str) -> list[str]:
    """Protected manifest edits under Tier G must never alter CI pins, gates or installed flags."""
    errors: list[str] = []
    changed = {p for _, paths in entries for p in paths}
    if TOOL_MANIFEST_PATH in changed:
        base_raw = show_at(base_rev, TOOL_MANIFEST_PATH)
        head_raw = show_at(head_rev, TOOL_MANIFEST_PATH)
        if base_raw is None or head_raw is None:
            raise ContractInputError("tool-manifest.json unreadable for invariant check")
        base_by_id = index_unique_entries(json.loads(base_raw), "base tool-manifest.json")
        head_by_id = index_unique_entries(json.loads(head_raw), "head tool-manifest.json")
        added = sorted(set(head_by_id) - set(base_by_id))
        if added:
            errors.append(f"scoped governance cannot add tool-manifest entries: {added}")
        for tool_id, before in base_by_id.items():
            if tool_id not in head_by_id:
                if before.get("installed") is True or before.get("gate") is True or before.get("command"):
                    errors.append(
                        f"scoped governance cannot remove active/gated tool-manifest entry: {tool_id}"
                    )
                continue
            after = head_by_id[tool_id]
            drift = [f for f in TOOL_PROTECTED_FIELDS if before.get(f) != after.get(f)]
            if drift:
                errors.append(
                    f"scoped governance cannot change protected tool-manifest fields on {tool_id}: {drift}"
                )
    if ECOSYSTEM_MANIFEST_PATH in changed:
        base_raw = show_at(base_rev, ECOSYSTEM_MANIFEST_PATH)
        head_raw = show_at(head_rev, ECOSYSTEM_MANIFEST_PATH)
        if base_raw is None or head_raw is None:
            raise ContractInputError("ecosystem-manifest.json unreadable for invariant check")
        base_eco = json.loads(base_raw)
        head_eco = json.loads(head_raw)
        if not isinstance(base_eco, dict) or not isinstance(head_eco, dict):
            raise ContractInputError("ecosystem-manifest.json must be a JSON object")
        if base_eco.get("orchestrator_runtime") != head_eco.get("orchestrator_runtime"):
            errors.append("scoped governance cannot modify orchestrator_runtime in ecosystem-manifest.json")
        if base_eco.get("product_dependencies") != head_eco.get("product_dependencies"):
            errors.append("scoped governance cannot modify product_dependencies in ecosystem-manifest.json")
        base_adopted = index_unique_entries(base_eco.get("adopted"), "base ecosystem-manifest.adopted")
        head_adopted = index_unique_entries(head_eco.get("adopted"), "head ecosystem-manifest.adopted")
        index_unique_entries(base_eco.get("candidates", []), "base ecosystem-manifest.candidates")
        index_unique_entries(head_eco.get("candidates", []), "head ecosystem-manifest.candidates")
        if set(base_adopted) != set(head_adopted):
            errors.append("scoped governance cannot add or remove adopted entries in ecosystem-manifest.json")
        else:
            for item_id, before in base_adopted.items():
                after = head_adopted[item_id]
                drift = [f for f in ECOSYSTEM_PROTECTED_FIELDS if before.get(f) != after.get(f)]
                if drift:
                    errors.append(
                        f"scoped governance cannot change protected ecosystem fields on {item_id}: {drift}"
                    )
    return errors


def common_checks(body: str, entries) -> list[str]:
    errors: list[str] = []
    if re.search(r"<[^>\n]+>", body):
        errors.append("PR body still contains required template placeholders")
    if re.search(r"\b(?:TBD|TODO)\b", body):
        errors.append("PR body contains TBD/TODO instead of evidence or an explicit blocker")
    if "- [ ]" in body:
        errors.append("PR contains unchecked mandatory checklist items")
    for kind, paths in entries:
        # A pure deletion may remove a tracked .env; every other record is checked on both sides.
        if kind == "D":
            continue
        if any(Path(p).name == ".env" for p in paths):
            errors.append("tracked .env file is prohibited; use .env.example with safe placeholders")
            break
    return errors


def tier_a_checks(title, body, entries, policy, base_rev, head_rev) -> list[str]:
    errors = common_checks(body, entries)
    if not re.search(policy["maintenance_title_pattern"], title):
        errors.append("maintenance PR title must start with chore:, docs: or refactor:")
    if WORK_ITEM_PATTERN.search(title):
        errors.append("maintenance PR title must not name a Work Item; use the Work Item contract instead")
    for heading in policy["maintenance_body_headings"]:
        if not section_has_content(body, heading):
            errors.append(f"missing or empty maintenance PR section: {heading}")
    if "Review status: READY_FOR_CODEX" not in body:
        errors.append("PR is not marked READY_FOR_CODEX")

    register = policy["register_path"]
    work_item_dir = policy["work_item_dir"]
    deleted = {paths[0] for kind, paths in entries if kind == "D" and paths[0].startswith(work_item_dir)}
    register_changed = any(register in paths for _, paths in entries)
    if not deleted and not register_changed:
        return errors

    base_text = show_at(base_rev, register)
    if base_text is None:
        raise ContractInputError("base register is unreadable")
    head_text = show_at(head_rev, register)
    if head_text is None:
        raise ContractInputError("head register is unreadable")
    base_fields, base_rows = read_register(base_text, "base")
    head_fields, head_rows = read_register(head_text, "head")
    if base_fields != head_fields or len(base_rows) != len(head_rows):
        errors.append("register header or row count changed in a maintenance PR")
        return errors

    terminal = set(policy["terminal_statuses"])
    by_path: dict[str, list[dict[str, str]]] = {}
    for row in base_rows:
        by_path.setdefault(row.get("work_item_path") or "", []).append(row)
    for path in sorted(deleted):
        owners = by_path.get(path, [])
        if len(owners) != 1:
            errors.append(f"deleted Work Item has no unique base register row: {path}")
        elif owners[0].get("status") not in terminal:
            errors.append(f"deleted Work Item is still active ({owners[0].get('status')}): {path}")

    cleared: set[str] = set()
    for before, after in zip(base_rows, head_rows):
        if before == after:
            continue
        drift = [key for key in base_fields if key != "work_item_path" and before.get(key) != after.get(key)]
        if drift:
            errors.append(f"register row {before.get('work_item_id')} changed {drift}; only work_item_path may be cleared")
            continue
        if after.get("work_item_path"):
            errors.append(f"register row {before.get('work_item_id')} path changed instead of cleared")
            continue
        cleared.add(before.get("work_item_path") or "")
    for path in sorted(deleted - cleared):
        errors.append(f"deleted Work Item still listed in register: {path}")
    for path in sorted(cleared - deleted):
        errors.append(f"register path cleared without deleting its file: {path}")
    return errors


def tier_b_checks(title, body, entries, head_rev) -> list[str]:
    errors: list[str] = []
    title_ids = WORK_ITEM_PATTERN.findall(title)
    if len(title_ids) != 1:
        errors.append("PR title must contain exactly one FEAT-*, TASK-FOUND-*, TASK-AI-* or GOAL-*-N Work Item ID")
    work_item_id = title_ids[0] if len(title_ids) == 1 else ""

    for heading in REQUIRED_HEADINGS:
        if heading not in body:
            errors.append(f"missing PR section: {heading}")
    if work_item_id and work_item_id not in body:
        errors.append(f"PR body does not reference title Work Item {work_item_id}")
    errors.extend(common_checks(body, entries))
    if "Review status: READY_FOR_CODEX" not in body:
        errors.append("PR is not marked READY_FOR_CODEX")

    files = sorted({p for _, paths in entries for p in paths})
    distinct_changed_ids = {
        match.group(0)
        for path in files
        if re.search(r"docs/product-spec/work-items/(?:FEAT|TASK|GOAL)-", path)
        for match in [WORK_ITEM_PATTERN.search(path)]
        if match
    }
    if len(distinct_changed_ids) > 1:
        errors.append(f"multiple Work Items changed: {sorted(distinct_changed_ids)}")

    if work_item_id:
        register = ROOT / "docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"
        with register.open(encoding="utf-8", newline="") as handle:
            register_rows = list(csv.DictReader(handle))
        matching_rows = [row for row in register_rows if row.get("work_item_id") == work_item_id]
        if len(matching_rows) != 1:
            errors.append(f"Work Item must have exactly one feature-register row: {work_item_id}")
        else:
            registered_path = matching_rows[0].get("work_item_path") or ""
            work_item = REPOSITORY_ROOT / registered_path
            if not registered_path or not work_item.is_file():
                errors.append(f"registered Work Item file is missing: {registered_path or work_item_id}")
            if registered_path not in files:
                errors.append(f"PR must update its registered Work Item file: {registered_path}")
        if distinct_changed_ids and distinct_changed_ids != {work_item_id}:
            errors.append(
                "changed Work Item files do not match PR title: "
                f"title={work_item_id} changed={sorted(distinct_changed_ids)}"
            )
    return errors


def tier_g_checks(title, body, entries, policy, base_rev, head_rev) -> list[str]:
    errors = tier_a_checks(title, body, entries, policy, base_rev, head_rev)
    required_headings = policy.get("governance_body_headings", policy["maintenance_body_headings"])
    for heading in required_headings:
        if heading in policy["maintenance_body_headings"]:
            continue
        if not section_has_content(body, heading):
            errors.append(f"missing or empty protected governance PR section: {heading}")
    errors.extend(check_manifest_invariants(entries, base_rev, head_rev))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    args = parser.parse_args()

    try:
        event = json.loads(Path(args.event).read_text(encoding="utf-8"))
        pull_request = event.get("pull_request") or {}
        title = pull_request.get("title") or ""
        body = pull_request.get("body") or ""
        base_rev, head_rev = resolve_revisions(pull_request)
        entries = changed_entries(base_rev, head_rev)
        policy = load_policy(base_rev)
        tier, reason = classify(entries, policy)
        if tier == "A":
            errors = tier_a_checks(title, body, entries, policy, base_rev, head_rev)
        elif tier == "G":
            errors = tier_g_checks(title, body, entries, policy, base_rev, head_rev)
        else:
            errors = tier_b_checks(title, body, entries, head_rev)
    except (ContractInputError, OSError, ValueError) as exc:
        print("Pull Request contract validation failed:")
        print(f"- unreadable contract input: {exc}")
        return 1

    if errors:
        print(f"Pull Request contract validation failed (Tier {tier}: {reason}):")
        for error in errors:
            print(f"- {error}")
        return 1

    if tier == "A":
        label = "maintenance"
    elif tier == "G":
        label = "protected governance (PR-only)"
    else:
        label = (WORK_ITEM_PATTERN.findall(title) or [""])[0]
    print(
        f"Pull Request contract passed for {label} (Tier {tier}); "
        f"{len(entries)} changed files inspected."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
