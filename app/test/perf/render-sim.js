// Like Render: small memory, empty disk at every start, data kept in (a fake) GitHub. node e2e.js <app> <mockA> <mockB>
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn } = require('child_process');
// node render-sim.js <app folder> <site A url> <site B url>   (HEAP=280 TRACE=1 for the memory of each step)
// Like Render's free plan: 512 MB, an EMPTY disk at every start, data kept in a fake GitHub; real or mock shops.
const [app, mA, mB] = process.argv.slice(2);
const gh = { file: null, commits: 0, blobs: new Map(), trees: new Map(), cm: new Map() };
const ghSrv = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
  const j = ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}; const out = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o || {})); }; const id = () => crypto.randomBytes(20).toString('hex');
  if (req.method === 'GET' && /contents/.test(req.url)) { if (!gh.file) return out(404); res.writeHead(200); return res.end(gh.file); }
  if (req.method === 'PUT') { gh.file = Buffer.from(j.content, 'base64'); gh.commits = 1; return out(201, {}); }
  if (/git\/blobs$/.test(req.url)) { if (!gh.commits) return out(409, {}); const k = id(); gh.blobs.set(k, Buffer.from(j.content, 'base64')); return out(201, { sha: k }); }
  if (/git\/trees$/.test(req.url)) { const k = id(); gh.trees.set(k, j.tree[0].sha); return out(201, { sha: k }); }
  if (/git\/commits$/.test(req.url)) { const k = id(); gh.cm.set(k, j.tree); return out(201, { sha: k }); }
  if (req.method === 'PATCH') { gh.file = gh.blobs.get(gh.trees.get(gh.cm.get(j.sha))); gh.commits++; return out(200, {}); }
  out(404); }); });
const port = 17900 + Math.floor(Math.random() * 50);
function start(dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir, { recursive: true });
  const c = spawn(process.execPath, ['--max-old-space-size=' + (process.env.HEAP || 360), path.join(app, 'server.js')], { env: Object.assign({}, process.env, { SFK_MODE: 'server', RENDER: 'true', PORT: String(port), RENDER_EXTERNAL_HOSTNAME: 'sf-kentro.onrender.com', SFK_SMALL: '1', SFK_DATA: dataDir, APPDATA: dataDir + '/cfg', SFK_NO_AUTOSYNC: '1', SFK_ADMIN_USER: 'alex', SFK_ADMIN_PASSWORD: 'Kentro-Test-12345', SFK_SECRET_KEY: 'k'.repeat(40), NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: '/root/.ccr/ca-bundle.crt', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', SFK_GITHUB_DATA: 'alexdimaras/sf-kentro-data', SFK_GITHUB_TOKEN: 't', SFK_GITHUB_API: 'http://127.0.0.1:' + ghSrv.address().port }), stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { c, log: '', peak: 0, exit: null }; c.stdout.on('data', (b) => { st.log += b; }); c.stderr.on('data', (b) => { st.log += b; }); c.on('exit', (code, sig) => { st.exit = code + '/' + sig; });
  st.t = setInterval(() => { try { st.peak = Math.max(st.peak, Number((fs.readFileSync(`/proc/${c.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/) || [])[1]) / 1024); } catch (_) { /* gone */ } }, 100);
  return st;
}
const B = 'http://127.0.0.1:' + port;
const wait = async (st) => { for (let i = 0; i < 300 && !/Running at/.test(st.log) && !st.exit; i++) await new Promise((r) => setTimeout(r, 100)); };
const login = async () => { const l = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ user: 'alex', password: 'Kentro-Test-12345', remember: true }) }); return { Cookie: (l.headers.get('set-cookie') || '').split(';')[0], 'X-SFK': (await l.json()).csrf, 'Content-Type': 'application/json' }; };
(async () => {
  await new Promise((r) => ghSrv.listen(0, '127.0.0.1', r));
  const D1 = path.join(os.tmpdir(), 'e2e-1');
  let s1 = start(D1); await wait(s1);
  const H = await login();
  await fetch(B + '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ sites: { sf: { name: 'SpecialForces', url: mA }, st: { name: 'Στρατιωτικά Είδη', url: mB } }, syncVariations: true }) });
  let maxLag = 0; const pinger = setInterval(async () => { const t = Date.now(); try { await fetch(B + '/ping'); } catch (_) { /* down */ } maxLag = Math.max(maxLag, Date.now() - t); }, 500);
  const t0 = Date.now();
  const job = await (await fetch(B + '/api/sync', { method: 'POST', headers: H, body: '{}' })).json();
  let j = {};
  for (;;) { await new Promise((r) => setTimeout(r, 1000)); if (s1.exit) { console.log('SERVER DIED', s1.exit, s1.log.slice(-1500)); process.exit(1); } j = await fetch(B + '/api/jobs/' + job.id, { headers: H }).then((r) => r.json()).catch(() => ({})); if (j.status && j.status !== 'running') break; if (process.env.TRACE) { let r = 0; try { r = Number((fs.readFileSync(`/proc/${s1.c.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/) || [])[1]) / 1024; } catch (_) {} console.log('   ', Math.round(r) + 'MB', (j.msg || '').slice(0, 70)); } }
  clearInterval(pinger);
  console.log('1st machine: read', j.status, j.error || '', Math.round((Date.now() - t0) / 1000) + 's, crashed:', s1.exit, '| peak RSS', Math.round(s1.peak), 'MB | longest freeze', maxLag, 'ms');
  console.log('   job log:', (j.log || []).slice(-4).map((x) => x.msg || x).join(' | '));
  const p1 = await (await fetch(B + '/api/products?site=sf&per=1', { headers: H })).json();
  console.log('   products on 1st machine:', p1.total, '| saved in GitHub:', gh.file ? (gh.file.length / 1e6).toFixed(1) + ' MB, commits ' + gh.commits : 'NOTHING');
  await new Promise((r) => { s1.c.on('exit', r); s1.c.kill('SIGTERM'); }); clearInterval(s1.t);
  // Render restarts on an EMPTY disk
  const s2 = start(path.join(os.tmpdir(), 'e2e-2')); await wait(s2);
  const st2 = await fetch(B + '/api/state', { headers: H });
  const p2 = await (await fetch(B + '/api/products?site=sf&per=1', { headers: H })).json().catch(() => ({}));
  const p3 = await (await fetch(B + '/api/products?site=st&per=1', { headers: H })).json().catch(() => ({}));
  const d2 = await fetch(B + '/api/dashboard', { headers: H });
  console.log('2nd machine (empty disk): still signed in', st2.status === 200, '| products sf', p2.total, 'st', p3.total, '| dashboard', d2.status, '| peak RSS', Math.round(s2.peak), 'MB');
  console.log('   start log:', (s2.log.match(/Cloud data[^\n]*/) || [''])[0]);
  s2.c.kill('SIGTERM'); clearInterval(s2.t); ghSrv.close(); setTimeout(() => process.exit(0), 1500);
})();
