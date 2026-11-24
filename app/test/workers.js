'use strict';
// the little shops of the tests run on this machine: the program may open private addresses here (never in use)
process.env.SFK_ALLOW_PRIVATE = '1';
// SF Κέντρο — the computers of the shops, for real: a little competitor shop, the cloud program, and real worker
// processes (app/worker.js) that pair with a code, take the research of a competitor, and hand in the result.
// With COORD_PG=postgres://… the cloud program keeps everything in that database (as with Supabase).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-workers-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- our shop and a competitor ----------
const now = new Date().toISOString();
const W = (n, v) => fs.writeFileSync(path.join(DATA, n + '.json'), JSON.stringify(v));
const NAMES = ['ΦΑΚΟΣ NITECORE MH40 PRO', 'ΣΑΚΙΔΙΟ PENTAGON KYLER 36L', 'ΓΑΝΤΙΑ MECHANIX M-PACT COYOTE', 'ΜΑΧΑΙΡΙ MORAKNIV ELDRIS ΜΑΥΡΟ', 'ΑΡΒΥΛΑ HAIX BLACK EAGLE ATHLETIC 2.1'];
const BRANDS = ['NITECORE', 'PENTAGON', 'MECHANIX', 'MORAKNIV', 'HAIX'];
const SKUS = ['MH40PRO', 'K16110', 'MPT-72', 'MORA-12647', 'HX-330003'];
function product(i) {
  return { id: 100 + i, type: 'simple', parent: 0, name: NAMES[i], varLabel: '', slug: 'p' + i, sku: SKUS[i], url: 'https://shop.example/p/' + i, price: 50 + i * 10, regular: 50 + i * 10, sale: 0, priceMax: 0, inStock: true, purchasable: true,
    cats: [11], catNames: ['Είδη'], tags: [], brand: BRANDS[i], brandSource: 'brands', attrs: [], images: ['https://shop.example/i/' + i + '.jpg'], thumb: '', imageAlts: [], desc: '<p>Περιγραφή του προϊόντος με αρκετό κείμενο για τον έλεγχο.</p>'.repeat(5), short: '<p>σύντομη</p>', variations: [], status: 'publish' };
}
function comp(slow) {
  const state = { slow: !!slow, hits: 0 };
  const srv = http.createServer(async (req, res) => {
    state.hits++;
    if (state.slow) await sleep(1500);
    const u = new URL(req.url, 'http://x');
    const list = u.pathname.endsWith('/products') && u.searchParams.get('_fields') !== 'id'
      ? NAMES.map((n, i) => ({ id: 900 + i, name: n.replace(/^[Α-Ω]+ /, ''), sku: SKUS[i], permalink: `http://c.example/p/${i}`, prices: { price: String((45 + i * 10) * 100), regular_price: String((45 + i * 10) * 100), currency_minor_unit: 2, currency_code: 'EUR' }, is_in_stock: true, brands: [{ name: BRANDS[i] }], attributes: [], images: [], type: 'simple' }))
      : u.searchParams.get('_fields') === 'id' ? NAMES.map((_, i) => ({ id: 900 + i })) : [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-WP-Total': String(list.length), 'X-WP-TotalPages': '1' });
    res.end(JSON.stringify(list));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, state, url: 'http://127.0.0.1:' + srv.address().port })));
}

// ---------- a little «internet»: a search engine and two shops with the same glove pouch ----------
function web() {
  const page = (shop) => `<!doctype html><html><head><title>Glove pouch</title><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: shop === 1 ? '5.11 Tactical Flex Disposable Glove Pouch' : 'Θήκη γαντιών 5.11 Flex Disposable Glove Pouch Black', sku: '56423', gtin13: '4046872358951', brand: { '@type': 'Brand', name: '5.11 Tactical' }, image: ['http://' + (shop === 1 ? '127.0.0.2' : 'localhost') + ':PORT/wp-content/uploads/flex-glove-pouch-56423-600x600.jpg'], offers: { '@type': 'Offer', priceCurrency: 'EUR', price: '27.90', availability: 'https://schema.org/InStock' } })}</script></head><body>${'x'.repeat(1500)}</body></html>`;
  const state = { searches: 0 };
  const srv = http.createServer((req, res) => {
    const port = srv.address().port;
    if (req.url.startsWith('/ddg')) { state.searches++; res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<html><body><div class="result"><a class="result__a" href="http://127.0.0.2:${port}/shop1/glove">a</a></div><div class="result"><a class="result__a" href="http://localhost:${port}/shop2/glove">b</a></div></body></html>`); }
    if (req.url === '/ollama/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] })); }
    if (req.url === '/ollama/api/generate') { let b = ''; req.on('data', (c) => { b += c; }); return req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ response: 'Απάντηση: ' + JSON.parse(b).model })); }); }
    // (an engine that answers «no results» with its own page of results: Bing's list, Yahoo's «web» part — an empty page would be «unrecognized»)
    if (req.url.startsWith('/bing')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body><ol id="b_results"></ol><div id="web"></div></body></html>'); }
    if (req.url.startsWith('/shop1/') || req.url.startsWith('/shop2/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page(req.url.startsWith('/shop1/') ? 1 : 2).replace(/PORT/g, port)); }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(0, '0.0.0.0', () => { const b = 'http://127.0.0.1:' + srv.address().port; process.env.SFK_SEARCH_DDG = b + '/ddg'; process.env.SFK_OLLAMA_URL = b + '/ollama'; process.env.SFK_SEARCH_BING = b + '/bing'; process.env.SFK_SEARCH_YAHOO = b + '/bing'; process.env.SFK_SEARCH_FAST = '1'; r({ srv, state }); }));
}

(async () => {
  const webSrv = await web();
  const shopA = await comp(false);
  W('catalog-sf', { syncedAt: now, source: 'api', products: NAMES.map((_, i) => product(i)).concat([Object.assign(product(5), { name: 'ΘΗΚΗ 5.11 FLEX DISPOSABLE GLOVE POUCH', brand: '5.11 TACTICAL', sku: '', images: [], price: 29, regular: 29 })]), categories: [{ id: 11, name: 'Είδη', slug: 'eidi', parent: 0, count: 5, url: '' }], info: {}, lastFullAt: now, syncStartedAt: now, engine: 2, mode: 'full' });
  W('settings', { firstRunDone: true });
  W('competitors', [{ id: 'cA', name: 'shop-a', url: shopA.url, kind: 'woo', enabled: true }]);
  W('competitors-meta', { seed: 99 });
  W('costs', {});

  const port = 19600 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${port}`;
  const env = Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), SFK_DATA: DATA, APPDATA: path.join(tmp, 'cfg'), SFK_NO_AUTOSYNC: '1', SFK_ADMIN_USER: 'admin', SFK_ADMIN_PASSWORD: 'Test-pass-123456', SFK_SECRET_KEY: 'k'.repeat(40),
    SFK_LEASE_MS: '4000', SFK_FEED_MS: '1500', SFK_WEB_FIXES_MS: '3000', SFK_UI_GRACE_MS: '1500', SFK_OFFLINE_MS: '6000', SFK_CLOUD_AFTER_MS: '600000', NO_PROXY: '127.0.0.1,127.0.0.2,localhost', no_proxy: '127.0.0.1,127.0.0.2,localhost', SFK_GITHUB_DATA: '', SFK_GITHUB_TOKEN: '' });
  if (process.env.COORD_PG) {
    // an empty database, as on the first start with Supabase (the data of this test then comes from its folder)
    env.SFK_DATABASE_URL = process.env.COORD_PG;
    const db = require(path.join(APP, 'lib/db'));
    const pool = await db.connect(process.env.COORD_PG);
    await db.reset(pool);
    await pool.query('TRUNCATE documents');
    await pool.end();
  }
  let server, slog = '';
  const startServer = async () => {
    slog = '';
    server = spawn(process.execPath, [path.join(APP, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (b) => { slog += b; }); server.stderr.on('data', (b) => { slog += b; });
    for (let i = 0; i < 150 && !/Ready:/.test(slog); i++) await sleep(100);
    await sleep(800);
  };
  await startServer();
  let H = null;
  const login = async () => { const li = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: 'Test-pass-123456' }) }); H = { Cookie: (li.headers.get('set-cookie') || '').split(';')[0], 'X-SFK': (await li.json()).csrf, 'Content-Type': 'application/json' }; };
  const get = async (p) => (await fetch(base + p, { headers: H })).json();
  const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: H, body: JSON.stringify(b || {}) })).json();
  const until = async (fn, ms) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(250); } };
  const workers = [];
  const startWorker = (name) => {
    const home = path.join(tmp, 'w-' + name);
    const wenv = Object.assign({}, process.env, { SFK_WORKER_HOME: home, APPDATA: path.join(home, 'cfg'), SFK_POLL_MS: '500', SFK_BEAT_MS: '1000', NO_PROXY: '127.0.0.1,127.0.0.2,localhost', no_proxy: '127.0.0.1,127.0.0.2,localhost', SFK_DATA: '' });
    delete wenv.SFK_DATA;
    return { home, env: wenv, run: () => { const p = spawn(process.execPath, [path.join(APP, 'worker.js')], { env: wenv, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', (b) => { out += b; }); p.stderr.on('data', (b) => { out += b; }); workers.push(p); return { p, out: () => out }; } };
  };
  const pairWorker = async (w) => new Promise((r) => {
    post('/api/workers/pair').then((c) => { const p = spawn(process.execPath, [path.join(APP, 'worker.js'), 'pair', base, c.code], { env: w.env }); let o = ''; p.stdout.on('data', (b) => { o += b; }); p.stderr.on('data', (b) => { o += b; }); p.on('exit', (code) => r({ code, out: o })); });
  });
  try {
    await login();
    section('Σύζευξη υπολογιστή');
    const w1 = startWorker('one');
    const pr = await pairWorker(w1);
    ok(pr.code === 0 && /Έτοιμο/.test(pr.out), 'a computer pairs with the code from Settings → Υπολογιστές', pr.out.trim());
    const conf = JSON.parse(fs.readFileSync(path.join(w1.home, 'worker.json'), 'utf8'));
    ok(conf.token && !String(conf.token).startsWith('sfkw_'), 'its token is kept protected on the computer (not as plain text)');
    let ws = await get('/api/workers');
    ok(ws.workers.length === 1 && ws.workers[0].caps.ramMB > 0, 'the cloud lists it with what it can do', JSON.stringify(ws.workers.map((w) => w.name)));
    ok(ws.workers[0].mode === 'off', 'a newly paired computer starts stopped (uses nothing until switched on)', ws.workers[0].mode);
    const sys = await get('/api/system/status');
    const compItem = sys.items && sys.items.find((x) => x.id === 'computer');
    ok(compItem && (compItem.state === 'offline' || /σταματημένος|κλειστός/.test(compItem.text)), 'Σύστημα: the computer is shown (stopped / closed), in one place with the program, data, AI, research', JSON.stringify(sys.items && sys.items.map((x) => x.id + ':' + x.state)));
    const inst = await post('/api/workers/installer');
    ok(inst.name === 'SF-Kentro-Egkatastasi.cmd' && /set "CODE=[A-Z0-9]{4}-[A-Z0-9]{4}"/.test(inst.text) && inst.text.includes('set "SERVER=' + base + '"') && inst.hours === 24, 'one-click installer: this program\'s address and a one-time code (24 hours) inside', inst.name);
    const chk = await post('/api/system/check');
    ok(chk.checked && chk.steps.some((x) => x.id === 'queue' && x.ok) && (process.env.COORD_PG
      ? chk.steps.some((x) => x.id === 'db' && x.ok && /γράφει και διαβάζει/.test(x.text)) && chk.steps.some((x) => x.id === 'save' && ['ok', 'unknown'].includes(x.state))
      : chk.steps.some((x) => x.id === 'save' && x.state === 'warn' && /δίσκο/.test(x.text))), '«Έλεγχος όλων»: real checks — the queue answers; the database answers and writes (or: data only on the server\'s disk is said plainly, ΠΡΟΣΟΧΗ, not a green «ok»)', JSON.stringify(chk.steps));
    ok(['ok', 'warn', 'crit', 'unknown'].includes(chk.level) && chk.items.every((x) => ['ok', 'warn', 'crit', 'unknown'].includes(x.level)), 'every line of «Σύστημα» has one of four levels: ΟΚ · ΠΡΟΣΟΧΗ · ΚΡΙΣΙΜΟ · ΑΓΝΩΣΤΟ', JSON.stringify(chk.items.map((x) => x.id + ':' + x.level)));
    // phase 2: the shared log and the bundle for an AI
    const bun = await get('/api/diagnostics/bundle');
    ok(/# SF Κέντρο — πακέτο διάγνωσης/.test(bun.markdown) && /Υπολογιστές/.test(bun.markdown) && !/Test-pass-123456|sfkw_[A-Za-z0-9]{6}/.test(bun.markdown), 'the «πακέτο διάγνωσης για AI»: the state of the moment, no password or token in it', bun.name);
    const evNo = await fetch(base + '/api/worker/event', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sfkw_fake' }, body: JSON.stringify({ code: 'X', message: 'y' }) });
    ok(evNo.status === 401, 'only a paired computer writes into the log');
    const bad = await fetch(base + '/api/diagnostics/nothing-here', { headers: H });
    void bad;
    const rl = await get('/api/system/repairs');
    ok(Array.isArray(rl) && rl.some((x) => x.id === 'queue-sweep'), 'the safe self-repairs are listed (Σύστημα)');
    const rr = await post('/api/system/repair', { id: 'queue-sweep' });
    ok(rr.ran && ['ok', 'warn', 'crit', 'unknown'].includes(rr.after), 'a person runs one at once: done and checked again', JSON.stringify(rr));
    const rbad = await post('/api/system/repair', { id: 'rm -rf' });
    ok(/Άγνωστη ενέργεια/.test(rbad.error || ''), 'an action that is not on the list is refused');
    // (seen 23/11: a computer that did not update) — what it fetched is in the log; the measurement still runs
    {
      const pc = await post('/api/workers/pair');
      const pr2 = await (await fetch(base + '/api/worker/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pc.code, name: 'PC-OLD', caps: { rev: '2026-11-23b', types: ['codes.web'], ramMB: 8000 } }) })).json();
      const WH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pr2.token };
      const hi = await (await fetch(base + '/api/worker/hello', { method: 'POST', headers: WH, body: JSON.stringify({ caps: { rev: '2026-11-23b', types: ['codes.web'], ramMB: 8000 } }) })).json();
      const up = await fetch(base + '/api/worker/update', { headers: WH });
      const pack = JSON.parse(require('zlib').gunzipSync(Buffer.from(await up.arrayBuffer())));
      ok(hi.rev === require(APP + '/lib/workerrev') && up.status === 200 && Object.keys(pack.files).every((n) => !n.startsWith('root/')), 'an old computer is told the new version and gets a pack it can take');
      const evs = await get('/api/diagnostics?severity=info&code=WORKER_UPDATE_SENT');
      ok(evs.events.some((e) => /PC-OLD/.test(e.message) && /2026-11-23b/.test(e.message)), 'the log says which computer fetched which version (so a failed update is seen)');
      // (PC-OLD stays «off»: the measurement is queued and said who does it; cancelled at once — no live search here)
      const me = await post('/api/system/measure', { n: 5 });
      ok(me.id && /(ο υπολογιστής|το cloud)/i.test(me.who || ''), 'the measurement starts anyway and says who does it and why (with no current computer on: the cloud, with the reason)', me.who);
      await post('/api/jobs/cancel', { id: me.id });
      await post('/api/workers/revoke', { id: pr2.id });
    }
    // (seen 24/11: «only while the program is open» + a screen left idle → the computer cut its 12 jobs in the middle)
    {
      const REV = require(APP + '/lib/workerrev');
      const pc = await post('/api/workers/pair');
      const CAPS = { rev: REV, types: ['research.measure'], ramMB: 8000, slots: 2 };
      const pa = await (await fetch(base + '/api/worker/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pc.code, name: 'PC-APP', caps: CAPS }) })).json();
      const WH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pa.token };
      const wpost = async (p, b) => (await fetch(base + p, { method: 'POST', headers: WH, body: JSON.stringify(b || {}) })).json();
      await wpost('/api/worker/hello', { caps: CAPS });
      await post('/api/workers/mode', { id: pa.id, mode: 'app' });
      const me = await post('/api/system/measure', { n: 5 });
      const cl = await wpost('/api/worker/claim', { max: 1, types: ['research.measure'] });
      const mj = (cl.jobs || []).find((x) => x.id === me.id);
      ok(mj && mj.attempt === 1, 'with the program open, the computer «only while the program is open» takes the job', JSON.stringify(cl));
      await sleep(Number(env.SFK_UI_GRACE_MS) + 600); // no screen asks anything now (the program looks closed)
      const h1 = await wpost('/api/worker/hello', { caps: CAPS });
      const c2 = await wpost('/api/worker/claim', { max: 1, types: ['research.measure'] });
      ok(h1.active === true && h1.finishing === 1 && c2.paused, 'the program closed: no new work, but the job it holds is NOT cut — «active» until it ends (also an older worker goes on)', JSON.stringify([h1.active, h1.finishing, c2]));
      const stale = await wpost('/api/worker/heartbeat', { id: mj.id, attempt: mj.attempt + 1 });
      ok(stale.gone, 'a «still working» of another try is not taken');
      const rel = await wpost('/api/worker/release', { id: mj.id, attempt: mj.attempt, why: 'ο υπολογιστής ενημερώνεται' });
      const jr = (await get('/api/jobs')).find((x) => x.id === me.id);
      ok(rel.ok && jr && jr.status === 'queued', 'a computer that has to stop gives the job back at once (to the queue, the try not counted)', JSON.stringify([rel, jr && jr.status]));
      await sleep(Number(env.SFK_UI_GRACE_MS) + 600); // (the look at the jobs above was a screen asking: wait again)
      const h2 = await wpost('/api/worker/hello', { caps: CAPS });
      ok(h2.active === false, 'holding nothing and the program closed: the computer rests', JSON.stringify(h2));
      await post('/api/jobs/cancel', { id: me.id });
      await post('/api/workers/revoke', { id: pa.id });
    }
    const dg = await get('/api/diagnostics?severity=info');
    ok(Array.isArray(dg.events) && dg.summary && typeof dg.summary.by === 'object', 'the log of events is read in one place (Ρυθμίσεις → Σύστημα → Συμβάντα)');
    const upNo = await fetch(base + '/api/worker/update', { headers: { Authorization: 'Bearer sfkw_fake' } });
    ok(upNo.status === 401, 'the worker\'s files for its own update: only for a paired computer (its token)');
    await post('/api/workers/mode', { id: ws.workers[0].id, mode: 'always' });
    const noTok = await fetch(base + '/api/worker/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sfkw_fake' }, body: '{}' });
    ok(noTok.status === 401, 'a computer without a valid token gets nothing');
    const staffNo = await fetch(base + '/api/worker/claim', { method: 'POST', headers: H, body: '{}' });
    ok(staffNo.status === 401, 'a person\'s session cannot use the computers\' door either');

    section('Η έρευνα τιμών γίνεται στον υπολογιστή');
    const r1 = w1.run();
    await sleep(1500);
    let job = await post('/api/market/run', {});
    ok(/στους υπολογιστές/.test(job.label || ''), 'with a computer paired, «Έρευνα τώρα» goes through the shared queue', job.label);
    let end = await until(async () => { const j = await get('/api/jobs/' + job.id); return j.status !== 'running' && j.status !== 'queued' ? j : null; }, 60000);
    ok(end && end.status === 'done' && end.result && end.result.distributed && end.result.complete, 'the research ends, the day is marked done', JSON.stringify(end && [end.status, end.result, end.error]));
    const mk = await get('/api/market?site=sf');
    // (the glove pouch is sold by no competitor: it is listed «Χωρίς στοιχεία», for the search on the internet)
    const offers = mk.rows.flatMap((r) => r.competitors);
    ok(mk.rows.filter((r) => r.competitors.length).length === 5 && mk.rows.length === 6 && offers.length === 5 && offers.every((o) => o.shop === 'shop-a' && o.match === 'exact'), 'every product has the competitor\'s offer, written by the cloud from the computer\'s result', JSON.stringify([mk.rows.length, offers.length]));
    const qj = (await get('/api/jobs')).find((x) => x.distributed);
    ok(qj && qj.worker === os.hostname() && qj.status === 'completed', 'the job of the competitor was done by the computer (not by the cloud)', JSON.stringify(qj && [qj.worker, qj.status]));
    ok(/εργασία .* παραδόθηκε/.test(r1.out()), 'the computer reports that it handed in the result');

    section('Έρευνα στο internet από τον υπολογιστή (κωδικός, EAN, φωτογραφίες)');
    const fx = await until(async () => { const v = await get('/api/fixes?group=codes&q=GLOVE'); const c = (v.cards || [])[0]; return c && c.changes.some((x) => x.field === 'sku') ? c : null; }, 60000);
    const skuFx = fx && fx.changes.find((x) => x.field === 'sku');
    ok(skuFx && skuFx.to === '56423' && skuFx.level === 'high', 'a product without a code gets the maker\'s code from two shops of the internet → sure, for approval', JSON.stringify(skuFx && [skuFx.to, skuFx.level, skuFx.source && skuFx.source.label]));
    const all6 = await get('/api/fixes?q=GLOVE');
    const fields = (all6.cards[0] || { changes: [] }).changes.map((x) => x.field + ':' + x.level);
    ok(fields.some((f) => f.startsWith('images:')) && fields.includes('gtin:high'), 'the same search brings the EAN (sure: two shops) and the photo (for a look: our title names no colour, a shop says «Black»)', JSON.stringify(fields));
    const wj = (await get('/api/jobs')).find((x) => x.distributed && /internet/.test(x.label || ''));
    ok(wj && wj.worker === os.hostname(), 'the searching was done by the shop\'s computer', JSON.stringify(wj && [wj.worker, wj.status]));
    ok(webSrv.state.searches >= 1, 'it searched the «internet»');
    // a new shop of the internet counts after a yes for that shop (Τιμές → «Έγκριση τιμών»)
    const gl0 = (await get('/api/market?site=sf&q=GLOVE')).rows[0];
    ok(gl0 && gl0.stats.count === 0 && gl0.competitors.filter((c) => c.web).every((c) => c.flag === 'newshop'), 'before the shops are approved their prices are shown, not counted', JSON.stringify(gl0 && gl0.competitors.map((c) => c.flag)));
    for (const c of (gl0 ? gl0.competitors : []).filter((x) => x.web)) await post('/api/codes/shop', { host: c.shop, answer: 'approve' });
    const gl = (await get('/api/market?site=sf&q=GLOVE')).rows[0];
    const wo = gl && gl.competitors.filter((c) => c.web);
    ok(gl && wo.length === 2 && wo.every((c) => c.match === 'exact' && c.price === 27.9) && gl.stats.count >= 1, 'a product no competitor sells gets its prices from the shops of the internet (2 shops, the same product) → it has a market price (a shop with an English-only page counts as foreign)', JSON.stringify(gl && [gl.stats.count, wo.map((c) => [c.shop, c.flag, c.match, c.inStock, c.note])]));

    section('Το AI (Ollama) του υπολογιστή, για το πρόγραμμα στο cloud');
    const ai = await until(async () => { const r = await fetch(base + '/api/ai/status', { headers: H }); const j = await r.json(); return j && j.models && j.models.length ? j : null; }, 30000);
    ok(ai && ai.models.includes('qwen2.5:7b'), '«Δοκιμή» στις Ρυθμίσεις → AI βρίσκει το Ollama του υπολογιστή (όχι του cloud)', JSON.stringify(ai));
    const aij = (await get('/api/jobs')).find((x) => x.distributed && /AI/.test(x.label || ''));
    ok(!aij || aij.worker === os.hostname(), 'the question went to the computer');
    // the button «Δοκιμή»: the whole way with a REAL generate, through the computer's own AI lane
    await post('/api/settings', { localAI: { enabled: true, url: '', model: 'qwen2.5' } });
    const at = await post('/api/ai/test', {});
    ok(at && at.ok && at.where === 'computer' && at.model === 'qwen2.5:7b' && /Απάντηση: qwen2\.5:7b/.test(at.answer) && at.steps.map((x) => x.id).join(',') === 'computer,reach,models,model,generate,greek', '«Δοκιμή» = cloud → the computer → Ollama: models, the chosen model («qwen2.5» = qwen2.5:7b) and a real answer', JSON.stringify(at && at.steps));
    const gj = (await get('/api/jobs')).filter((x) => x.distributed && /AI/.test(x.label || '') && x.status === 'completed');
    ok(gj.length >= 2 && gj.every((x) => x.worker === os.hostname()), 'the questions were answered by the computer, not the cloud');

    section('Υπολογιστής που σβήνει στη μέση');
    // the next day's research (a new day: the note of the day is reset)
    await post('/api/market/run', {}); // joins nothing (done today): returns at once
    const shopB = await comp(true);
    let comps = JSON.parse(fs.readFileSync(path.join(DATA, 'competitors.json'), 'utf8'));
    await post('/api/competitors', { url: shopB.url.replace('127.0.0.1', 'localhost'), name: 'shop-b', kind: 'woo' }); // another host name: «already in the list» compares host names
    comps = await get('/api/competitors');
    const bId = comps.find((c) => c.name === 'shop-b').id;
    job = await post('/api/market/run', {});
    const taken = await until(async () => { const l = await get('/api/jobs'); const x = l.find((y) => y.distributed && /shop-b/.test(y.label) && y.status === 'running' && y.worker); return x || null; }, 20000);
    ok(!!taken, 'the slow competitor is taken by the computer');
    r1.p.kill('SIGKILL');
    const w2 = startWorker('two');
    await pairWorker(w2);
    for (const x of (await get('/api/workers')).workers) if (x.mode === 'off') await post('/api/workers/mode', { id: x.id, mode: 'always' });
    const r2 = w2.run();
    end = await until(async () => { const j = await get('/api/jobs/' + job.id); return j.status !== 'running' && j.status !== 'queued' ? j : null; }, 60000);
    const bjob = (await get('/api/jobs')).find((y) => y.distributed && /shop-b/.test(y.label));
    ok(end && end.status === 'done' && bjob && bjob.status === 'completed' && bjob.attempts === 2, 'the computer was switched off: its lease ended and another computer finished the job (2nd attempt)', JSON.stringify(bjob && [bjob.status, bjob.attempts, bjob.worker]));
    const mk2 = await get('/api/market?site=sf');
    ok(mk2.rows.filter((r) => !/GLOVE/.test(r.name)).every((r) => r.competitors.filter((c) => c.competitorId === bId).length === 1), 'each product has exactly one offer of that competitor (no double result)');
    void r2;

    section('Αφαίρεση υπολογιστή');
    ws = await get('/api/workers');
    // the newest computer («two»), busy or not: a removed computer must stop even in the middle of a job
    const w2id = ws.workers.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
    await post('/api/workers/revoke', { id: w2id });
    await sleep(2500);
    ok(/αναγνωρίζεται πια/.test(r2.out()) || r2.p.exitCode != null, 'a removed computer is refused at once and stops', r2.out().slice(-200));
    const aud = await get('/api/audit');
    ok(Array.isArray(aud) && aud.some((a) => a.action === 'αφαίρεση υπολογιστή') && aud.some((a) => a.action === 'κωδικός σύζευξης υπολογιστή'), 'the audit log keeps who paired and removed computers', JSON.stringify((aud || []).slice(0, 3).map((a) => a.action)));

    section('Επανεκκίνηση του cloud');
    server.kill('SIGTERM'); await sleep(1500);
    await startServer(); await login();
    ws = await get('/api/workers');
    const mk3 = await get('/api/market?site=sf');
    ok(ws.workers.length === 1 && mk3.rows.filter((r) => r.competitors.length).length >= 5, 'after a restart the computers and the results are still there' + (process.env.COORD_PG ? ' (from the database)' : ''), JSON.stringify([ws.workers.length, mk3.rows.length]));
    shopB.srv.close();
  } finally {
    for (const p of workers) { try { p.kill('SIGKILL'); } catch (_) { /* gone */ } }
    try { server.kill('SIGKILL'); } catch (_) { /* gone */ }
    shopA.srv.close();
    webSrv.srv.close();
    if (fails) console.log(slog.slice(-2000));
  }
  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
