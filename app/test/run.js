'use strict';
// SF Κέντρο — automatic tests (npm test). Everything runs on this PC with made-up data: a temporary data folder,
// a little "supplier site" on 127.0.0.1, and the program itself in server mode. Nothing is sent anywhere.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-test-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);

// ---------- made-up shops, supplier and competitors ----------
const now = new Date().toISOString();
const W = (n, v) => fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v));
const gtin = (base) => { const d = String(base).padStart(12, '0').slice(0, 12); let s = 0; for (let i = 0; i < 12; i++) s += Number(d[11 - i]) * (i % 2 === 0 ? 3 : 1); return d + ((10 - (s % 10)) % 10); };
function product(o) {
  const p = Object.assign({ type: 'simple', parent: 0, varLabel: '', slug: 's' + o.id, url: 'https://shop.example/p/' + o.id, regular: o.price, sale: 0, priceMax: 0, inStock: true, purchasable: true, cats: [11], catNames: ['Ρουχισμός'], tags: [], brandSource: 'attr:Κατασκευαστής', attrs: [], images: ['https://shop.example/i/' + o.id + 'a.jpg', 'https://shop.example/i/' + o.id + 'b.jpg'], thumb: '', imageAlts: [], short: '<ul><li>x</li></ul>', variations: [], status: 'publish',
    desc: '<p>Ποιοτικό προϊόν για καθημερινή και επαγγελματική χρήση, με ανθεκτικά υλικά και προσεγμένες ραφές. Ιδανικό για στρατιωτικούς, σώματα ασφαλείας και λάτρεις του outdoor. Διατίθεται στα καταστήματά μας και online, με γρήγορη αποστολή.</p><ul><li>Ανθεκτικό ύφασμα</li><li>Πολλές τσέπες</li></ul>' }, o);
  p.descLen = p.desc.replace(/<[^>]+>/g, '').length; p.shortLen = p.short.replace(/<[^>]+>/g, '').length;
  return p;
}
function world(supplierPort) {
  const cats = [{ id: 1, name: 'Uncategorized', slug: 'uncategorized', parent: 0, count: 1, url: '' }, { id: 11, name: 'Ρουχισμός', slug: 'rouxismos', parent: 0, count: 5, url: '' }, { id: 12, name: 'Μπουφάν', slug: 'mpoufan', parent: 11, count: 3, url: '' }, { id: 21, name: 'ΟΠΛΑ', slug: 'opla', parent: 0, count: 1, url: '' }];
  const sf = [
    product({ id: 101, name: 'ΠΑΝΤΕΛΟΝΙ PENTAGON RANGER 2.0 ΜΑΥΡΟ', sku: 'K05007-01', brand: 'PENTAGON', price: 69.9 }),
    product({ id: 102, name: 'Σακίδιο Helikon-Tex Raccoon Mk2 20L', sku: 'PL-RCN-CD-11', brand: 'HELIKON-TEX', price: 89.9, desc: '', short: '', images: ['https://shop.example/i/102.jpg'] }),
    product({ id: 103, name: 'ΓΑNΤΙΑ MECHANIX M-PACT COYOTE', sku: 'MPT-72', brand: 'MECHANIX', price: 39.9 }),
    product({ id: 104, name: '5.11 TACTICAL ΜΠΟΥΦΑΝ SABRE 2.0', sku: '48112', brand: '5.11 TACTICAL', price: 219, cats: [1], catNames: ['Uncategorized'] }),
  ];
  for (const [id, n] of [[105, 'ΜΠΟΥΦΑΝ HELIKON-TEX LEVEL 7'], [106, 'ΜΠΟΥΦΑΝ PENTAGON ATLANTIC'], [107, 'ΜΠΟΥΦΑΝ CONDOR SUMMIT']]) sf.push(product({ id, name: n, sku: 'J' + id, brand: n.split(' ')[1], price: 120, cats: [12], catNames: ['Μπουφάν'] }));
  const st = [
    product({ id: 201, name: 'ΠΑΝΤΕΛΟΝΙ PENTAGON RANGER 2.0 ΜΑΥΡΟ', sku: 'K05007-01', brand: 'PENTAGON', price: 74.9 }),
    product({ id: 203, name: 'ΠΙΣΤΟΛΙ ΚΡΟΤΟΥ BRUNI 92', sku: 'BR92', brand: 'BRUNI', price: 89, cats: [21], catNames: ['ΟΠΛΑ'] }),
  ];
  const cat = (products) => ({ syncedAt: now, source: 'api', products, categories: cats, info: { seo: 'yoast' }, lastFullAt: now, syncStartedAt: now, engine: 2, mode: 'full', withVariations: true });
  W('catalog-sf', cat(sf)); W('catalog-st', cat(st));
  const base = 'http://127.0.0.1:' + supplierPort;
  W('suppliers', [{ id: 's1', name: 'Tactical Imports ΑΕ', brands: ['HELIKON-TEX', 'MECHANIX'], keywords: [], priceMode: 'retail', markup: 80, discount: 35, active: true, catalogMode: 'none', autoRefresh: true, createdAt: now }]);
  W('pricelist-s1', { importedAt: now, fileName: 'feed.xml', source: {}, mapping: { code: 'code', name: 'name', price: 'price' }, priceKind: 'retail', vatIncluded: true, items: [
    { key: 'c:PLRCNCD11', code: 'PL-RCN-CD-11', ean: gtin('590582012345'), name: 'Helikon-Tex Raccoon Mk2 Backpack 20L', brand: 'Helikon-Tex', price: 92, desc: '', images: [], url: base + '/p/raccoon', category: '', color: '', size: '', group: '', stock: '', prevPrice: null },
    { key: 'c:MPT72', code: 'MPT-72', ean: '5200000000001', name: 'Mechanix M-Pact Gloves Coyote', brand: 'Mechanix', price: 42, desc: '', images: [], url: base + '/p/login', category: '', color: '', size: '', group: '', stock: '', prevPrice: null },
  ] });
  W('costs', { 'sf:101': { cost: 40, source: 'manual', at: now } });
  W('competitors', [{ id: 'cA', name: 'shop-a', url: 'https://shop-a.example', kind: 'woo', enabled: true }, { id: 'cB', name: 'shop-b', url: 'https://shop-b.example', kind: 'woo', enabled: true }]);
  W('competitors-meta', { seed: 99 });
  const comp = (id, list) => W('comp-' + id, { kind: 'woo', at: now, products: list.map((x, i) => Object.assign({ id: i, s: '', u: `https://${id}.example/p/${i}`, pm: 0, r: 0, st: true, i: '', c: 'EUR' }, x)) });
  comp('cA', [{ n: 'ΓΑΝΤΙΑ MECHANIX M-PACT COYOTE', b: 'MECHANIX', p: 38 }]);
  comp('cB', [{ n: 'MECHANIX M-PACT ΓΑΝΤΙΑ COYOTE', b: 'MECHANIX', p: 37.5 }]);
  W('settings', { firstRunDone: true });
}

// a supplier's site: one real product page, one page that is really a login screen
function supplierSite() {
  const page = (name, desc, imgs) => `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, brand: { name: 'Helikon-Tex' }, image: imgs })}</script></head><body><h1>${name}</h1><div id="tab-description">${desc}</div><table class="woocommerce-product-attributes"><tr><th>Υλικό</th><td>Cordura 500D</td></tr><tr><th>Βάρος</th><td>0,85 kg</td></tr></table></body></html>`;
  const srv = http.createServer((req, res) => {
    const b = 'http://127.0.0.1:' + srv.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/p/raccoon') return res.end(page('Helikon-Tex Raccoon Mk2 Backpack 20L', '<p>Το σακίδιο Raccoon Mk2 είναι συμπαγές σακίδιο ημέρας 20 λίτρων από Cordura 500D, με κύρια θήκη που ανοίγει σαν βαλίτσα.</p><p>Για χονδρική επικοινωνήστε στο 2104123456.</p><ul><li>Ιμάντες ώμου με επένδυση</li><li>Πάνελ MOLLE</li></ul>', [b + '/i/1.jpg', b + '/i/2.jpg', b + '/i/3.jpg']));
    return res.end(page('Σύνδεση', '<p>Please log in to see this page.</p>', []));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await supplierSite();
  world(srv.address().port);
  const store = require(APP + '/lib/store');
  const market = require(APP + '/lib/market');
  const fixes = require(APP + '/lib/fixes');
  const spell = require(APP + '/lib/spell');

  section('Αποθήκευση');
  ok(store.read('nothing-yet', null) === null && Array.isArray(store.read('nothing-yet', () => [])), 'a missing file gives each caller its own default (no "reading brands" crash)');
  ok(typeof require(APP + '/lib/supplierfind').view().counts === 'object', 'supplier search screen opens with no data yet');

  section('Τιμές αγοράς: πότε αλλάζει η τιμή');
  const off = (shop, price, o) => Object.assign({ shop, price, match: 'exact', inStock: true, country: 'GR', seenAt: now, url: 'https://' + shop + '/x' }, o || {});
  const decide = (ours, offers, cost) => { store.write('costs', cost ? { 'sf:9': cost } : {}); const ci = market.costInfo('sf', { id: 9 }); const st = market.stats(offers, { ours, costVat: ci.costVat, rrp: ci.rrp }); return Object.assign(market.decision(ours, st, offers, ci.floor, ci.costVat), { st }); };
  let d = decide(100, [off('a', 50)]);
  ok(d.action === 'watch' && !d.suggested, 'one cheaper shop (even with stock) only informs, never lowers the price', d.action);
  d = decide(100, [off('a', 80), off('b', 82)]);
  ok(d.action === 'lower' && d.suggested === 78.9, 'two shops agree → lower (median − 3%, ,90 ending)', d.action + ' ' + d.suggested);
  d = decide(100, [off('a', 70), off('b', 72)], { cost: 60 });
  ok(d.action === 'nodata' && d.st.suspect === 2, 'prices under our cost are suspect (old stock / mistake) and do not count', d.action);
  d = decide(100, [off('a', 90), off('b', 92), off('c', 45)]);
  ok(d.action === 'lower' && d.st.suspect === 1, 'a price 50% under the others does not count', d.action);
  d = decide(100, [off('a', 50, { inStock: false })]);
  ok(d.action === 'nodata' && /Κανείς/.test(d.reason), 'out of stock elsewhere → no reason to lower');
  d = decide(70, [off('a', 65), off('b', 66)], { cost: 60 });
  ok(d.action === 'raise' && d.loss && d.suggested === 93.9, 'selling under cost → raise to the floor, whatever the others do', d.action + ' ' + d.suggested);
  store.write('costs', { 'sf:101': { cost: 40, source: 'manual', at: now } });

  section('Λεξικό ορθογραφίας');
  ok(spell.dict().has('ΠΑΝΤΕΛΟΝΙ') && !spell.dict().has('ΠΙΙΣΤΟΛΙ'), 'known and unknown words');
  ok((spell.check('ΠΙΙΣΤΟΛΙ', new Map([['ΠΙΣΤΟΛΙ', 50]])) || {}).fix === 'ΠΙΣΤΟΛΙ', 'typing slip corrected (ΠΙΙΣΤΟΛΙ → ΠΙΣΤΟΛΙ)');
  ok(spell.knownStem('ΑΝΤΙΟΞΕΙΔΩΤΙΚΟ') && !spell.knownStem('ΜΕΣΟΟΘΥΡΩΝ'), 'word forms exact (no false matches)');

  section('Διορθώσεις: συμπληρώνονται μόνες τους, περιμένουν έγκριση');
  const r = await fixes.findSources(null, { maxPages: 5 });
  ok(r && r.pages >= 1, 'supplier pages are read', JSON.stringify(r));
  const all = fixes.compute().items;
  const one = (site, pid, field) => all.find((c) => c.site === site && c.pid === pid && c.field === field);
  const desc = one('sf', 102, 'desc');
  ok(desc && desc.level === 'high' && /Cordura 500D/.test(desc.to.html), 'missing description filled from the supplier page (same code → sure)');
  ok(desc && !/2104123456|χονδρικ/i.test(desc.to.html), "the supplier's phone / wholesale text never reaches our site");
  ok(desc && /^<h2>Σακίδιο Helikon-Tex Raccoon Mk2 20L<\/h2>/.test(desc.to.html), 'description starts with the title in Title Case');
  ok(one('sf', 102, 'images') && one('sf', 102, 'images').to.length === 4, 'photos added from the supplier page');
  ok(one('sf', 102, 'gtin') && one('sf', 102, 'gtin').to === gtin('590582012345'), 'EAN with a valid check digit');
  ok(!one('sf', 103, 'gtin'), 'EAN with a wrong check digit is not proposed');
  ok(!one('sf', 103, 'desc'), 'a login page is not taken as a description (title check)');
  ok(one('sf', 103, 'name') && one('sf', 103, 'name').to === 'ΓΑΝΤΙΑ MECHANIX M-PACT COYOTE', 'mixed Greek/Latin letters fixed in the title');
  ok(one('sf', 102, 'name') && one('sf', 102, 'name').to === 'ΣΑΚΙΔΙΟ HELIKON-TEX RACCOON Mk2 20L', 'title to capitals without accents');
  ok(one('sf', 104, 'cats') && one('sf', 104, 'cats').to.id === 12, 'category from similar products (ΜΠΟΥΦΑΝ → Μπουφάν)');
  ok(one('st', 201, 'price') && one('st', 201, 'price').to.regular === 69.9, 'ads site follows the price of the main site');
  ok(one('st', 203, 'published') && one('st', 203, 'published').to === -1, 'weapons become drafts on the ads site');
  const sure = fixes.approveSure('', '', 'test');
  ok(sure.count >= 6, 'approve all sure fixes in one go', String(sure.count));
  const ex = fixes.exportFile('sf', 'test');
  ok(/^\uFEFFID,Name,/.test(ex.csv) && ex.csv.includes('Cordura 500D') && ex.csv.includes('GTIN, UPC, EAN, or ISBN'), 'one WooCommerce update file with only the changed columns');
  ok(fixes.compute().items.filter((c) => c.status === 'exported').length === sure.count - fixes.compute().items.filter((c) => c.site === 'st' && c.status === 'approved').length, 'exported fixes are marked');

  section('Λειτουργία διακομιστή: χρήστες και ασφάλεια');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const env = Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), SFK_NO_AUTOSYNC: '1', SFK_ADMIN_USER: 'admin', SFK_ADMIN_PASSWORD: 'Test-pass-123456' });
  const child = spawn(process.execPath, [path.join(APP, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
  for (let i = 0; i < 50 && !/Running at/.test(log); i++) await new Promise((x) => setTimeout(x, 100));
  const base = `http://127.0.0.1:${port}`;
  try {
    ok((await fetch(base + '/api/state')).status === 401, 'no login → 401');
    const bad = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: 'wrong-password' }) });
    ok(bad.status === 400, 'wrong password refused');
    const li = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: 'Test-pass-123456' }) });
    const cookie = (li.headers.get('set-cookie') || '').split(';')[0];
    const { csrf } = await li.json();
    ok(/HttpOnly/.test(li.headers.get('set-cookie')) && /SameSite=Strict/.test(li.headers.get('set-cookie')), 'session cookie HttpOnly + SameSite=Strict');
    ok((await fetch(base + '/api/state', { headers: { Cookie: cookie } })).status === 403, 'cookie without the session token → 403');
    ok((await fetch(base + '/api/state', { headers: { Cookie: cookie, 'X-SFK': csrf } })).status === 200, 'cookie + token → 200');
    ok((await fetch(base + '/api/state', { headers: { Cookie: cookie, 'X-SFK': csrf, Origin: 'https://evil.example' } })).status === 403, 'another site (Origin) → 403');
    const H = { Cookie: cookie, 'X-SFK': csrf, 'Content-Type': 'application/json' };
    ok((await fetch(base + '/api/users', { method: 'POST', headers: H, body: JSON.stringify({ user: 'maria', name: 'Μαρία', password: 'Piraeus-shop-1' }) })).status === 200, 'admin adds a user');
    const l2 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'maria', password: 'Piraeus-shop-1' }) });
    const c2 = (l2.headers.get('set-cookie') || '').split(';')[0], t2 = (await l2.json()).csrf;
    ok((await fetch(base + '/api/settings', { method: 'POST', headers: { Cookie: c2, 'X-SFK': t2, 'Content-Type': 'application/json' }, body: '{"vat":10}' })).status === 403, 'a staff user cannot change settings');
    ok((await fetch(base + '/api/fixes', { headers: { Cookie: c2, 'X-SFK': t2 } })).status === 200, 'a staff user works normally');
    const S2 = { Cookie: c2, 'X-SFK': t2, 'Content-Type': 'application/json' };

    section('Κινητό: QR, «μείνε συνδεδεμένος», χαμένο κινητό, αντίγραφο σε αρχείο');
    const qr = await (await fetch(base + '/api/qr?text=' + encodeURIComponent('http://192.168.1.20:17321/'), { headers: H })).json();
    ok(qr.size >= 21 && qr.rows.length === qr.size && /^[01]+$/.test(qr.rows[0]), 'QR code for the shop address', JSON.stringify(qr).slice(0, 80));
    ok((await fetch(base + '/api/qr?text=' + encodeURIComponent('javascript:alert(1)'), { headers: H })).status === 400, 'QR only for http(s) addresses');
    const l3 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'maria', password: 'Piraeus-shop-1', remember: true }) });
    const c3 = (l3.headers.get('set-cookie') || '').split(';')[0], t3 = (await l3.json()).csrf;
    let list = (await (await fetch(base + '/api/users', { headers: H })).json()).sessions;
    const phone = list.find((x) => x.remembered && x.user === 'Μαρία');
    ok(phone && !phone.current && list.some((x) => x.current), 'the remembered phone and "this device" are shown');
    ok((await fetch(base + '/api/users/session-end', { method: 'POST', headers: S2, body: JSON.stringify({ id: phone.id }) })).status === 403, 'only an administrator signs out a device');
    ok((await fetch(base + '/api/users/session-end', { method: 'POST', headers: H, body: JSON.stringify({ id: phone.id }) })).status === 200, 'administrator signs out the lost phone');
    ok((await fetch(base + '/api/state', { headers: { Cookie: c3, 'X-SFK': t3 } })).status === 401, 'that phone is out at once');
    ok((await fetch(base + '/api/state', { headers: { Cookie: c2, 'X-SFK': t2 } })).status === 200, "the user's other devices stay signed in");
    ok((await fetch(base + '/api/backup/make', { method: 'POST', headers: S2 })).status === 403, 'a staff user cannot take a copy of all the data');
    const bk = await (await fetch(base + '/api/backup/make', { method: 'POST', headers: H })).json();
    ok(/^sf-kentro-antigrafo-[0-9a-f]{12}-\d{8}-\d{6}\.json\.gz$/.test(bk.name) && bk.files > 5, 'one-file copy of the data', bk.name + ' ' + bk.files);
    ok((await fetch(base + bk.url, { headers: { Cookie: c2 } })).status === 403, 'a staff user cannot download the copy even with its name');
    const gz = Buffer.from(await (await fetch(base + bk.url, { headers: { Cookie: cookie } })).arrayBuffer());
    const parsed = JSON.parse(require('zlib').gunzipSync(gz).toString('utf8'));
    ok(parsed.app === 'sf-kentro' && parsed.files.settings && !parsed.files.sessions, 'the copy has the data but not the open sessions');
    const up = await fetch(base + '/api/backup/upload', { method: 'POST', headers: H, body: JSON.stringify({ base64: gz.toString('base64') }) });
    ok(up.status === 200 && (await up.json()).files === bk.files, 'restore from the file');
    const junk = await fetch(base + '/api/backup/upload', { method: 'POST', headers: H, body: JSON.stringify({ base64: Buffer.from('not a copy').toString('base64') }) });
    ok(junk.status === 400 && /αντίγραφο/.test((await junk.json()).error), 'a wrong file is refused and nothing changes');

    await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: c2, 'X-SFK': t2 } });
    ok((await fetch(base + '/api/state', { headers: { Cookie: c2, 'X-SFK': t2 } })).status === 401, 'after logout the session is gone');
  } finally { child.kill(); }

  // "stay signed in": 2 hours without use end a normal session, not a remembered one (clock moved forward)
  const users = require(APP + '/lib/users');
  const adm = users.byId(users.list().find((x) => x.user === 'admin').id);
  const normal = users.startSession(adm, '127.0.0.1', 'test', false), kept = users.startSession(adm, '127.0.0.1', 'test', true);
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3;
  try { ok(!users.session(normal.sid) && !!users.session(kept.sid), '«Μείνε συνδεδεμένος»: 2 hours idle end only the normal session'); } finally { Date.now = realNow; }
  let msg = '';
  try { require(APP + '/lib/secrets').reveal('aes:' + Buffer.alloc(40, 7).toString('base64')); } catch (e) { msg = e.message; }
  ok(/άλλον υπολογιστή/.test(msg), 'a B2B password saved on another PC asks to be typed again (clear message)', msg);

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passes} ok, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
