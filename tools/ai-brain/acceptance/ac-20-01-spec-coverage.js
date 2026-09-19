'use strict';
// AC-AI-20-01: The specification-identity rule over the real register
//
// Expected: exit 0, print "SPEC_COVERAGE: 0 identity mismatches" after printing
// the measured specified/unspecified counts as evidence.
//
// The rule itself lives in lib/spec-coverage.js, and AC-AI-20-02 requires the
// same module, so editing the rule there changes both this invariant and its
// negative proof. The count is measured, never pinned - it drifts as the
// register grows and as Work Items are authored.
//
// Six controls, in two groups. The first three answer with in-memory row
// variants: a real specified row whose path is altered to a file that does not
// exist must be counted as unspecified, a real unspecified row whose path is
// pointed at a real file must stop being counted, and a row that names no path
// at all must be counted as unspecified rather than vanish from the measure. A
// rule answering from a constant passes none of these probes.
//
// The last three answer with a tampered COPY of the register under os.tmpdir():
// the repository's own file is never opened for write, and no register value is
// invented - the blanked path and the borrowed document both come out of real
// rows. Before either tampered copy is used, the copy mechanism must rewrite
// the chosen row's line with nothing changed and have it re-read as the same row
// on the same line: a proof that changed one cell is worth nothing until the
// writer is shown to change one cell and nothing else.
//
// The control this row used to lack is the last one. "SPEC_COVERAGE: 0 identity
// mismatches" is the exact output of a rule that reports nothing and of a rule
// that checks nothing, and unlike the coverage count it had no negative proof
// anywhere in this harness: AC-AI-20-02 rejects a tampered *document*, never the
// register-wide count printed here. Redirecting a real row at another real row's
// own document has to move this count by exactly one, or the identity half of
// this row is unmeasured (AI-20-R08).
//
// Exit 0 every control answered correctly and no row's document names another row.
// Exit 1 the invariant is violated: a real specification belongs to a different row.
// Exit 2 a rule failed its control, or the question cannot be measured here.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REGISTER_PATH,
  coverageByPath,
  identityMismatches,
  registerLineFor,
  registerRows,
  specExists,
  specIdentity,
  specifiedRows,
  tamperRegisterRow,
  unspecifiedRows,
} = require('./lib/spec-coverage');

const root = process.cwd();
const registerPath = path.resolve(root, REGISTER_PATH);

// Exit 2 when no register exists - AC-AI-20-04 exercises this.
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at', registerPath);
  process.exit(2);
}

const registerText = fs.readFileSync(registerPath, 'utf8');
const rows = registerRows(registerText);
if (rows.length === 0) {
  console.error('CONTROL_FAILURE: the canonical reader parsed zero rows from a register on disk');
  process.exit(2);
}
const partition = coverageByPath(rows, root);

// CONTROL - the rule must read the real filesystem in both directions.
const specifiedRow = partition.specified[0];
const unspecifiedRow = partition.unspecified[0];
if (!specifiedRow || !unspecifiedRow) {
  console.error(
    'CONTROL_FAILURE: the register has no specified row or no unspecified row to probe'
  );
  process.exit(2);
}
const phantom = Object.assign({}, specifiedRow, {
  work_item_path: path.join('docs', 'product-spec', 'work-items', '__ac20-phantom__.md'),
});
if (unspecifiedRows([phantom], root).length !== 1) {
  console.error('CONTROL_FAILURE: an absent path was not counted as unspecified');
  process.exit(2);
}
const borrowed = Object.assign({}, unspecifiedRow, {
  work_item_path: specifiedRow.work_item_path,
});
if (unspecifiedRows([borrowed], root).length !== 0) {
  console.error('CONTROL_FAILURE: an existing path was counted as unspecified');
  process.exit(2);
}
// CONTROL - a row that names no document at all is the least actionable row the
// register can carry, so it must land in the unspecified set rather than being
// skipped by the measure (AI-20-R01).
const nameless = Object.assign({}, specifiedRow, { work_item_path: '' });
if (unspecifiedRows([nameless], root).length !== 1) {
  console.error('CONTROL_FAILURE: a row with no work_item_path was not counted as unspecified');
  process.exit(2);
}
// A row is specified by its path, not by its label: the borrowed document still
// resolves for the row that borrows it, and says which row it really belongs to.
const borrowedIdentity = specIdentity(borrowed, root);
if (!borrowedIdentity.exists || borrowedIdentity.declaredId !== specifiedRow.work_item_id) {
  console.error(
    `CONTROL_FAILURE: ${specifiedRow.work_item_id}'s document does not declare its own Work Item ID`
  );
  process.exit(2);
}

// The printed counts come out of the module's partition, so this script never
// restates what "specified" means. A row that handed back a constant, or that
// dropped rows from the measure, is caught here: every register row must appear
// in exactly one of the two sets, and the two exported views of the measure must
// agree with each other.
const { specified, unspecified } = partition;
if (specified.length + unspecified.length !== rows.length) {
  console.error('CONTROL_FAILURE: the partition does not cover every register row once');
  process.exit(2);
}
if (
  specifiedRows(rows, root).length !== specified.length ||
  unspecifiedRows(rows, root).length !== unspecified.length
) {
  console.error('CONTROL_FAILURE: the exported sets disagree with the partition');
  process.exit(2);
}

const mismatches = identityMismatches(rows, root);

// --- the tampered copies ----------------------------------------------------
// Both tampered copies are built from the register's own text by the module that
// already owns the row shape, and neither is trusted until it has been shown to
// alter exactly one line of that text.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-20-01-'));
// An `exit` handler rather than a `finally`: every control below answers with
// process.exit(2), and a proof that cleans up only while it passes litters the
// machine the moment it is wrong.
process.on('exit', () => {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch (err) {
    /* already gone */
  }
});

/** The line positions where two texts differ, or null if they differ in size. */
function changedLines(before, after) {
  const left = String(before).split(/\r?\n/);
  const right = String(after).split(/\r?\n/);
  if (left.length !== right.length) return null;
  const diff = [];
  left.forEach((line, index) => {
    if (line !== right[index]) diff.push(index);
  });
  return diff;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

/**
 * A copy of the register in which `row` carries `changes`, read back through the
 * canonical reader.
 *
 * The copy is rejected unless it alters exactly the located line and no other: no
 * more, so a quiet reformat cannot be what the counts below are attributed to, and
 * no less, so the tamper really happened.
 */
function registerCopy(row, changes, label) {
  const located = registerLineFor(registerText, row);
  if (!located) {
    fail(`CONTROL_FAILURE: ${label}: ${row.work_item_id} is not uniquely located in the register`);
  }
  const copy = tamperRegisterRow(registerText, row, changes);
  if (!copy) {
    fail(`CONTROL_FAILURE: could not build the ${label} copy for ${row.work_item_id}`);
  }
  // A change that asks for the value the line already carries rewrites nothing -
  // AC-20-03's ladder starts at the probe row's own status. Anything else has to
  // alter exactly the located line and no other.
  const expected = copy.line === located.line ? [] : [located.index];
  const diff = changedLines(registerText, copy.text);
  if (!diff || JSON.stringify(diff) !== JSON.stringify(expected)) {
    fail(
      `CONTROL_FAILURE: the ${label} copy altered lines ${JSON.stringify(diff)} ` +
        `where ${JSON.stringify(expected)} was the whole of the tampering`
    );
  }
  const reread = registerRows(copy.text);
  if (reread.length !== rows.length) {
    fail(
      `CONTROL_FAILURE: the ${label} copy holds ${reread.length} rows ` +
        `where the register holds ${rows.length}`
    );
  }
  const sameRow = reread.filter((candidate) => candidate.work_item_id === row.work_item_id);
  if (sameRow.length !== 1) {
    fail(`CONTROL_FAILURE: the ${label} copy re-reads ${row.work_item_id} ${sameRow.length} times`);
  }
  const unapplied = Object.entries(changes).filter(
    ([column, value]) => String(sameRow[0][column]) !== String(value)
  );
  if (unapplied.length > 0) {
    fail(
      `CONTROL_FAILURE: the ${label} copy re-reads ${unapplied.map(([c]) => c).join(', ')} ` +
        'as something other than the value asked for'
    );
  }
  return { rows: reread, row: sameRow[0] };
}

// CONTROL - the writer is inert before it is interesting: rewriting the chosen
// row's line with nothing changed has to re-read as the row that went in, or a
// one-cell change below would say nothing about which cell moved the measure.
const roundTrip = registerCopy(specifiedRow, {}, 'round-trip');
if (JSON.stringify(roundTrip.row) !== JSON.stringify(specifiedRow)) {
  fail('CONTROL_FAILURE: the round-tripped row does not re-read as the row that went in');
}

// CONTROL - a blanked path on a real document is one row that stops being
// specified, not one row that stops being counted (AI-20-R01).
const blanked = registerCopy(specifiedRow, { work_item_path: '' }, 'blank-path');
const blankPartition = coverageByPath(blanked.rows, root);
if (blankPartition.specified.length + blankPartition.unspecified.length !== rows.length) {
  fail('CONTROL_FAILURE: blanking a path stopped the partition covering every row once');
}
if (
  blankPartition.unspecified.length !== unspecified.length + 1 ||
  blankPartition.specified.length !== specified.length - 1
) {
  fail(
    `CONTROL_FAILURE: blanking one path moved the counts to ${blankPartition.specified.length}` +
      `/${blankPartition.unspecified.length} instead of exactly one row across`
  );
}
if (
  !blankPartition.unspecified.some(
    (candidate) => candidate.work_item_id === specifiedRow.work_item_id
  ) ||
  blanked.row.work_item_path !== ''
) {
  fail('CONTROL_FAILURE: the blanked row is not the row counted as unspecified');
}

// CONTROL - the population this row is named for has to be measurable: redirect a
// real row at another real row's own document and exactly one mismatch appears,
// attributed to that pair. A detector that reports nothing, or checks nothing, is
// indistinguishable from the honest zero printed below until this runs.
const donor = rows.find(
  (row) => row.work_item_id !== specifiedRow.work_item_id && specIdentity(row, root).matches
);
if (!donor) {
  fail('SOURCE_MISSING: no second row whose document declares its own ID to borrow from');
}
const controlDoc = path.join(workDir, 'identity-control.md');
fs.copyFileSync(path.resolve(root, donor.work_item_path), controlDoc);
const redirected = registerCopy(
  specifiedRow,
  { work_item_path: path.relative(root, controlDoc) },
  'identity'
);
const moved = identityMismatches(redirected.rows, root);
if (moved.length !== mismatches.length + 1) {
  fail(
    `CONTROL_FAILURE: a borrowed identity moved the mismatch count to ${moved.length} from ` +
      `${mismatches.length}, expected exactly one more - the detector checks nothing`
  );
}
const entry = moved.find((mismatch) => mismatch.row.work_item_id === specifiedRow.work_item_id);
if (!entry || entry.identity.declaredId !== donor.work_item_id) {
  fail(
    `CONTROL_FAILURE: the mismatch is not attributed to ${specifiedRow.work_item_id} ` +
      `declaring ${donor.work_item_id}`
  );
}
if (coverageByPath(redirected.rows, root).specified.length !== specified.length) {
  fail(
    'CONTROL_FAILURE: the identity control moved the coverage count too, so it proved less than it claimed'
  );
}

console.log(`SPEC_COVERAGE: specified=${specified.length}, unspecified=${unspecified.length}`);
console.log('CONTROL: the rule counted an absent path and cleared an existing one');
console.log(
  `CONTROL: every register row is counted exactly once (${specified.length}+${unspecified.length}=${rows.length})`
);
console.log(
  `AC-AI-20-01 CONTROL: the copy mechanism round-trips ${specifiedRow.work_item_id}'s register ` +
    'line and re-reads the same row, so a one-cell change is a one-cell change'
);
console.log(
  `AC-AI-20-01 CONTROL: blanking ${specifiedRow.work_item_id}'s work_item_path moves exactly one ` +
    `row unspecified (${unspecified.length} -> ${blankPartition.unspecified.length}) ` +
    `and keeps all ${rows.length} rows in the measure`
);
console.log(
  `AC-AI-20-01 CONTROL: ${specifiedRow.work_item_id} redirected at ${donor.work_item_id}'s own ` +
    `document moves the identity-mismatch count ${mismatches.length} -> ${moved.length}, ` +
    'attributed to that row, while the coverage count holds'
);
console.log(`SPEC_COVERAGE: ${mismatches.length} identity mismatches`);

if (mismatches.length > 0) {
  console.error('\nIdentity mismatches found:');
  for (const entry of mismatches) {
    console.error(
      `  ${entry.row.work_item_id}: path="${entry.identity.path}" declares "${entry.identity.declaredId}"`
    );
  }
  process.exit(1);
}

process.exit(0);
