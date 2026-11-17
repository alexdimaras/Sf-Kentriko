// A day of the program inside the Render box: how fast does it answer, how much memory, what is it doing?
//   node watch.js <data folder> <seconds> [KEY=value …]      (root: uses box.sh; BOX=0 runs without limits)
// Prints one line every few seconds: time, ping answer time (ms, or TIMEOUT), memory (MB), the running job.
// At the end: the longest time without an answer, peak memory, restarts.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = path.join(__dirname, '..', '..');
const [data, secs, ...kv] = process.argv.slice(2);
const port = 17700 + Math.floor(Math.random() * 200);
const extra = Object.fromEntries(kv.map((x) => x.split(/=(.*)/s).slice(0, 2)));
const env = Object.assign({}, process.env, {
  SFK_MODE: 'server', RENDER: 'true', PORT: String(port), RENDER_EXTERNAL_HOSTNAME: 'sf-kentro.onrender.com', SFK_KEEP_AWAKE: '0',
  SFK_DATA: data, APPDATA: path.join(data, 'cfg'), SFK_ADMIN_USER: 'alex', SFK_ADMIN_PASSWORD: 'Kentro-Test-12345', SFK_SECRET_KEY: 'k'.repeat(40),
  NODE_OPTIONS: '--max-old-space-size=280', NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: '/root/.ccr/ca-bundle.crt', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}, extra);
const boxed = process.env.BOX !== '0';
const cmd = boxed ? ['bash', [path.join(__dirname, 'box.sh'), process.execPath, path.join(app, 'server.js')]] : [process.execPath, [path.join(app, 'server.js')]];
let srv, starts = 0, log = '', peak = 0, worst = 0, timeouts = 0, lastLine = 0;
const t0 = Date.now();
const at = () => String(Math.round((Date.now() - t0) / 1000)).padStart(4) + 's';
let startedAt = 0;
function start() {
  starts++; startedAt = Date.now();
  srv = spawn(cmd[0], cmd[1], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const on = (b) => { log += b; for (const l of String(b).split('\n')) if (l.trim() && !/^\s+at |^\s*$|node:internal|\[UNDICI|trace-warnings/.test(l)) console.log(at(), ' LOG', l.slice(0, 150)); };
  srv.stdout.on('data', on); srv.stderr.on('data', on);
  srv.on('exit', (code, sig) => { console.log(at(), ` EXIT code=${code} signal=${sig}` + (sig === 'SIGKILL' ? '  ← killed (out of memory in the box)' : '')); if (Date.now() - t0 < secs * 1000 - 5000) setTimeout(start, 2000); });
}
const rss = () => { try { const pid = fs.readFileSync(`/proc/${srv.pid}/task/${srv.pid}/children`, 'utf8').trim().split(' ')[0] || srv.pid; return Math.round(Number((fs.readFileSync(`/proc/${boxed ? srv.pid : pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/) || [])[1]) / 1024); } catch (_) { return 0; } };
let H = null, busy = false, heap = 0, peakHeap = 0, ext = 0;
async function tick() {
  if (busy) return; busy = true;
  const t = Date.now();
  let ms = -1, job = '';
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(30000) });
    try { const pj = JSON.parse(await r.text()); heap = pj.heap || 0; ext = pj.ext || 0; } catch (_) { heap = 0; } ms = Date.now() - t; peakHeap = Math.max(peakHeap, heap);
  } catch (e) { if (srv && srv.exitCode == null && Date.now() - startedAt > 5000) timeouts++; else ms = -2; }
  if (ms >= 0) {
    worst = Math.max(worst, ms);
    try {
      if (!H) { const l = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'alex', password: 'Kentro-Test-12345', remember: true }), signal: AbortSignal.timeout(30000) }); H = { Cookie: (l.headers.get('set-cookie') || '').split(';')[0], 'X-SFK': (await l.json()).csrf }; }
      const j = await (await fetch(`http://127.0.0.1:${port}/api/jobs`, { headers: H, signal: AbortSignal.timeout(30000) })).json();
      if (!Array.isArray(j)) H = null; // signed in before the data was back: sign in again
      const run = (Array.isArray(j) ? j : []).filter((x) => x.status === 'running').map((x) => `${x.type}: ${(x.msg || '').slice(0, 60)}`);
      job = run.join(' | ');
    } catch (_) { H = null; }
  } else if (ms === -1) worst = Math.max(worst, 30000);
  const m = rss(); peak = Math.max(peak, m);
  if (Date.now() - lastLine > 9000 || ms < 0 || ms > 2000) { lastLine = Date.now(); console.log(at(), ms === -2 ? 'starting…       ' : ms < 0 ? 'ping NO ANSWER  ' : `ping ${String(ms).padStart(5)}ms`, `${m}MB heap ${heap}MB ext ${ext}MB`, job); }
  busy = false;
}
start();
const iv = setInterval(tick, 2000);
setTimeout(() => {
  clearInterval(iv);
  console.log(`\nSUMMARY: ${secs}s, starts ${starts}, ping timeouts ${timeouts}, slowest answer ${worst}ms, peak memory ${peak}MB, peak heap ${peakHeap}MB`);
  try { srv.kill('SIGTERM'); } catch (_) { /* gone */ }
  setTimeout(() => process.exit(0), 3000);
}, secs * 1000);
