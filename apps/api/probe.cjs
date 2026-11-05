const origExit = process.exit;
let exiting = false;
process.exit = function(code) {
  if (exiting) { return; }
  exiting = true;
  process.stderr.write('PROCESS_EXIT called with code=' + code + '\n');
  origExit(code);
};
const w = (s) => process.stdout.write(s + '\n');

w('STEP1 requiring @shipde/config');
const cfg = require('@shipde/config');
w('STEP2 validateConfig()');
const config = cfg.validateConfig();
w('STEP3 requiring NestFactory');
const { NestFactory } = require('@nestjs/core');
w('STEP4 requiring AppModule');
const { AppModule } = require('./dist/app.module.js');

// Monkey-patch ExceptionHandler.handle to print the rejection before Nest exits
let ExceptionHandler;
try {
  ExceptionHandler = require('@nestjs/core/errors/exception-handler').ExceptionHandler;
  const origHandle = ExceptionHandler.prototype.handle;
  ExceptionHandler.prototype.handle = function(error) {
    process.stderr.write('EXCEPTION_HANDLER.handle REASON: ' + (error && error.stack || error) + '\n');
    return origHandle.call(this, error);
  };
  w('EXCEPTION_HANDLER patched');
} catch (e) {
  process.stderr.write('EXCEPTION_HANDLER patch failed: ' + (e && e.stack || e) + '\n');
}

w('STEP5 calling NestFactory.create');
NestFactory.create(AppModule, { logger: false }).then((app) => {
  w('STEP6 create resolved');
  app.listen(config.PORT);
  w('STEP7 listen started');
}).catch((e) => {
  process.stderr.write('STEPX rejected: ' + (e && e.stack || e) + '\n');
  process.exit(1);
});