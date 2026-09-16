'use strict';
// TASK-AI-21 — the lesson-schema rule, held in exactly one place.
//
// `ac-21-01-lesson-schema.js` (the invariant: the real schema admits the real
// conformance seed, and the real seed is a well-formed lesson set) and
// `ac-21-02-lesson-record-inadmissible.js` (the negative proof: a copy of the
// seed with `source_commit` removed from an approved lesson is refused) both
// require this module, and so do `ac-21-03-lesson-requirement.js` and
// `ac-21-04-lesson-requirement-missing.js`. Editing the rule here changes the
// gate and the proof of the gate together; a private copy in each script would
// let one drift from the other while both stayed green.
//
// The rule is a CLAIM ABOUT TWO REAL FILES, not a re-implementation of a
// validator:
//   * `tools/ai-brain/lessons/lesson-schema.json` is the lesson schema this Work
//     Item creates;
//   * `tools/ai-brain/lessons/lesson-seed.json` is the approved-and-proposed
//     conformance seed that proves the schema is satisfiable and effective.
//
// `matchesSchema` is a deliberately small, documented subset of JSON Schema:
// `type`, `enum`, `const`, `pattern`, `minLength`, `required`, `properties`,
// `additionalProperties: false`, `items`, `allOf` and `if`/`then`/`else` — which
// is exactly the subset the schema uses. No validator dependency is installed in
// this repository, so the subset is committed and named rather than implied.
//
// Exit codes used by the scripts that require this file:
//   0 the claim holds   1 the claim is violated   2 the claim cannot be measured

const SCHEMA_PATH = 'tools/ai-brain/lessons/lesson-schema.json';
const SEED_PATH = 'tools/ai-brain/lessons/lesson-seed.json';

// The four fields the register's key behaviour names: an approved lesson carries
// them. `expiry` and `superseded_by` are carried as explicit nulls when they do
// not apply, so "no expiry" and "not replaced" are written down rather than
// inferred from an absent key.
const APPROVAL_FIELDS = ['source_commit', 'scope', 'expiry', 'superseded_by'];

/** The JSON type name of a parsed value, with arrays and null distinguished. */
function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Every way `instance` fails `schema`, as readable strings. Empty means it
 * conforms. Only the JSON Schema subset named in this file's header is applied.
 */
function matchesViolations(schema, instance, pointer, out) {
  out = out || [];
  pointer = pointer || '$';

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    if (JSON.stringify(instance) !== JSON.stringify(schema.const)) {
      out.push(pointer + ' must be ' + JSON.stringify(schema.const));
    }
  }
  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(instance));
    if (!allowed) out.push(pointer + ' is not one of ' + JSON.stringify(schema.enum));
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.indexOf(jsonType(instance)) < 0) {
      out.push(pointer + ' is ' + jsonType(instance) + ', expected ' + types.join(' or '));
      // A value of the wrong type cannot be probed further without inventing
      // violations the schema does not state.
      return out;
    }
  }

  if (typeof instance === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(instance)) {
      out.push(pointer + " does not match '" + schema.pattern + "'");
    }
    if (typeof schema.minLength === 'number' && instance.length < schema.minLength) {
      out.push(pointer + ' is shorter than ' + schema.minLength + ' characters');
    }
  }

  if (instance !== null && typeof instance === 'object' && !Array.isArray(instance)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(instance, key)) {
        out.push(pointer + " missing required '" + key + "'");
      }
    }
    const properties = schema.properties || {};
    for (const key of Object.keys(properties)) {
      if (Object.prototype.hasOwnProperty.call(instance, key)) {
        matchesViolations(properties[key], instance[key], pointer + '.' + key, out);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          out.push(pointer + " has undeclared property '" + key + "'");
        }
      }
    }
  }

  if (Array.isArray(instance) && schema.items) {
    instance.forEach((item, index) => {
      matchesViolations(schema.items, item, pointer + '[' + index + ']', out);
    });
  }

  for (const sub of schema.allOf || []) matchesViolations(sub, instance, pointer, out);

  if (schema.if) {
    const probe = matchesViolations(schema.if, instance, pointer, []);
    if (probe.length === 0 && schema.then) matchesViolations(schema.then, instance, pointer, out);
    if (probe.length > 0 && schema.else) matchesViolations(schema.else, instance, pointer, out);
  }

  return out;
}

/** The `if`/`then` branch that states the requirement for `status`. */
function statusBranch(schema, status) {
  for (const sub of schema.allOf || []) {
    if (!sub.if || !sub.then) continue;
    const declared = sub.if.properties && sub.if.properties.status;
    if (declared && declared.const === status) return sub.then;
  }
  return null;
}

/** The parsed lessons of a conformance seed, in declaration order. */
function seedLessons(seed) {
  if (seed && Array.isArray(seed.lessons)) return seed.lessons;
  return [];
}

/**
 * Every way the real schema fails to require the four fields for an APPROVED
 * lesson. This is the register's key behaviour, stated about the schema itself:
 * an approved lesson carries source_commit, scope, expiry and superseded_by.
 */
function approvedRequirementViolations(schema) {
  const violations = [];
  const approved = statusBranch(schema, 'approved');
  const required = (approved && approved.required) || [];
  const topLevelRequired = schema.required || [];
  const properties = schema.properties || {};

  for (const field of APPROVAL_FIELDS) {
    if (required.indexOf(field) < 0) {
      violations.push(field + ' is not required for an approved lesson');
    }
    if (topLevelRequired.indexOf(field) < 0) {
      violations.push(field + ' is not required of a lesson at all');
    }
  }

  const commit = properties.source_commit;
  if (!commit || commit.pattern !== '^[0-9a-f]{40}$') {
    violations.push('source_commit is not constrained to a 40-character commit');
  }

  const scope = properties.scope;
  if (!scope || (!Array.isArray(scope.enum) && typeof scope.pattern !== 'string')) {
    violations.push('scope carries no admissible-value constraint');
  }

  for (const field of ['expiry', 'superseded_by']) {
    const declared = properties[field];
    const types = declared && (Array.isArray(declared.type) ? declared.type : [declared.type]);
    if (!types || types.indexOf('null') < 0) {
      violations.push(
        field + ' cannot be null, so its not-applicable state cannot be written down'
      );
    }
  }

  return violations;
}

module.exports = {
  SCHEMA_PATH,
  SEED_PATH,
  APPROVAL_FIELDS,
  jsonType,
  matchesViolations,
  statusBranch,
  seedLessons,
  approvedRequirementViolations,
};
