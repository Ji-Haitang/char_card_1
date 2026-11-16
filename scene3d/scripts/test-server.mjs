import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execGit=promisify(execFile);

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.woff2':'font/woff2', '.ttf':'font/ttf', '.glb':'model/gltf-binary', '.wasm':'application/wasm' };
const STATIC_DIRS = new Set(['module','ui','img','bgm','music','assets']);
export function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function validateResponse(fixture) {
  if (!Number.isInteger(fixture.status) || fixture.status < 100 || fixture.status > 599) throw Error('Invalid HTTP status');
  if (!fixture.headers || !Array.isArray(fixture.steps) || !['end','disconnect','await-abort'].includes(fixture.terminal)) throw Error('Invalid response fixture');
  for (const step of fixture.steps) if (typeof step.body !== 'string' || (step.waitFor !== undefined && typeof step.waitFor !== 'string')) throw Error('Invalid response step');
}

/** Only this run owns this listener; no static write operation or external proxy exists. */
export async function startTestServer({ gameRoot, basePath='/', assetRoot=process.env.JXZ_TEST_ASSET_ROOT, assetRevision=process.env.JXZ_TEST_ASSET_REV }) {
  if(typeof basePath!=='string'||!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath))throw Error('Invalid local static basePath');
  const root = await realpath(gameRoot);
  const sharedAssets=assetRoot?await realpath(assetRoot):root;
  const sharedDirectories=new Set(['assets','img','bgm','music']);
  if(assetRevision&&!/^[a-f0-9]{7,40}$/i.test(assetRevision))throw Error('Shared asset revision must be a pinned commit');
  const canonicalAssets=new Map();
  const token = randomBytes(24).toString('hex');
  const events = [], requests = [], pending = new Map(), gates = new Map(), sockets = new Set(), assetRules = new Map();
  const bus = new EventEmitter();
  const emit = event => { const value = { ...event, at: Date.now() }; events.push(value); bus.emit('event', value); };
  let origin;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.socket.remoteAddress !== '127.0.0.1') { res.writeHead(403).end(); return; }
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      const raw = (req.url || '/').split('?')[0];
      const decoded = decodeURIComponent(raw);
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(x => x === '..' || x === '.')) { res.writeHead(403).end(); return; }
      if (decoded.startsWith('/__control/')) {
        if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
        const key = decoded.slice('/__control/'.length);
        const release = gates.get(key);
        if (!release) { res.writeHead(409).end('No such waiting checkpoint'); return; }
        gates.delete(key); release(); emit({type:'release', key}); res.writeHead(204).end(); return;
      }
      if (decoded.startsWith('/__mock/')) {
        const channel = decoded.split('/')[2];
        const fixture = pending.get(channel)?.shift();
        if (req.method !== 'POST' || decoded !== `/__mock/${channel}/chat/completions` || !fixture) {
          emit({type:'unmatched-api', channel, path:decoded}); res.writeHead(503).end('Unmatched fixture API'); return;
        }
        const chunks=[];let bodyBytes=0;
        for await (const piece of req) {
          bodyBytes+=piece.length;if(bodyBytes>4_000_000)throw Error('Request too large');
          chunks.push(piece);emit({type:'api-body-chunk',channel,bytes:piece.length,totalBytes:bodyBytes});
        }
        // Buffer boundaries are not UTF-8 character boundaries. Decode exactly once;
        // per-chunk coercion can corrupt a Chinese prompt even though the host sent it intact.
        const rawBody=Buffer.concat(chunks),body=rawBody.toString('utf8');
        const index = requests.length;
        requests.push({ channel, index, method:req.method, path:decoded, bodyBytes,bodySha256:createHash('sha256').update(rawBody).digest('hex'),body:JSON.parse(body) }); // deliberately no headers/keys
        let completed = false, closed = false;
        const waitingKeys = new Set();
        res.on('close', () => { closed = true; for (const key of waitingKeys) { gates.get(key)?.(); gates.delete(key); } emit({type:completed ? 'closed' : 'abort', channel,index}); });
        res.writeHead(fixture.status, { 'Cache-Control':'no-store', ...fixture.headers }); res.flushHeaders();
        emit({type:'request', channel,index});
        for (let stepIndex = 0; stepIndex < fixture.steps.length; stepIndex++) {
          const step = fixture.steps[stepIndex];
          if (step.waitFor) {
            const key = `${channel}:${step.waitFor}`;
            await new Promise(resolve => { gates.set(key, resolve); waitingKeys.add(key); emit({type:'waiting',channel,index,key}); });
            waitingKeys.delete(key);
          }
          if (closed) return;
          if (!res.write(step.body)) await Promise.race([once(res,'drain'), once(res,'close')]);
          emit({type:'write',channel,index,step:stepIndex,bytes:Buffer.byteLength(step.body)});
        }
        if (fixture.terminal === 'end') { completed = true; res.end(); emit({type:'end',channel,index}); }
        else if (fixture.terminal === 'disconnect') { emit({type:'disconnect',channel,index}); res.destroy(); }
        else emit({type:'await-abort',channel,index});
        return;
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      if(basePath!=='/'&&!decoded.startsWith(basePath)){res.writeHead(403).end('Outside test deployment prefix');return;}
      const staticPath=basePath==='/'?decoded:'/'+decoded.slice(basePath.length);
      const relative = staticPath === '/' ? 'index.html' : staticPath.replace(/^\//,'');
      const segments = relative.split('/');
      if (segments.some(x => x.startsWith('.')) || (segments.length === 1 ? path.extname(relative) !== '.html' && relative !== 'favicon.ico' && relative !== 'secondary-pages-responsive.css' : !STATIC_DIRS.has(segments[0]))) { res.writeHead(403).end(); return; }
      const target = path.resolve(root, relative);
      if (!isWithin(root,target)) { res.writeHead(403).end(); return; }
      const rule=assetRules.get(relative);
      if(rule) {
        emit({type:'asset-request',channel:rule.channel,path:relative});
        res.once('close',()=>emit({type:res.writableEnded?'asset-end':'asset-abort',channel:rule.channel,path:relative}));
        if(rule.waitFor) {
          const key=`${rule.channel}:${rule.waitFor}`;
          await new Promise(resolve=>{
            const prior=gates.get(key);gates.set(key,()=>{prior?.();resolve();});
            res.once('close',resolve);emit({type:'asset-waiting',channel:rule.channel,key,path:relative});
          });
          if(res.destroyed)return;
          emit({type:'asset-released',channel:rule.channel,path:relative});
        }
        if(rule.status!==undefined || rule.body!==undefined) {
          res.writeHead(rule.status??200,{'Content-Type':rule.contentType||'application/octet-stream','Cache-Control':'no-store'}).end(rule.body??'');return;
        }
      }
      let actual, info, sourceRoot=root;
      try { actual = await realpath(target); info = await stat(actual); }
      catch {
        if(sharedAssets===root||!sharedDirectories.has(segments[0])){res.writeHead(404).end();return;}
        const sharedTarget=path.resolve(sharedAssets,relative);
        if(!isWithin(sharedAssets,sharedTarget)){res.writeHead(403).end();return;}
        try{actual=await realpath(sharedTarget);info=await stat(actual);sourceRoot=sharedAssets;}
        catch{res.writeHead(404).end();return;}
        emit({type:'shared-asset',path:relative});
      }
      if(sharedAssets!==root&&sharedDirectories.has(segments[0])&&isWithin(sharedAssets,actual))sourceRoot=sharedAssets;
      if (!isWithin(sourceRoot,actual) || !info.isFile()) { res.writeHead(403).end(); return; }
      let canonical=null;
      if(assetRevision&&sourceRoot===sharedAssets&&sharedDirectories.has(segments[0])&&/\.(json|m?js|css|html|svg|txt)$/i.test(relative)){
        if(!canonicalAssets.has(relative))canonicalAssets.set(relative,execGit('git',['-C',sharedAssets,'cat-file','blob',assetRevision+':'+relative],{encoding:'buffer',maxBuffer:32*1024*1024}).then(r=>r.stdout));
        canonical=await canonicalAssets.get(relative);info={size:canonical.length};
      }
      const headers = {'Content-Type': MIME[path.extname(actual).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'};
      let start = 0, end = info.size - 1, status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if (!match || Number(match[1]) >= info.size) { res.writeHead(416).end(); return; }
        start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]),end) : end;
        if (end < start) { res.writeHead(416).end(); return; }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = Math.max(0, end-start+1); res.writeHead(status,headers);
      if (req.method === 'HEAD' || !info.size) res.end(); else if(canonical)res.end(canonical.subarray(start,end+1));else createReadStream(actual,{start,end}).on('error',() => res.destroy()).pipe(res);
    } catch (error) { emit({type:'server-error',message:error.message}); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, root, basePath, baseUrl:origin+basePath, pid:process.pid, events, requests,
    setAssetRule(relative,rule) {
      if(!relative.startsWith('assets/')||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Asset fault requires an exact safe assets path');
      if(!rule?.channel||!/^[a-zA-Z0-9_-]+$/.test(rule.channel))throw Error('Asset fault needs a unique test channel');
      if(rule.status!==undefined&&(!Number.isInteger(rule.status)||rule.status<100||rule.status>599))throw Error('Invalid asset fault status');
      assetRules.set(relative,{...rule});
    },
    clearAssetRules() {assetRules.clear();},
    enqueue(channel, fixture) { validateResponse(fixture); if (!/^[a-zA-Z0-9_-]+$/.test(channel)) throw Error('Invalid channel'); if (!pending.has(channel)) pending.set(channel,[]); pending.get(channel).push(structuredClone(fixture)); },
    async release(channel, checkpoint) { const response = await fetch(`${origin}/__control/${channel}:${checkpoint}`,{method:'POST',headers:{Authorization:`Bearer ${token}`}}); if (response.status !== 204) throw Error(`Checkpoint release failed: ${response.status}`); },
    waitFor(predicate, timeout = 15000) {
      const existing = events.find(predicate); if (existing) return Promise.resolve(existing);
      return new Promise((resolve,reject) => { const timer = setTimeout(() => { bus.off('event',listener); reject(Error('Server checkpoint timeout')); },timeout); const listener = event => { if (predicate(event)) { clearTimeout(timer); bus.off('event',listener); resolve(event); } }; bus.on('event',listener); });
    },
    async close() { for (const release of gates.values()) release(); gates.clear(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  };
}
