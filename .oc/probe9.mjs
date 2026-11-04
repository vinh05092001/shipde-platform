import { createServer } from 'node:http';
import http from 'node:http';
const srv = createServer((req, res) => { res.writeHead(302, {location:'http://127.0.0.1:9/x'}); res.end(); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const u = new URL(`http://docs.example.com:${port}/doc`);
for (const withLookup of [true, false]) {
  await new Promise((done) => {
    const opts = { method:'GET', agent: new http.Agent({keepAlive:false}), headers:{connection:'close'} };
    if (withLookup) opts.lookup = (_h, o, cb) => cb(null, '127.0.0.1', 4);
    else opts.lookup = undefined;
    const t=Date.now();
    const req = http.request(u, opts, (res) => { console.log('lookup',withLookup,'status',res.statusCode,'ms',Date.now()-t); res.resume(); res.on('end',done); });
    req.on('error', (e) => { console.log('lookup',withLookup,'ERR',e.message,'ms',Date.now()-t); done(); });
    req.setTimeout(3000, () => { console.log('lookup',withLookup,'TIMEOUT'); req.destroy(); done(); });
    req.end();
  });
}
srv.close(); process.exit(0);
