// How long does every screen's data take, inside the Render box (0.1 CPU, 512 MB)?
//   node routes.js <data folder> [KEY=value …]      BOX=0 for no limits
// Starts the program on the data, waits until it is ready, then calls every screen's requests three times and
// tries one approval. Prints wall time (what the phone feels), server CPU (from the Server-Timing header) and size.
const { spawn } = require('child_process');
const path = require('path');
const app = path.join(__dirname, '..', '..');
const [data, ...kv] = process.argv.slice(2);
const port = 17400 + Math.floor(Math.random() * 200);
const env = Object.assign({}, process.env, {
  SFK_MODE: 'server', RENDER: 'true', PORT: String(port), RENDER_EXTERNAL_HOSTNAME: 'sf-kentro.onrender.com', SFK_KEEP_AWAKE: '0', SFK_NO_AUTOSYNC: '1',
  SFK_DATA: data, APPDATA: path.join(data, 'cfg'), SFK_ADMIN_USER: 'alex', SFK_ADMIN_PASSWORD: 'Kentro-Test-12345', SFK_SECRET_KEY: 'k'.repeat(40),
  NODE_OPTIONS: '--max-old-space-size=280',
}, Object.fromEntries(kv.map((x) => x.split(/=(.*)/s).slice(0, 2))));
const boxed = process.env.BOX !== '0';
const srv = boxed ? spawn('bash', [path.join(__dirname, 'box.sh'), process.execPath, path.join(app, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(process.execPath, [path.join(app, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (b) => { log += b; }); srv.stderr.on('data', (b) => { log += b; });
const B = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
(async () => {
  // ready = answers a ping fast, three times in a row, and the first screen's data comes back
  let firstPing = 0, okRun = 0;
  for (;;) {
    const t = Date.now();
    try { await (await fetch(B + '/ping', { signal: AbortSignal.timeout(20000) })).text(); if (!firstPing) firstPing = Date.now() - t0; okRun = Date.now() - t < 300 ? okRun + 1 : 0; } catch (_) { okRun = 0; }
    if (okRun >= 3 && (/Ready/.test(log) || Date.now() - t0 > 240000)) break;
    if (srv.exitCode != null) { console.log('server exited', log.slice(-800)); process.exit(1); }
    await sleep(500);
  }
  console.log(`cold start: first ping after ${(firstPing / 1000).toFixed(1)} s, calm after ${((Date.now() - t0) / 1000).toFixed(1)} s`, (log.match(/Ready[^\n]*/) || [''])[0]);
  const l = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'alex', password: 'Kentro-Test-12345', remember: true }) });
  const H = { Cookie: (l.headers.get('set-cookie') || '').split(';')[0], 'X-SFK': (await l.json()).csrf, 'Content-Type': 'application/json' };
  const call = async (method, p, body) => {
    const t = Date.now();
    const r = await fetch(B + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const cpu = ((r.headers.get('server-timing') || '').match(/cpu;dur=([\d.]+)/) || [])[1];
    let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch (_) { /* file */ }
    return { ms: Date.now() - t, status: r.status, size: buf.length, cpu: cpu ? Number(cpu) : null, json };
  };
  const rows = [];
  const bench = async (label, method, p, body) => {
    const ms = [], cpu = []; let last;
    for (let i = 0; i < 3; i++) { last = await call(method, p, body); ms.push(last.ms); if (last.cpu != null) cpu.push(last.cpu); await sleep(150); }
    rows.push({ label, first: ms[0], best: Math.min(...ms), cpu: cpu.length ? Math.min(...cpu) : null, size: last.size, status: last.status });
    console.log(`${String(last.status).padEnd(4)}${label.padEnd(34)} first ${String(ms[0]).padStart(6)} ms   then ${String(Math.min(...ms.slice(1))).padStart(6)} ms   ${cpu.length ? 'cpu ' + String(Math.round(Math.min(...cpu))).padStart(4) + ' ms' : ''}   ${(last.size / 1024).toFixed(0)} KB`);
    return last;
  };
  await bench('state (κάθε άνοιγμα)', 'GET', '/api/state');
  await bench('dashboard (Σήμερα + αριθμοί)', 'GET', '/api/dashboard');
  await bench('flow (Ροή)', 'GET', '/api/flow');
  await bench('flow βήμα 3', 'GET', '/api/flow?stage=3');
  const fx = await bench('fixes (Διορθώσεις)', 'GET', '/api/fixes');
  await bench('fixes φίλτρο περιεχόμενο', 'GET', '/api/fixes?group=content&site=sf');
  await bench('checks (Έλεγχοι)', 'GET', '/api/checks?limit=1');
  await bench('check λίστα', 'GET', '/api/check?id=sf-nodesc');
  const pr = await bench('products (Προϊόντα)', 'GET', '/api/products?site=sf');
  await bench('products αναζήτηση', 'GET', '/api/products?site=sf&q=pentagon');
  const pid = pr.json && pr.json.rows && pr.json.rows[0] ? pr.json.rows[0].id : 0;
  if (pid) await bench('product (ένα προϊόν)', 'GET', '/api/product?site=sf&id=' + pid);
  await bench('market (Τιμές)', 'GET', '/api/market?site=sf&per=100');
  await bench('suppliers', 'GET', '/api/suppliers');
  await bench('jobs', 'GET', '/api/jobs');
  // one approval and what the screen asks right after it
  const card = fx.json && (fx.json.cards || [])[0];
  const item = card && card.changes && card.changes[0];
  if (item) {
    const a = await call('POST', '/api/fixes/decide', { ids: [item.id], status: 'approved' });
    const b = await call('GET', '/api/fixes');
    const c = await call('GET', '/api/dashboard');
    const d = await call('GET', '/api/flow');
    console.log(`έγκριση μίας διόρθωσης: ${a.ms} ms (${a.status}) → fixes ${b.ms} ms, dashboard ${c.ms} ms, flow ${d.ms} ms   = ${a.ms + b.ms + c.ms} ms μέχρι να ενημερωθεί η οθόνη`);
    await call('POST', '/api/fixes/decide', { ids: [item.id], status: 'pending' });
  } else console.log('no fix item to approve');
  const mem = await call('GET', '/ping');
  console.log('ping:', JSON.stringify(mem.json));
  srv.kill('SIGTERM'); await sleep(1500); process.exit(0);
})().catch((e) => { console.error(e); console.log(log.slice(-1500)); srv.kill(); process.exit(1); });
