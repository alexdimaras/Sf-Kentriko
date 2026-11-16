'use strict';
// SF Κέντρο — tests of the jobs and of the reading of the two shops (npm test runs them after the others).
// Two little "shops" on 127.0.0.1 that can be told to answer slowly or to break, and the program in server mode.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-jobs-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A WooCommerce Store API with n products. shop.mode: 'ok' | 'break' (a broken answer on page 2) | 'slow' (3 s a page). */
function shop(n, tag) {
  const state = { mode: 'ok', hits: 0 };
  const prod = (i) => ({ id: i, name: `ΦΑΚΟΣ ${tag} MODEL ${i}`, slug: 'p' + i, parent: 0, type: 'simple', variation: '', permalink: `https://${tag}.example/p/${i}`, sku: tag + i, short_description: '', description: '<p>Περιγραφή.</p>', on_sale: false, prices: { price: '1990', regular_price: '1990', currency_minor_unit: 2 }, images: [{ src: `https://${tag}.example/${i}.jpg` }], categories: [{ id: 5, name: 'ΦΑΚΟΙ' }], tags: [], brands: [{ name: 'NITECORE' }], attributes: [], variations: [], is_in_stock: true, is_purchasable: true });
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    state.hits++;
    if (!u.pathname.startsWith('/wp-json/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html></html>'); }
    const per = Number(u.searchParams.get('per_page') || 100), page = Number(u.searchParams.get('page') || 1);
    let list = [];
    if (u.pathname.endsWith('/products/categories')) list = [{ id: 5, name: 'ΦΑΚΟΙ', slug: 'fakoi', parent: 0, count: n, permalink: '' }];
    else if (u.searchParams.get('type') === 'variation') list = [];
    else for (let i = 1; i <= n; i++) list.push(prod(i));
    const isProducts = u.pathname.endsWith('/products') && u.searchParams.get('type') !== 'variation';
    if (isProducts && state.mode === 'slow') await sleep(3000);
    if (isProducts && state.mode === 'break' && page === 2) { res.writeHead(200, { 'Content-Type': 'application/json', 'X-WP-Total': String(list.length), 'X-WP-TotalPages': String(Math.ceil(list.length / per)) }); return res.end('{"code":"internal_error","message":"database gone"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-WP-Total': String(list.length), 'X-WP-TotalPages': String(Math.max(1, Math.ceil(list.length / per))) });
    res.end(JSON.stringify(list.slice((page - 1) * per, page * per)));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, state, url: 'http://127.0.0.1:' + srv.address().port })));
}

(async () => {
  section('Εργασίες: σειρά, προτεραιότητα, άμεση διακοπή');
  const jobs = require(APP + '/lib/jobs');
  jobs.setHeavyLimit(1);
  const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
  const g1 = gate(), order = [];
  const a = jobs.start('heavy-a', 'Πρώτη βαριά', async () => { order.push('a'); await g1.p; }, { heavy: true });
  const auto = jobs.start('heavy-auto', 'Αυτόματη', async () => { order.push('auto'); }, { heavy: true, auto: true });
  const mine = jobs.start('heavy-mine', 'Του χρήστη', async () => { order.push('mine'); }, { heavy: true });
  const light = jobs.start('light', 'Ελαφριά', async () => { order.push('light'); });
  await sleep(30);
  ok(a.status === 'running' && jobs.get(auto.id).status === 'queued' && jobs.get(mine.id).status === 'queued', 'a second heavy job waits in line while the first one runs');
  ok(/Στη σειρά/.test(jobs.get(mine.id).msg) && /Πρώτη βαριά/.test(jobs.get(mine.id).msg), 'the waiting job says what it waits for', jobs.get(mine.id).msg);
  ok(order.includes('light') && jobs.get(light.id).status === 'done', 'a light job (one supplier, one brand) starts at once, also while a heavy one runs');
  ok(jobs.start('heavy-a', 'Πάλι', async () => {}).id === a.id, 'a second request for the same kind gets the job that is already running');
  g1.open(); await sleep(60);
  ok(order.join(',') === 'a,light,mine,auto', 'what a person asked for goes before what the program started by itself', order.join(','));
  // stopping
  let sawAbort = false;
  const g2 = gate();
  const slow = jobs.start('heavy-slow', 'Αργή', async (job) => { job.signal.addEventListener('abort', () => { sawAbort = true; g2.open(); }); await g2.p; return 'x'; }, { heavy: true });
  const waiting = jobs.start('heavy-wait', 'Σε αναμονή', async () => { order.push('never'); }, { heavy: true });
  await sleep(20);
  const t0 = Date.now();
  const w = jobs.cancel(waiting.id);
  ok(w.status === 'cancelled' && !order.includes('never'), 'a job waiting in line is simply taken out');
  const c = jobs.cancel(slow.id);
  ok(c.cancelling === true && /Σταματάει/.test(c.msg) && Date.now() - t0 < 50, 'stopping answers at once: the job says «Σταματάει…» before its work has ended', JSON.stringify({ c: c.cancelling, msg: c.msg }));
  await sleep(40);
  ok(sawAbort && jobs.get(slow.id).status === 'cancelled', 'its open requests are cut and it ends as «cancelled», not as an error', jobs.get(slow.id).status);

  // an http request is cut by the stop (no waiting for a slow shop)
  const hang = http.createServer(() => { /* never answers */ });
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const H = require(APP + '/lib/http');
  const ctl = new AbortController();
  const t1 = Date.now();
  setTimeout(() => ctl.abort(), 150);
  let err = null;
  try { await H.get('http://127.0.0.1:' + hang.address().port + '/x', { timeout: 20000, retries: 2, signal: ctl.signal }); } catch (e) { err = e; }
  ok(err && err.cancelled && Date.now() - t1 < 1000, 'a request to a shop that does not answer is cut at once (not after its 20 s limit and 2 more tries)', `${Date.now() - t1} ms`);
  hang.close(); if (hang.closeAllConnections) hang.closeAllConnections();

  section('Ανάγνωση των δύο sites: το καθένα ξεχωριστά');
  const sf = await shop(250, 'sf'), st = await shop(180, 'st');
  fs.writeFileSync(path.join(process.env.SFK_DATA, 'settings.json'), JSON.stringify({ firstRunDone: true, sites: { sf: { name: 'SpecialForces', url: sf.url }, st: { name: 'Στρατιωτικά Είδη', url: st.url } } }));
  const port = 19000 + Math.floor(Math.random() * 900);
  const env = Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), SFK_NO_AUTOSYNC: '1', SFK_ADMIN_USER: 'admin', SFK_ADMIN_PASSWORD: 'Test-pass-123456', SFK_SMALL: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' });
  let child, log = '';
  const startServer = async () => {
    log = '';
    child = spawn(process.execPath, [path.join(APP, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
    for (let i = 0; i < 80 && !/Ready:/.test(log); i++) await sleep(100);
  };
  await startServer();
  const base = `http://127.0.0.1:${port}`;
  let HD = null;
  const login = async () => { const li = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: 'Test-pass-123456' }) }); HD = { Cookie: (li.headers.get('set-cookie') || '').split(';')[0], 'X-SFK': (await li.json()).csrf, 'Content-Type': 'application/json' }; };
  const get = async (p) => (await fetch(base + p, { headers: HD })).json();
  const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: HD, body: JSON.stringify(b || {}) })).json();
  const until = async (fn, ms) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(150); } };
  const jobEnd = (id, ms) => until(async () => { const j = await get('/api/jobs/' + id); return j.status !== 'running' && j.status !== 'queued' ? j : null; }, ms || 60000);
  try {
    await login();
    let s = (await get('/api/state')).summary;
    ok(s.sf.read === null && s.st.read === null && !s.sf.syncedAt, 'before any reading: both sites say "not read yet"');
    // 1. both fine
    let job = await post('/api/sync', { full: true });
    let end = await jobEnd(job.id);
    s = (await get('/api/state')).summary;
    ok(end && end.status === 'done' && s.sf.read.state === 'ok' && s.st.read.state === 'ok', 'both sites read: each has its own record «ολοκληρώθηκε»', end && end.status + ' ' + JSON.stringify(end.error));
    ok(s.sf.read.products === 250 && s.sf.read.expected === 250 && s.st.read.products === 180 && s.sf.products === 250 && s.st.products === 180, 'each with its own number of products (and how many the site says it has)', JSON.stringify([s.sf.read.products, s.sf.read.expected, s.st.read.products]));
    ok(s.sf.read.mode === 'full' && !!s.sf.read.endedAt && !!s.sf.read.lastOkAt && s.sf.read.seconds >= 0, 'with when it ended, what kind of reading it was and how long it took');
    const okAt = s.st.syncedAt;
    // 2. the second shop breaks in the middle
    st.state.mode = 'break';
    job = await post('/api/sync', { full: true });
    end = await jobEnd(job.id);
    s = (await get('/api/state')).summary;
    ok(s.sf.read.state === 'ok' && s.st.read.state === 'failed', 'one site fails, the other does not: SpecialForces «ολοκληρώθηκε», Στρατιωτικά Είδη «απέτυχε»', JSON.stringify([s.sf.read.state, s.st.read.state]));
    ok(/σελίδα 2/.test(s.st.read.error) && /μισός κατάλογος/.test(s.st.read.error), 'the failure says what happened, in plain words', s.st.read.error);
    ok(s.st.products === 180 && s.st.syncedAt === okAt && s.st.read.lastOkProducts === 180, 'a broken reading is never kept as a whole one: the last good data (180 products) stays', JSON.stringify([s.st.products, s.st.read.lastOkProducts]));
    ok(end && end.status === 'done' && end.result.st.error && !end.result.sf.error, 'the job itself ends normally and reports the failed site', end && end.status);
    // 3. stopping a reading
    st.state.mode = 'ok'; sf.state.mode = 'slow';
    job = await post('/api/sync', { full: true });
    await until(async () => (await get('/api/state')).summary.sf.read.state === 'running', 5000);
    s = (await get('/api/state')).summary;
    ok(s.sf.read.state === 'running', 'while a site is being read its record says «διαβάζεται τώρα»');
    const t2 = Date.now();
    const c2 = await post('/api/jobs/cancel', { id: job.id });
    const answered = Date.now() - t2;
    end = await jobEnd(job.id, 5000);
    const total = Date.now() - t2;
    ok(c2.cancelling === true && answered < 500, 'stop: the answer comes at once (the screen shows «σταματάει…»)', answered + ' ms');
    ok(end && end.status === 'cancelled' && total < 2000, 'and the reading really ends in under 2 s, although the shop needs 3 s a page', `${total} ms, ${end && end.status}`);
    s = (await get('/api/state')).summary;
    ok(s.sf.read.state === 'cancelled' && s.sf.products === 250 && s.st.read.state !== 'running', 'the stopped site says «σταμάτησε» and keeps its last good data; nothing is left "running"', JSON.stringify([s.sf.read.state, s.st.read.state]));
    // 4. the program stops in the middle of a reading
    job = await post('/api/sync', { sites: ['sf'], full: true });
    await until(async () => (await get('/api/state')).summary.sf.read.state === 'running', 5000);
    child.kill('SIGKILL'); await sleep(300);
    sf.state.mode = 'ok';
    await startServer(); await login();
    s = (await get('/api/state')).summary;
    ok(s.sf.read.state === 'failed' && /Διακόπηκε/.test(s.sf.read.error) && s.sf.products === 250, 'the program was stopped during a reading: after the restart the site says so (not "running" for ever)', JSON.stringify(s.sf.read));
    // 5. and reads fine again, one site only
    job = await post('/api/sync', { sites: ['sf'] });
    end = await jobEnd(job.id);
    s = (await get('/api/state')).summary;
    ok(end && end.status === 'done' && s.sf.read.state === 'ok' && s.sf.read.products === 250, 'reading one site again puts it right');
  } finally {
    try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
    sf.srv.close(); st.srv.close();
    if (sf.srv.closeAllConnections) { sf.srv.closeAllConnections(); st.srv.closeAllConnections(); }
  }

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
