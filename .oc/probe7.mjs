import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'probe7-'));
const ref = join(root, 'l.mjs');
writeFileSync(
  ref,
  `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const [counter, body, redirectTo] = process.argv.slice(2);
const server = createServer((req, res) => {
  appendFileSync(counter, req.url + '\\n');
  res.end(body);
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
`
);
console.log('--- file content ---');
console.log(readFileSync(ref, 'utf8'));
const pub = spawn(process.execPath, [ref, join(root, 'hits'), 'x', '-']);
pub.stderr.on('data', (c) => console.error('STDERR:', String(c)));
pub.stdout.on('data', (c) => console.log('STDOUT:', JSON.stringify(String(c))));
pub.on('exit', (c, s) => console.error('EXIT', c, s));
setTimeout(() => {
  pub.kill();
  process.exit(0);
}, 2000);
