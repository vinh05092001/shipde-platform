import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'probe5-'));
const ref = join(root, 'l.mjs');
writeFileSync(ref, `#!/usr/bin/env node
import { createServer } from 'node:http';
console.log('LISTENER BOOT');
const server = createServer((req, res) => { res.end('x'); });
server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({port: server.address().port})+'\n'));
`);
const pub = spawn(process.execPath, [ref]);
let buf = '';
pub.stdout.on('data', c => { buf += c; });
pub.stderr.on('data', c => { console.error('STDERR', String(c)); });
pub.on('exit', (code, sig) => console.error('EXIT', code, sig));
setTimeout(() => { console.log('BUF=', JSON.stringify(buf)); pub.kill(); process.exit(0); }, 2500);
