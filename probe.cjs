process.on('uncaughtException', (e) => { process.stderr.write('UNCAUGHT: ' + (e && e.stack || e) + '\n'); process.exit(2); });
const w = (s) => process.stdout.write(s + '\n');
w('STEP1 requiring @shipde/config');
const cfg = require('@shipde/config');
w('STEP2 validateConfig=' + typeof cfg.validateConfig + ' ConfigValidationError=' + typeof cfg.ConfigValidationError);
w('STEP3 calling validateConfig()');
try {
  const c = cfg.validateConfig();
  w('STEP4 config OK: ' + JSON.stringify(c));
} catch (e) {
  w('STEP4x validateConfig threw: ' + (e && e.stack || e));
}
w('STEP5 done');