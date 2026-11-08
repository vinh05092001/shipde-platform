'use strict';
const path = require('node:path');
// Explicit coordinator inputs; no workstation defaults, environment or import-time I/O.
function coordinatorOptions(args) {
  const flags = new Set(['offline', 'dry-run', 'json']);
  const values = new Set('root runtime cwd task item role snapshot decision code-sha'.split(' '));
  const refuse = () => {
    throw new Error('COORDINATOR_INPUT_INVALID');
  };
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  for (const [key, value] of Object.entries(args)) {
    if (key === '_' && Array.isArray(value) && value.every((v) => v === 'dispatch')) continue;
    if (flags.has(key) ? value !== true : !values.has(key) || !text(value)) refuse();
  }
  if (!args.offline || !['root', 'runtime', 'code-sha'].every((k) => text(args[k]))) refuse();
  if (!path.isAbsolute(args.root) || !/^[a-f\d]{40}$/i.test(args['code-sha'])) refuse();
  const decision = text(args.decision);
  const ordinary = ['cwd', 'task', 'item', 'snapshot'];
  if (
    decision
      ? ['snapshot', 'task', 'item'].some((k) => args[k])
      : !ordinary.every((k) => text(args[k]))
  )
    refuse();
  const cwd = path.resolve(args.root, args.cwd || args.root);
  const runtime = path.resolve(args.root, args.runtime);
  const input = path.resolve(runtime, decision ? args.decision : args.snapshot);
  const relative = path.relative(runtime, input);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.json$/i.test(input)) refuse();
  if (/(?:^|[\\/])(?:\.env[^\\/]*|auth\.json|opencode\.json|accounts\.[^\\/]*)$/i.test(input))
    refuse();
  return {
    root: path.resolve(args.root),
    runtime,
    cwd,
    input,
    decision,
    task: args.task ? path.resolve(cwd, args.task) : null,
    item: args.item || null,
    role: args.role || 'author.foundation',
    codeSha: args['code-sha'],
  };
}
module.exports = { coordinatorOptions };
