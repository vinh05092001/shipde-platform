'use strict';
// Single source of truth for the forbidden install-lifecycle rule.
//
// Two acceptance rows depend on this one module and nowhere else:
//
//   * `ac-37-06-lifecycle-clean.js` — positive: the real root and web manifests
//     carry none of these scripts.
//   * `ac-37-07-forbidden-lifecycle.js` — negative proof: a tampered COPY of the
//     real root manifest is rejected by the same predicate.
//
// Before this module existed, each row carried a private copy of the list, so
// changing the rule in one file left the other row green and the negative proof
// did not exercise the check the positive row ran. `ac-37-06` additionally
// carries a CONTROL that fails if this list can no longer fire, so neutering the
// rule is detected in both directions rather than silently passing.
const FORBIDDEN_INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

// The predicate under test: the forbidden script names present on a manifest.
function findForbiddenLifecycleScripts(manifest) {
  return FORBIDDEN_INSTALL_SCRIPTS.filter((s) => manifest.scripts && manifest.scripts[s]);
}

module.exports = { FORBIDDEN_INSTALL_SCRIPTS, findForbiddenLifecycleScripts };
