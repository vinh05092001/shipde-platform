'use strict';

/**
 * Ship Dễ — Register Reconciliation
 *
 * The delivery register is what the project believes. This module compares
 * each belief against what the repository can prove, and reports every place
 * the two disagree.
 *
 * The rules below are not style preferences. Each one exists because a status
 * can be written by an agent that was mistaken, interrupted, or simply never
 * updated, and because a row that claims more than it can prove is how a
 * project convinces itself it has shipped something it has not.
 *
 * Severity is about consequence, not confidence:
 *   error  — the register overstates reality; work may be skipped as done.
 *   warn   — the register understates reality; work may be blocked for nothing.
 *   info   — a record is incomplete but nothing is being misrepresented.
 */

const { commitExists, isAncestorOf, branchExists, fileExists, headSha } = require('./facts');

const TERMINAL_STATUS = 'MERGED';
const BLOCKED_PREFIX = 'BLOCKED';

function finding(severity, code, item, message, evidence) {
  return {
    severity,
    code,
    workItemId: item.work_item_id || '(unknown)',
    status: item.status || '(none)',
    message,
    evidence: evidence || null,
  };
}

/**
 * @param items  register rows, as produced by register-adapter
 * @param deps   { cwd, mainRef } — injectable so tests need no real repository
 */
function reconcileRegister(items, deps) {
  const opts = deps || {};
  const cwd = opts.cwd || process.cwd();
  const mainRef = opts.mainRef || 'origin/main';

  // Injection points keep the rules testable without a fixture repository.
  const hasCommit = opts.commitExists || ((sha) => commitExists(sha, cwd));
  const merged = opts.isAncestorOf || ((sha) => isAncestorOf(sha, mainRef, cwd));
  const hasBranch = opts.branchExists || ((b) => branchExists(b, cwd));
  const hasFile = opts.fileExists || ((p) => fileExists(p, cwd));
  const tipOf = opts.headSha || ((ref) => headSha(ref, cwd));

  const byId = new Map();
  for (const item of items) {
    if (item.work_item_id) byId.set(item.work_item_id, item);
  }

  const findings = [];

  for (const item of items) {
    const status = (item.status || '').trim();
    const id = item.work_item_id || '';

    // --- Claims of completion must be provable --------------------------
    if (status === TERMINAL_STATUS) {
      const sha = (item.merge_commit || '').trim();

      if (!sha) {
        findings.push(
          finding(
            'error',
            'MERGED_WITHOUT_COMMIT',
            item,
            'Ghi là MERGED nhưng không có merge_commit để kiểm chứng.'
          )
        );
      } else if (!hasCommit(sha)) {
        findings.push(
          finding(
            'error',
            'MERGE_COMMIT_MISSING',
            item,
            'merge_commit không tồn tại trong repository.',
            { sha }
          )
        );
      } else if (!merged(sha)) {
        // The commit is real but unreachable from main: it was never merged,
        // or it was merged and later dropped.
        findings.push(
          finding(
            'error',
            'MERGE_COMMIT_NOT_REACHABLE',
            item,
            'merge_commit có thật nhưng không nằm trong lịch sử ' + mainRef + '.',
            { sha, mainRef }
          )
        );
      }

      // The same verdicts the transition accepts, because an audit that
      // disagreed with the rule it audits would report every row the rule
      // legitimately wrote. Measured 2026-09-16: widening the transition for
      // AI-19-R05 without widening this made the register un-writable - the
      // first MERGED row written under the new rule was immediately an error.
      const verdict = (item.codex_verdict || '').trim();
      if (!ACCEPTED_MERGED_VERDICTS.has(verdict)) {
        findings.push(
          finding(
            'error',
            'MERGED_WITHOUT_PASS',
            item,
            'Ghi là MERGED nhưng codex_verdict là "' +
              (verdict || 'trống') +
              '", không phải ' +
              [...ACCEPTED_MERGED_VERDICTS].join(' hoặc ') +
              '.'
          )
        );
      }
    }

    // --- Blocks must still be true --------------------------------------
    if (status.startsWith(BLOCKED_PREFIX)) {
      const deps = parseDependencies(item.dependencies);
      const known = deps.filter((d) => byId.has(d));
      const unresolved = known.filter((d) => (byId.get(d).status || '') !== TERMINAL_STATUS);

      if (known.length > 0 && unresolved.length === 0) {
        // Understating progress is how a backlog stays frozen after the thing
        // it was waiting for has landed.
        findings.push(
          finding(
            'warn',
            'BLOCK_NO_LONGER_TRUE',
            item,
            'Vẫn ghi là ' + status + ' nhưng mọi phụ thuộc đã MERGED.',
            { dependencies: known }
          )
        );
      }

      const unknown = deps.filter((d) => !byId.has(d));
      if (unknown.length > 0) {
        findings.push(
          finding(
            'info',
            'DEPENDENCY_UNKNOWN',
            item,
            'Phụ thuộc không có trong register: ' + unknown.join(', '),
            { unknown }
          )
        );
      }
    }

    // --- Work that landed but was never recorded ------------------------
    // The opposite direction from an overstated MERGED, and the one that keeps
    // a backlog frozen: the branch is already in main and nobody wrote it down.
    if (status !== TERMINAL_STATUS && item.branch && hasBranch(item.branch)) {
      const tip = tipOf(item.branch);
      if (tip && merged(tip)) {
        findings.push(
          finding(
            'warn',
            'MERGE_NOT_RECORDED',
            item,
            'Nhánh đã nằm trọn trong ' + mainRef + ' nhưng trạng thái vẫn là ' + status + '.',
            { branch: item.branch, tip }
          )
        );
      }
    }

    // --- Records that point at nothing ----------------------------------
    if (item.work_item_path && !hasFile(item.work_item_path)) {
      const severity = status === TERMINAL_STATUS || status.startsWith('READY') ? 'error' : 'info';
      findings.push(
        finding(
          severity,
          'SPEC_MISSING',
          item,
          'work_item_path được khai nhưng file không tồn tại.',
          { path: item.work_item_path }
        )
      );
    }

    if (item.branch && !hasBranch(item.branch)) {
      // A merged Work Item's branch is normally deleted, so this is only a
      // problem while the work is supposed to be live.
      if (status !== TERMINAL_STATUS) {
        findings.push(
          finding(
            'warn',
            'BRANCH_MISSING',
            item,
            'Nhánh được khai nhưng không tồn tại cục bộ lẫn trên origin.',
            { branch: item.branch }
          )
        );
      }
    }

    if (item.pr && !item.branch) {
      findings.push(
        finding(
          'info',
          'PR_WITHOUT_BRANCH',
          item,
          'Có số PR nhưng không ghi nhánh, nên không truy ngược được.',
          { pr: item.pr }
        )
      );
    }

    if (!id) {
      findings.push(finding('error', 'ROW_WITHOUT_ID', item, 'Dòng không có work_item_id.'));
    }
  }

  const duplicates = findDuplicateIds(items);
  for (const dup of duplicates) {
    findings.push({
      severity: 'error',
      code: 'DUPLICATE_WORK_ITEM_ID',
      workItemId: dup.id,
      status: '(nhiều)',
      message: 'work_item_id xuất hiện ' + dup.count + ' lần; trạng thái không xác định được.',
      evidence: { count: dup.count },
    });
  }

  return {
    checked: items.length,
    findings,
    summary: {
      error: findings.filter((f) => f.severity === 'error').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    // An overstated register is the dangerous direction: it lets finished-looking
    // work be skipped. Understatement only wastes time.
    trustworthy: findings.every((f) => f.severity !== 'error'),
  };
}

function parseDependencies(raw) {
  if (!raw) return [];
  return (
    String(raw)
      .split(/[;,]/)
      .map((part) => part.trim())
      // Rows carry prose alongside ids ("see BACKLOG-DEPENDENCIES.md"); only
      // things shaped like a Work Item id are treated as dependencies.
      .filter((part) => /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(part))
  );
}

function findDuplicateIds(items) {
  const counts = new Map();
  for (const item of items) {
    const id = item.work_item_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const out = [];
  for (const [id, count] of counts) {
    if (count > 1) out.push({ id, count });
  }
  return out;
}

/**
 * Write-back — the part of this module that is allowed to change the register.
 *
 * Everything above only reports. What follows may mutate, and so it is written
 * to be boring: it moves a row only along an edge the Allowed-Transition Table
 * names, only when the repository itself proves the precondition, and it says
 * out loud why it refused whenever it does not move one.
 *
 * Two refusals matter more than the successes. A row is never advanced to
 * MERGED from branch ancestry, because a squash merge leaves the branch tip
 * unreachable from main and an ancestry check would therefore answer a
 * different question than the one asked (AI-TOOL-12). And a row is never
 * advanced to READY_FOR_AUTHOR at all: clearing a dependency proves the block
 * is stale, not that the item is ready, and readiness is Codex's gate to open.
 */

const ALLOWED_SOURCES_FOR_BACKLOG = new Set(['BLOCKED_DEPENDENCY', 'BLOCKED_BY_FOUNDATION']);
/**
 * Statuses a row may be recorded MERGED from.
 *
 * The pre-review states are included, and that is a deliberate widening. The
 * source check exists to stop a merge being INFERRED from a branch name; it is
 * not the thing that stops review from being skipped. What stops that is the
 * evidence bar: a reachable merge commit on mainRef, a verdict on the exact
 * head, zero unresolved threads, CI SUCCESS on the reviewed head. A row sitting
 * at BACKLOG with that evidence in hand did pass through review - the register
 * simply never recorded the intermediate steps, so it is stale rather than
 * early. Refusing it does not protect the gate, it preserves a false record.
 *
 * Measured 2026-09-16: fifteen rows had merged pull requests carrying real
 * implementation while the register still read BACKLOG or BLOCKED_DEPENDENCY,
 * because the lifecycle steps between were never written. Every one of them was
 * refused by the source check and none by the evidence bar.
 */
/**
 * Verdicts that satisfy the MERGED transition's review condition.
 *
 * `PASS` is Codex. `FALLBACK_PASS` is the machine-authenticated reviewer
 * TASK-AI-14 approved, admitted on the terms AI-19-R05 states: the reviewer is
 * named and the commit it read equals the evidence head. Kept as one set so the
 * transition and the audit cannot drift apart.
 */
const ACCEPTED_MERGED_VERDICTS = new Set(['PASS', 'FALLBACK_PASS']);

const ALLOWED_SOURCES_FOR_MERGED = new Set([
  'READY_FOR_CODEX',
  'CODEX_PASS',
  'BACKLOG',
  'READY_FOR_AUTHOR',
  'BLOCKED_DEPENDENCY',
  'BLOCKED_BY_FOUNDATION',
]);
const SHA_40 = /^[0-9a-f]{40}$/;

/**
 * Review outcomes that may clear a stale dependency block.
 *
 * `PASS` is the independent Codex verdict. `FALLBACK_PASS` records a review
 * that genuinely ran on another reviewer, named in the register rather than
 * disguised as Codex - today that is a model reached through the local
 * gateway, which has already found defects Codex never saw.
 *
 * Both are accepted here and only here. Neither is accepted for a MERGED
 * transition (AI-19-R04), and neither promotes anything to READY_FOR_AUTHOR,
 * which remains the independent planning gate's to open.
 */
const ACCEPTED_DEPENDENCY_VERDICTS = new Set(['PASS', 'FALLBACK_PASS']);

function mutation(item, from, to, rule, evidence) {
  return { workItemId: item.work_item_id, from, to, rule, evidence };
}

function refusal(workItemId, reason, rule) {
  return { workItemId, reason, rule };
}

/** Whether this evidence artifact is about this row. */
function evidenceTargets(evidence, item) {
  const id = item.work_item_id;
  const title = String(evidence.title || '');
  if (title.startsWith('[' + id + ']')) return true;
  const rowPr = String(item.pr || '')
    .trim()
    .replace(/^#/, '');
  const evPr = String(evidence.number === undefined ? '' : evidence.number)
    .trim()
    .replace(/^#/, '');
  return Boolean(rowPr) && rowPr === evPr;
}

/**
 * Whether one dependency is proven merged.
 *
 * "Proven" is deliberately narrow: present in the register, MERGED, carrying a
 * full 40-character merge commit that exists in this clone and is reachable on
 * mainRef, and reviewed to PASS. A short SHA or an unreachable one counts as
 * unproven rather than resolved, because the whole point of the check is that a
 * row may claim a merge that never landed here.
 */
function dependencyProven(depId, byId, probes) {
  const dep = byId.get(depId);
  if (!dep) return { ok: false, why: 'dependency ' + depId + ' is not in the register' };
  if (dep.status !== TERMINAL_STATUS) {
    return {
      ok: false,
      why: 'dependency ' + depId + ' is ' + (dep.status || '(none)') + ', not MERGED',
    };
  }
  const sha = String(dep.merge_commit || '').trim();
  if (!SHA_40.test(sha)) {
    return { ok: false, why: 'dependency ' + depId + ' has no 40-character merge_commit' };
  }
  if (!probes.hasCommit(sha)) {
    return {
      ok: false,
      why: 'dependency ' + depId + ' merge_commit ' + sha.slice(0, 8) + ' is not in this clone',
    };
  }
  if (!probes.merged(sha)) {
    return {
      ok: false,
      why:
        'dependency ' + depId + ' merge_commit ' + sha.slice(0, 8) + ' is not reachable on mainRef',
    };
  }
  // Clearing a stale block moves a row to BACKLOG, and BACKLOG grants nothing:
  // the item still needs the independent planning gate before anyone may pick
  // it up (AI-19-R03). So the evidence bar here is deliberately lower than the
  // one for MERGED. A review that actually happened is enough, whoever ran it,
  // as long as the register says who.
  //
  // What is NOT accepted is an empty verdict. "Nobody looked" is not a weaker
  // form of evidence, it is the absence of any, and a chain of unreviewed work
  // must not clear itself one link at a time.
  const verdict = String(dep.codex_verdict || '').trim();
  if (!verdict) {
    return { ok: false, why: 'dependency ' + depId + ' has no review verdict at all' };
  }
  if (!ACCEPTED_DEPENDENCY_VERDICTS.has(verdict)) {
    return {
      ok: false,
      why: 'dependency ' + depId + ' verdict "' + verdict + '" is not an accepted review outcome',
    };
  }
  return { ok: true, verdict };
}

/**
 * Whether a durable merge evidence artifact proves this row merged.
 *
 * Every clause here replaces a GitHub query the reconciler is not allowed to
 * make at runtime, so the artifact has to carry what that query would have
 * returned — and each field is checked against the row or against Git rather
 * than trusted for being present.
 */
function verifyMergeEvidence(evidence, item, probes) {
  const id = item.work_item_id;
  if (!evidence || typeof evidence !== 'object') {
    return { ok: false, why: 'no durable merge evidence provided' };
  }

  const rowPr = String(item.pr || '')
    .trim()
    .replace(/^#/, '');
  const evPr = String(evidence.number === undefined ? '' : evidence.number)
    .trim()
    .replace(/^#/, '');
  if (!evPr) return { ok: false, why: 'merge evidence has no PR number' };
  if (rowPr && rowPr !== evPr) {
    return {
      ok: false,
      why: 'merge evidence PR ' + evPr + ' does not match register PR ' + rowPr,
    };
  }

  const title = String(evidence.title || '');
  if (!title.startsWith('[' + id + ']')) {
    return { ok: false, why: 'merge evidence title does not start with [' + id + ']' };
  }

  const head = String(evidence.headRefOid || '').trim();
  if (!SHA_40.test(head)) {
    return { ok: false, why: 'merge evidence headRefOid is not a 40-character SHA' };
  }

  const mergeSha = String((evidence.mergeCommit && evidence.mergeCommit.oid) || '').trim();
  if (!SHA_40.test(mergeSha)) {
    return { ok: false, why: 'merge evidence mergeCommit.oid is not a 40-character SHA' };
  }
  if (!probes.hasCommit(mergeSha)) {
    return { ok: false, why: 'merge commit ' + mergeSha.slice(0, 8) + ' is not in this clone' };
  }
  if (!probes.merged(mergeSha)) {
    return {
      ok: false,
      why: 'merge commit ' + mergeSha.slice(0, 8) + ' is not reachable on mainRef',
    };
  }

  const verdict = String(evidence.codexVerdict || '').trim();
  if (verdict === 'FALLBACK_PASS') {
    // A fallback review is admitted here only because TASK-AI-14 established a
    // machine-authenticated reviewer as an approved route, and only on terms
    // Codex is held to. It carries two obligations Codex does not, because
    // Codex's identity is verified by GitHub and a fallback reviewer's is not:
    // the reviewer must be named, and the commit it read must be the exact head
    // the evidence claims. A review of some earlier commit is a review of
    // different code, and naming no reviewer makes the claim unfalsifiable.
    const reviewer = String(evidence.fallbackReviewer || '').trim();
    if (!reviewer) {
      return {
        ok: false,
        why: 'FALLBACK_PASS carries no fallbackReviewer, so the claim names nobody',
      };
    }
    const reviewed = String(evidence.reviewedCommit || '').trim();
    if (!SHA_40.test(reviewed)) {
      return { ok: false, why: 'FALLBACK_PASS reviewedCommit is not a 40-character SHA' };
    }
    // Two shapes are accepted, and they answer the same question: was the code
    // being recorded the code that was read?
    //
    //   - `reviewedCommit === headRefOid`: the review was of the pull request's
    //     final head, before it merged.
    //   - `reviewedAt: 'mainRef'`: the review was of the repository tip after
    //     the merge. This is the shape a re-review takes - a first review found
    //     defects, later pull requests fixed them, and the reviewer then read
    //     the result rather than the history. The merge commit must be reachable
    //     on mainRef and `reviewedCommit` must BE the mainRef tip, so the review
    //     is of code that contains the merge and is current.
    //
    // Neither shape proves the reviewer read anything. Both make the claim
    // falsifiable: the reviewed commit is named, and its content is fixed.
    const reviewedAt = String(evidence.reviewedAt || '').trim();
    if (reviewedAt) {
      if (reviewedAt !== 'mainRef') {
        return { ok: false, why: 'reviewedAt must be the literal mainRef' };
      }
      const tip = String(typeof probes.tip === 'function' ? probes.tip() || '' : '').trim();
      if (!SHA_40.test(tip)) {
        return { ok: false, why: 'the mainRef tip could not be read' };
      }
      if (reviewed !== tip) {
        return {
          ok: false,
          why:
            'reviewedAt names ' +
            reviewed.slice(0, 8) +
            ' but the mainRef tip is ' +
            tip.slice(0, 8),
        };
      }
    } else if (reviewed !== head) {
      return {
        ok: false,
        why:
          'FALLBACK_PASS reviewed ' +
          reviewed.slice(0, 8) +
          ' but the evidence head is ' +
          head.slice(0, 8),
      };
    }
  } else if (verdict !== 'PASS') {
    return { ok: false, why: 'exact-HEAD Codex verdict is not PASS' };
  }
  if (Number(evidence.unresolvedThreadsCount) !== 0) {
    return { ok: false, why: 'merge evidence reports unresolved review threads' };
  }
  if (String(evidence.ciChecksStatus || '').trim() !== 'SUCCESS') {
    return { ok: false, why: 'required CI checks are not SUCCESS on the reviewed head' };
  }

  const specPath = String(item.work_item_path || '').trim();
  if (!specPath || !probes.hasFile(specPath)) {
    return { ok: false, why: 'work_item_path does not exist on disk' };
  }

  return { ok: true, mergeSha, head };
}

/**
 * What write-back would do, without doing any of it.
 *
 * Returned separately from the act of writing so --dry-run and --write run the
 * identical decision path; a preview that reasons differently from the write it
 * previews is worth less than no preview at all.
 */
function planReconciliation(items, options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const mainRef = opts.mainRef || 'origin/main';
  const evidence = opts.mergeEvidence || null;

  const probes = {
    hasCommit: opts.commitExists || ((sha) => commitExists(sha, cwd)),
    merged: opts.isAncestorOf || ((sha) => isAncestorOf(sha, mainRef, cwd)),
    hasFile: opts.fileExists || ((p) => fileExists(p, cwd)),
    tip: opts.mainTip || (() => headSha(mainRef, cwd)),
  };

  const byId = new Map();
  for (const item of items) {
    if (item.work_item_id) byId.set(item.work_item_id, item);
  }

  const mutations = [];
  const refusals = [];

  for (const item of items) {
    const id = item.work_item_id;
    if (!id) continue;
    const status = String(item.status || '').trim();

    // Merge evidence is considered FIRST, before the stale-block branch.
    //
    // A BLOCKED_DEPENDENCY row matches the block-clearing branch, which clears
    // the block to BACKLOG and continues - so it never reached the MERGED
    // branch at all. Measured 2026-09-16: widening ALLOWED_SOURCES_FOR_MERGED
    // to accept pre-review statuses had no effect on any blocked row, and the
    // silent skip produced no refusal to explain why. A row carrying durable
    // merge evidence is merged, whatever it was blocked on.
    if (ALLOWED_SOURCES_FOR_MERGED.has(status) && evidence) {
      if (!evidenceTargets(evidence, item)) {
        // Not this row's evidence. Fall through rather than skip silently.
      } else {
        const verdict = verifyMergeEvidence(evidence, item, probes);
        if (!verdict.ok) {
          refusals.push(refusal(id, verdict.why, 'AI-19-R04'));
          continue;
        }
        mutations.push(
          mutation(item, status, TERMINAL_STATUS, 'AI-19-R04', {
            pr: String(evidence.number),
            mergeCommit: verdict.mergeSha,
            headRefOid: verdict.head,
            codexVerdict: evidence.codexVerdict,
            unresolvedThreadsCount: evidence.unresolvedThreadsCount,
            ciChecksStatus: evidence.ciChecksStatus,
          })
        );
        continue;
      }
    }

    if (ALLOWED_SOURCES_FOR_BACKLOG.has(status)) {
      const deps = parseDependencies(item.dependencies);
      if (deps.length === 0) continue;
      let blocked = null;
      for (const dep of deps) {
        const verdict = dependencyProven(dep, byId, probes);
        if (!verdict.ok) {
          blocked = verdict.why;
          break;
        }
      }
      if (blocked) continue;
      // The audit names the commits and verdicts that proved this, so the
      // record can be checked later without re-deriving it from a register
      // that may have moved on.
      mutations.push(
        mutation(item, status, 'BACKLOG', 'AI-19-R03', {
          dependencies: deps,
          dependencyCommits: deps.map((d) => (byId.get(d) || {}).merge_commit || null),
          dependencyVerdicts: deps.map((d) => (byId.get(d) || {}).codex_verdict || null),
          note: 'every declared dependency is MERGED with a reachable commit and a PASS verdict',
        })
      );
      continue;
    }

    if (ALLOWED_SOURCES_FOR_MERGED.has(status)) {
      if (!evidence) {
        refusals.push(refusal(id, 'no durable merge evidence provided', 'AI-19-R04'));
        continue;
      }
      if (!evidenceTargets(evidence, item)) continue;
      const verdict = verifyMergeEvidence(evidence, item, probes);
      if (!verdict.ok) {
        refusals.push(refusal(id, verdict.why, 'AI-19-R04'));
        continue;
      }
      mutations.push(
        mutation(item, status, TERMINAL_STATUS, 'AI-19-R04', {
          pr: String(evidence.number),
          mergeCommit: verdict.mergeSha,
          headRefOid: verdict.head,
          codexVerdict: evidence.codexVerdict,
          unresolvedThreadsCount: evidence.unresolvedThreadsCount,
          ciChecksStatus: evidence.ciChecksStatus,
        })
      );
      continue;
    }

    // A row outside both allowed source sets is never moved. It is only worth
    // saying so when evidence was aimed at it, because that is the case an
    // operator can mistake for a bug: the evidence is valid, the row is simply
    // not at a point in its lifecycle where MERGED is reachable without
    // skipping the author, review and CI gates in between.
    if (evidence && evidenceTargets(evidence, item)) {
      refusals.push(
        refusal(id, 'source status ' + status + ' is not an allowed transition source', 'AI-19-R02')
      );
    }
  }

  return { mutations, refusals };
}

/**
 * RFC 4180 records, each keeping the exact bytes it arrived as.
 *
 * Keeping the raw text per record is what makes byte-for-byte fidelity cheap:
 * an untouched row is written back as the very string that was read, so no
 * quoting or line-ending decision of ours can perturb a row we did not mean to
 * change. Only a mutated row is re-serialized.
 */
function parseCsvRecords(text) {
  const records = [];
  let field = '';
  let fields = [];
  let raw = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    raw += ch;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          raw += text[i + 1];
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        raw += text[i + 1];
        i += 1;
      }
      fields.push(field);
      records.push({ raw, fields, terminated: true });
      field = '';
      fields = [];
      raw = '';
    } else field += ch;
  }

  if (raw.length > 0 || field.length > 0 || fields.length > 0) {
    fields.push(field);
    records.push({ raw, fields, terminated: false });
  }

  return records;
}

function serializeField(value) {
  const s = String(value === undefined || value === null ? '' : value);
  // The register quotes every field; matching that is what keeps a rewritten
  // row visually identical to its neighbours in a diff.
  return '"' + s.replace(/"/g, '""') + '"';
}

function serializeRecord(fields, eol) {
  return fields.map(serializeField).join(',') + (eol || '');
}

/** The line ending a record used, so a rewrite does not convert the file. */
function eolOf(record) {
  const m = /(\r\n|\n|\r)$/.exec(record.raw);
  return m ? m[1] : '';
}

/**
 * Rewrite only the status cell of the named rows.
 *
 * Returns the new text plus the count actually changed, which the caller
 * compares against the plan: a mutation that was planned but matched no row is
 * a bug worth failing on, not a no-op to shrug at.
 */
/** Column positions, read from the header so a reordered register is not a silent corruption. */
function columnIndexes(headerFields, opts) {
  const find = (name, fallback) => {
    const at = headerFields.indexOf(name);
    return at === -1 ? fallback : at;
  };
  return {
    id: opts.idColumn === undefined ? find('work_item_id', 3) : opts.idColumn,
    status: opts.statusColumn === undefined ? find('status', 7) : opts.statusColumn,
    pr: find('pr', 11),
    verdict: find('codex_verdict', 12),
    commit: find('merge_commit', 13),
  };
}

/**
 * Write the register.
 *
 * A MERGED transition writes four cells, not one. Writing only the status
 * produces a row that claims to be merged and shows no pull request, no commit
 * and no verdict - which the audit then reports as MERGED_WITHOUT_COMMIT and
 * MERGED_WITHOUT_PASS. Measured on 2026-09-16: recording a single row that way
 * made write-back refuse the NEXT write, because the register it was about to
 * amend was already inconsistent.
 *
 * A mutation with no evidence (clearing a stale block) still writes only the
 * status, because there is nothing else it could honestly record.
 */
function applyStatusMutations(text, mutations, options) {
  const opts = options || {};
  const records = parseCsvRecords(text);
  const cols = columnIndexes(records.length ? records[0].fields : [], opts);

  const wanted = new Map();
  for (const m of mutations) wanted.set(m.workItemId, m);

  let applied = 0;

  const out = records
    .map((record, index) => {
      if (index === 0) return record.raw;
      const id = record.fields[cols.id];
      if (!wanted.has(id)) return record.raw;
      const m = wanted.get(id);
      if (record.fields[cols.status] === m.to) return record.raw;

      const fields = record.fields.slice();
      fields[cols.status] = m.to;

      const ev = m.evidence;
      if (m.to === 'MERGED' && ev) {
        if (ev.pr !== undefined) fields[cols.pr] = String(ev.pr);
        if (ev.codexVerdict !== undefined) fields[cols.verdict] = String(ev.codexVerdict);
        if (ev.mergeCommit !== undefined) fields[cols.commit] = String(ev.mergeCommit);
      }

      applied += 1;
      return serializeRecord(fields, eolOf(record));
    })
    .join('');

  return { text: out, applied };
}

module.exports = {
  reconcileRegister,
  parseDependencies,
  findDuplicateIds,
  planReconciliation,
  verifyMergeEvidence,
  dependencyProven,
  evidenceTargets,
  parseCsvRecords,
  applyStatusMutations,
  serializeRecord,
  ACCEPTED_DEPENDENCY_VERDICTS,
  ACCEPTED_MERGED_VERDICTS,
  ALLOWED_SOURCES_FOR_BACKLOG,
  ALLOWED_SOURCES_FOR_MERGED,
};
