import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResearch } from '../scripts/ai/research.mjs';
const fixture = fileURLToPath(new URL('../scripts/ai/test/fixtures/agent-reach.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'probe6-'));
const ref = join(root, 'l.mjs'); const hits=join(root,'hits');
writeFileSync(ref, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const [counter, body, redirectTo] = process.argv.slice(2);
const server = createServer((req, res) => {
  appendFileSync(counter, req.url + '\n');
  if (redirectTo && redirectTo !== '-') { res.writeHead(302, { location: redirectTo }); res.end(); return; }
  res.writeHead(200, {'content-type':'text/plain'}); res.end(body);
});
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)+'\n'));
`);
const pub = spawn(process.execPath, [ref, hits, 'public content', 'http://127.0.0.1:9/secret']);
const port = await new Promise(r => pub.stdout.once('data', c => r(Number(String(c).trim()))));
console.log('port', port);
const t=Date.now();
const out = await runResearch(['web','read',`http://docs.example.com:${port}/doc`], { binary: process.execPath, prefixArgs:[fixture,'retrieve-target','-'], resolveHost: async()=>['93.184.216.34'] });
console.log('elapsed', Date.now()-t, 'code', out.code, 'stderr', out.stderr);
console.log('hits', existsSync(hits)? readFileSync(hits,'utf8'): '(none)');
pub.kill();
process.exit(0);
