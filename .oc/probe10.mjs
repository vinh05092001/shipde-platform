import { createServer } from 'node:http';
import http from 'node:http';
const srv = createServer((req, res) => { res.writeHead(302, {location:'http://127.0.0.1:9/x'}); res.end(); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const variants = {
  'cb(addr,family)': (_h,o,cb)=>cb(null,'127.0.0.1',4),
  'cb(addr)': (_h,o,cb)=>cb(null,'127.0.0.1'),
  'lines array?': (_h,o,cb)=>cb(null,'127.0.0.1',4),
  'all': (_h,o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),
  'all+opts': (_h,o,cb)=>o&&o.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4),
};
for (const [name, lookup] of Object.entries(variants)) {
  await new Promise((done) => {
    const t=Date.now();
    const req = http.request(new URL(`http://docs.example.com:${port}/doc`), { method:'GET', agent:new http.Agent({keepAlive:false}), lookup }, (res) => { console.log(name,'OK status',res.statusCode,'ms',Date.now()-t); res.resume(); res.on('end',done); });
    req.on('error', (e) => { console.log(name,'ERR',e.message); done(); });
    req.setTimeout(3000, () => { console.log(name,'TIMEOUT'); req.destroy(); done(); });
    req.end();
  });
}
srv.close(); process.exit(0);
