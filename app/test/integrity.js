'use strict';
// SF Κέντρο — data that is never lost or mixed up, and addresses that never lead inside.
//   1. writes of the same file that overlap: the newest value is the one on disk, no temporary files left
//   2. the results of 8 shops arriving together: every offer of every shop is in the results
//   3. the program never opens an address of a private network (this machine, the local network, the cloud's
//      internal addresses), also when a public page redirects there
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-integrity-'));
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

(async () => {
  const store = require(APP + '/lib/store');
  store.init();

  section('Εγγραφές του ίδιου αρχείου που συμπίπτουν');
  const big = (n) => ({ n, list: Array.from({ length: 3000 }, (_, i) => ({ i, n, text: 'x'.repeat(40) })) });
  const rest = () => sleep(1);
  const ws = [];
  for (let n = 1; n <= 10; n++) ws.push(store.writeAsync('stress', big(n), rest));
  await Promise.all(ws);
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.SFK_DATA, 'stress.json'), 'utf8'));
  ok(onDisk.n === 10 && onDisk.list.length === 3000 && onDisk.list.every((x) => x.n === 10), '10 writes in slices at the same time: the file holds the newest one, whole', String(onDisk.n));
  const p = store.writeAsync('stress', big(11), rest);
  store.write('stress', big(12)); // a quick write while the slow one is on its way
  await p;
  ok(JSON.parse(fs.readFileSync(path.join(process.env.SFK_DATA, 'stress.json'), 'utf8')).n === 12, 'a newer quick write is never replaced by an older slow one that ends after it');
  ok(!fs.readdirSync(process.env.SFK_DATA).some((f) => /\.tmp-/.test(f)), 'no temporary files left behind');

  section('Αποτελέσματα 8 καταστημάτων που φτάνουν μαζί');
  const now = new Date().toISOString();
  const W = (n, v) => fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v));
  const products = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, type: 'simple', parent: 0, name: 'ΣΑΚΙΔΙΟ PENTAGON MODEL ' + (i + 1), varLabel: '', slug: 'p' + i, sku: 'K' + (16000 + i), url: 'https://shop.example/p/' + i, price: 50, regular: 50, sale: 0, priceMax: 0, inStock: true, purchasable: true, status: 'publish', cats: [], catNames: [], tags: [], brand: 'PENTAGON', brandSource: 'brands', attrs: [], images: [], thumb: '', imageAlts: [], desc: '', short: '' }));
  W('catalog-sf', { syncedAt: now, source: 'api', products, categories: [], info: {}, lastFullAt: now, engine: 2, mode: 'full' });
  W('catalog-st', { syncedAt: now, source: 'api', products: [], categories: [], info: {}, lastFullAt: now, engine: 2, mode: 'full' });
  const comps = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, name: 'shop-' + i, url: `https://shop${i}.example`, kind: 'woo', enabled: true }));
  W('competitors', comps);
  W('settings', { firstRunDone: true });
  store.forgetAll();
  const research = require(APP + '/lib/research');
  const offer = (ci, p) => ({ shop: 'shop-' + ci, competitorId: 'c' + ci, name: p.name, sku: p.sku, url: `https://shop${ci}.example/p/${p.id}`, price: 40 + ci, inStock: true, match: 'exact', how: 'sku', ev: ['ίδιος κωδικός'], country: 'GR', seenAt: now });
  await Promise.all(comps.map((c, ci) => research.mergeShop(c.id, now, Object.fromEntries(products.map((p) => ['sf:' + p.id, offer(ci, p)])))));
  await sleep(50);
  store.forgetAll();
  const market = JSON.parse(fs.readFileSync(path.join(process.env.SFK_DATA, 'market.json'), 'utf8'));
  const counts = products.map((p) => (market['sf:' + p.id] ? market['sf:' + p.id].competitors.length : 0));
  ok(counts.every((n) => n === 8), 'every product has the offer of all 8 shops (none lost, none doubled)', JSON.stringify([...new Set(counts)]));
  const prog = JSON.parse(fs.readFileSync(path.join(process.env.SFK_DATA, 'market-progress.json'), 'utf8'));
  ok(Object.keys(prog.done).length === 8, 'and the day\'s note knows all 8 shops are in', String(Object.keys(prog.done).length));

  section('Ποτέ διευθύνσεις εσωτερικού δικτύου');
  delete process.env.SFK_ALLOW_PRIVATE;
  const net = require(APP + '/lib/http');
  const inner = http.createServer((req, res) => { res.end('secret'); });
  await new Promise((r) => inner.listen(0, '127.0.0.1', r));
  const port = inner.address().port;
  const refused = async (u) => { try { await net.get(u, { retries: 0, timeout: 5000 }); return false; } catch (e) { return !!e.private || /εσωτερικ|δεν επιτρέπεται/.test(e.message); } };
  ok(await refused(`http://127.0.0.1:${port}/`), 'this machine (127.0.0.1) is refused');
  ok(await refused('http://localhost:1/'), 'localhost is refused');
  ok(await refused('http://169.254.169.254/latest/meta-data/'), 'the cloud\'s internal address (169.254.169.254) is refused');
  ok(await refused('http://10.0.0.5/') && await refused('http://192.168.1.1/') && await refused('http://172.16.0.1/'), 'the local network (10.x, 192.168.x, 172.16.x) is refused');
  ok(await refused('http://[::1]/') && await refused('http://0.0.0.0/'), 'IPv6 loopback and 0.0.0.0 are refused');
  ok(await net.get('file:///etc/passwd', { retries: 0 }).then(() => false, (e) => /http/.test(e.message)), 'only http / https');
  ok(net.privateIp('8.8.8.8') === false && net.privateIp('100.64.1.1') === true && net.privateIp('::ffff:127.0.0.1') === true, 'public addresses pass; shared and mapped private ones do not');
  // a public page that redirects inside: the redirect is checked like the first address
  const redir = http.createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${port}/` }); res.end(); });
  await new Promise((r) => redir.listen(0, '127.0.0.1', r));
  process.env.SFK_TREAT_PUBLIC = '127.0.0.1:' + redir.address().port; // stands for a public site
  ok(await refused(`http://127.0.0.1:${redir.address().port}/`), 'a public page that redirects to an internal address is refused (every redirect is checked)');
  delete process.env.SFK_TREAT_PUBLIC;
  inner.close(); redir.close();

  section('Αντίγραφα με ημερομηνία');
  const days = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 10, 17) - i * 864e5).toISOString().slice(0, 10));
  const keep = require(APP + '/lib/cloudsave').keepOf(days);
  const sundays = [...keep].filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 0);
  ok(keep.has('2026-11-17') && keep.has('2026-11-04') && !keep.has('2026-11-02') && keep.size <= 22 && sundays.length >= 8, '14 daily copies and 8 weekly (Sunday) ones are kept, the rest go', JSON.stringify([keep.size, sundays.length]));

  section('Τιμές μόνο από ό,τι διατίθεται');
  const compcat = require(APP + '/lib/compcat');
  const sh = compcat.fromShopify({ id: 1, title: 'Bag', handle: 'bag', vendor: 'X', images: [], variants: [{ price: '29.90', available: false }, { price: '39.90', available: true }, { price: '44.90', available: true }] }, 'https://s.example');
  ok(sh.p === 39.9 && sh.st === true, 'Shopify: the price is the cheapest size IN STOCK (29,90 sold out → 39,90)', JSON.stringify([sh.p, sh.st]));
  const sh2 = compcat.fromShopify({ id: 2, title: 'Bag', handle: 'bag', vendor: 'X', images: [], variants: [{ price: '29.90', available: false }, { price: '39.90', available: false }] }, 'https://s.example');
  ok(sh2.st === false, 'Shopify: nothing in stock → sold out (does not count in the price)');
  const sm = require(APP + '/lib/sitemapcat');
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const page = '<html><head>' + ld({ '@type': 'Product', name: 'Other bag', url: 'https://x.example/other', offers: { price: '9.00', availability: 'InStock' } }) +
    ld({ '@type': 'Product', name: 'Our bag', url: 'https://x.example/bag', offers: [{ price: '29.90', availability: 'https://schema.org/OutOfStock' }, { price: '39.90', availability: 'https://schema.org/InStock' }] }) + '</head><body></body></html>';
  const pp = sm.productOf(page, 'https://x.example/bag');
  ok(pp && pp.n === 'Our bag' && pp.p === 39.9 && pp.st === true, 'a shop page: its own product (not a related one shown on it) and the price in stock', JSON.stringify(pp && [pp.n, pp.p, pp.st]));

  section('Κατάλογος με «τρύπα» δεν κρατιέται, χάρτης μισός δεν σβήνει προϊόντα');
  process.env.SFK_ALLOW_PRIVATE = '1';
  const woo = http.createServer((req, res) => {
    const pg = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1);
    if (pg === 2) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>maintenance</html>'); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-WP-Total': '250', 'X-WP-TotalPages': '3' });
    res.end(JSON.stringify(Array.from({ length: pg === 3 ? 50 : 100 }, (_, i) => ({ id: pg * 1000 + i, name: 'P' + i, prices: { price: '1000', regular_price: '1000', currency_minor_unit: 2 }, is_in_stock: true, permalink: 'https://w.example/p' + i }))));
  });
  await new Promise((r) => woo.listen(0, '127.0.0.1', r));
  const wurl = 'http://127.0.0.1:' + woo.address().port;
  const before = { kind: 'woo', url: wurl, at: '2026-01-01', products: [{ id: 1, n: 'Old', p: 5 }] };
  fs.writeFileSync(path.join(process.env.SFK_DATA, 'comp-cw.json'), JSON.stringify(before));
  store.forget('comp-cw');
  let wErr = '';
  try { await compcat.syncOne({ id: 'cw', name: 'w', url: wurl, kind: 'woo' }, { prog: { addTotal() {}, add() {}, note() {} }, full: true }); } catch (e) { wErr = e.message; }
  store.forget('comp-cw');
  ok(/σελίδα 2|JSON/.test(wErr) && compcat.load('cw').products.length === 1 && compcat.load('cw').products[0].n === 'Old', 'WooCommerce: one page missing → the reading fails and the previous whole catalog stays', wErr);
  woo.close();
  const maps = http.createServer((req, res) => {
    const base = 'http://127.0.0.1:' + maps.address().port;
    if (req.url === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${base}/product-sitemap1.xml</loc></sitemap><sitemap><loc>${base}/product-sitemap2.xml</loc></sitemap></sitemapindex>`); }
    if (req.url === '/product-sitemap1.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<?xml version="1.0"?><urlset><url><loc>${base}/p/one</loc></url></urlset>`); }
    if (req.url === '/product-sitemap2.xml') { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>' + ld({ '@type': 'Product', name: 'One', offers: { price: '10', availability: 'InStock' } }) + '</html>');
  });
  await new Promise((r) => maps.listen(0, '127.0.0.1', r));
  const mb = 'http://127.0.0.1:' + maps.address().port;
  const prevMap = { pages: { [mb + '/p/two']: { lm: '', at: new Date().toISOString(), ok: true } }, products: [{ u: mb + '/p/two', n: 'Two', p: 20 }] };
  const stM = await sm.sync({ url: mb, sitemaps: [mb + '/sitemap.xml'] }, prevMap, { budget: 5, gap: 0 });
  ok(stM.mapWhole === false && stM.products.some((x) => x.u === mb + '/p/two'), 'a site map read only in part: the products of the part not read are kept (not taken for deleted)', JSON.stringify([stM.mapWhole, stM.products.map((x) => x.n)]));
  maps.close();
  delete process.env.SFK_ALLOW_PRIVATE;

  // the health of «Σύστημα»: four levels, from real checks (audit 23/11)
  {
    const health = require(APP + '/lib/health');
    ok(health.probeSave({ enabled: true, where: 'βάση δεδομένων', savedAt: new Date().toISOString() }).level === 'ok' && health.probeSave({ enabled: true, conflicts: ['market.json'] }).level === 'crit' && health.probeSave({ enabled: true, blocked: true, error: 'x' }).level === 'crit' && health.probeSave({ enabled: false }).level === 'warn', 'saving: ok · a conflict / a blocked start → ΚΡΙΣΙΜΟ · only the server\'s disk → ΠΡΟΣΟΧΗ');
    store.write('backup-meta', null);
    ok(health.probeBackup(true).level === 'unknown', 'no good daily copy recorded yet → ΑΓΝΩΣΤΟ (not «ok»)');
    health.backupDone(new Date(Date.now() - 2 * 36e5).toISOString());
    ok(health.probeBackup(true).level === 'ok', 'a copy 2 hours old → ΟΚ');
    health.backupDone(new Date(Date.now() - 30 * 36e5).toISOString());
    ok(health.probeBackup(true).level === 'warn', 'a copy 30 hours old → ΠΡΟΣΟΧΗ');
    health.backupDone(new Date(Date.now() - 80 * 36e5).toISOString());
    ok(health.probeBackup(true).level === 'crit', 'a copy over 3 days old → ΚΡΙΣΙΜΟ');
    const qOk = await health.probeQueue({ healthOf: async () => ({ queued: 2, running: 1, stuck: 0, old: 0, failed: 0 }) });
    const qBad = await health.probeQueue({ healthOf: async () => ({ queued: 0, running: 1, stuck: 1, old: 0, failed: 0 }) });
    ok(qOk.level === 'ok' && qBad.level === 'crit' && /κολλημένες/.test(qBad.text), 'the queue: a job stuck after its lease → ΚΡΙΣΙΜΟ');
    health.set('db', 'ok', 'παλιός έλεγχος');
    const real = Date.now; Date.now = () => real() + 31 * 60000;
    const v = health.view(); Date.now = real;
    ok(v.db.level === 'unknown', 'a check older than 30 minutes is ΑΓΝΩΣΤΟ again (never green from an old result)');
    ok(health.worst(['ok', 'unknown', 'warn']) === 'warn' && health.worst(['ok', 'crit']) === 'crit' && health.worst(['ok', 'unknown']) === 'unknown', 'the whole is the worst of its lines');
  }

  // the background work and a request that only waits (for that very work, the internet, the AI): it must not stop
  // the work (a screen open during the preparation made it 100 times slower: «Ετοιμάζονται τα στοιχεία» for minutes)
  {
    const bg = require(APP + '/lib/bg');
    const waiting = bg.request();
    await new Promise((r) => setTimeout(r, 1700));
    function* work() { for (let i = 0; i < 40; i++) { const t = Date.now(); while (Date.now() - t < 13) { /* work */ } yield; } return 'ok'; }
    const t0 = Date.now();
    const r = await bg.drain(work());
    const ms = Date.now() - t0;
    waiting();
    ok(r === 'ok' && ms < 5000, `a request that only waits does not hold the background work back (${ms} ms for 40 slices; it used to take ~60 s)`);
    const fresh = bg.request();
    const t1 = Date.now(); await bg.breathe(300); const w = Date.now() - t1; fresh();
    ok(w >= 250, 'a request just arrived: the work still steps aside for it (a person waits for that answer)', w);
  }

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
