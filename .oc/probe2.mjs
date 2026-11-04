import { createServer } from 'node:http';
import http from 'node:http';
const srv = createServer((req, res) => { console.log('HIT', req.url); res.writeHead(302, {location:'http://127.0.0.1:9/secret'}); res.end(); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
// mimic requestOnce: pinned lookup
const req = http.request(new URL(`http://docs.example.com:${port}/doc`), {
  method:'GET',
  agent: new http.Agent({keepAlive:false}),
  headers:{connection:'close'},
  lookup: (_h, opts, cb) => opts && opts.all ? cb(null, [{address:'127.0.0.1', family:4}]) : cb(null,'127.0.0.1',4),
}, (res) => { console.log('status', res.statusCode, res.headers.location); res.resume(); res.on('end', ()=> { srv.close(); process.exit(0); }); });
req.on('error', e => { console.log('ERR', e.message); srv.close(); process.exit(1); });
req.end();
setTimeout(()=>{ console.log('TIMEOUT probe'); process.exit(2); }, 5000);
