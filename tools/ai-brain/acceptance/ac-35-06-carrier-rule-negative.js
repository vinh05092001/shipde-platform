'use strict';
// AC-AI-35-06 — negative proof that the real carrier-token rule shipped in
// `.gitleaks.toml` rejects a tampered copy of a real tracked repository file.
// The rule is read from the real config, never restated here; the file on disk
// is never written. Exits 2 outside the repository so a missing source can
// never be mistaken for a clean result.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = '.gitleaks.toml';
const SUBJECT = 'package.json';

for (const src of [CONFIG, SUBJECT]) {
  if (!fs.existsSync(src)) {
    console.error('SOURCE_MISSING: ' + src);
    process.exit(2);
  }
}

const toml = fs.readFileSync(CONFIG, 'utf8');
const ruleBlock = toml
  .split(/^\[\[rules\]\]\s*$/m)
  .find((b) => /id\s*=\s*"shipde-carrier-live-token"/.test(b));
if (!ruleBlock) {
  console.error('SOURCE_MISSING: rule shipde-carrier-live-token in ' + CONFIG);
  process.exit(2);
}
const regexMatch = ruleBlock.match(/^\s*regex\s*=\s*'''([\s\S]*?)'''/m);
if (!regexMatch) {
  console.error('SOURCE_MISSING: regex of shipde-carrier-live-token in ' + CONFIG);
  process.exit(2);
}

// Gitleaks regexes are Go RE2 and may carry leading inline flags such as
// `(?i)`, which JavaScript expresses as constructor flags instead.
let source = regexMatch[1];
let flags = '';
const inline = source.match(/^\(\?([ims]+)\)/);
if (inline) {
  flags = inline[1].replace(/[^ims]/g, '');
  source = source.slice(inline[0].length);
}

let rule;
try {
  rule = new RegExp(source, flags);
} catch (err) {
  console.error('RULE_UNCOMPILABLE: ' + err.message);
  process.exit(2);
}

const real = fs.readFileSync(SUBJECT, 'utf8');

// Control: the untouched real file must be accepted, or the tampered copy
// proves nothing.
if (rule.test(real)) {
  console.error('CONTROL_FAILED: the untouched ' + SUBJECT + ' already matches the carrier rule');
  process.exit(2);
}

// The token is assembled, never written as a literal, so this file itself
// carries no carrier-token shaped string.
const token = ['ghn', 'live', 'QA' + '0123456789abcdef'].join('_');
const tampered = real.replace(/\n/, '\n  "__tampered_by_ac_35_06": "' + token + '",\n');

const tmp = path.join(os.tmpdir(), 'shipde-ac35-06-' + process.pid + '.json');
fs.writeFileSync(tmp, tampered);
const reread = fs.readFileSync(tmp, 'utf8');
const detected = rule.test(reread);
fs.unlinkSync(tmp);

if (!detected) {
  console.error('CARRIER_TOKEN_NOT_DETECTED: the real rule accepted the tampered copy');
  process.exit(0);
}
console.error(
  'CARRIER_TOKEN_DETECTED_IN_TAMPERED_COPY: shipde-carrier-live-token rejected the tampered ' +
    SUBJECT
);
process.exit(1);
