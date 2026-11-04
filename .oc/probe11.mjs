import { createServer } from 'node:http';
import http from 'node:http';
const srv = createServer((req, res) => { res.writeHead(302, {location:'http://127.0.0.1:9/x'}); res.end(); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const base = { method:'GET', agent:new http.Agent({keepAlive:false}) };
const cases = {
  'headers+lookup': { ...base, headers:{connection:'close'}, lookup:(_h,_o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]) },
  'headers only': { ...base, headers:{connection:'close'} },
  'lookup only': { ...base, lookup:(_h,_o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]) },
};
for (const [name, opts] of Object.entries(cases)) {
  await new Promise((done) => {
    const t=Date.now();
    const req = http.request(new URL(`http://docs.example.com:${port}/doc`), opts, (res) => { console.log(name,'OK',res.statusCode,'ms',Date.now()-t); res.resume(); res.on('end',done); });
    req.on('error', (e) => { console.log(name,'ERR',e.message); done(); });
    req.setTimeout(3000, () => { console.log(name,'TIMEOUT'); req.destroy(); done(); });
    req.end();
  });
}
srv.close(); process.exit(0);
