import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResearch } from '../scripts/ai/research.mjs';

const fixture = fileURLToPath(new URL('../scripts/ai/test/fixtures/agent-reach.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'probe8-'));
const publicRef = join(root, 'public-listener.mjs');
const publicHits = join(root, 'public-hits');
const privateRef = join(root, 'private-listener.mjs');
const privateHits = join(root, 'private-hits');

async function startListener(ref) {
  writeFileSync(
    ref,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const [counter, body, redirectTo] = process.argv.slice(2);
const server = createServer((req, res) => {
  appendFileSync(counter, req.url + '\\n');
  if (redirectTo && redirectTo !== '-') {
    res.writeHead(302, { location: redirectTo });
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(body);
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
`
  );
}

const boot = (args) => {
  const proc = spawn(process.execPath, args);
  proc.stderr.on('data', (c) => console.error('CHILD STDERR', String(c)));
  proc.on('exit', (c, s) => console.error('CHILD EXIT', c, s));
  return proc;
};

await startListener(publicRef);
await startListener(privateRef);
const privateProc = boot([privateRef, privateHits, 'private content', '-']);
const privatePort = await new Promise((r) => privateProc.stdout.once('data', (c) => r(Number(String(c).trim()))));
console.log('privatePort', privatePort);
const publicProc = boot([publicRef, publicHits, 'public content', `http://127.0.0.1:${privatePort}/secret`]);
const publicPort = await new Promise((r) =>
  publicProc.stdout.once('data', (c) => r(Number(String(c).trim())))
);
console.log('publicPort', publicPort);
const t = Date.now();
const out = await runResearch(['web', 'read', `http://docs.example.com:${publicPort}/doc`], {
  binary: process.execPath,
  prefixArgs: [fixture, 'retrieve-target', '-'],
  resolveHost: async () => ['93.184.216.34'],
});
console.log('elapsed', Date.now() - t, 'code', out.code, 'stderr', JSON.stringify(out.stderr));
publicProc.kill();
privateProc.kill();
process.exit(0);
