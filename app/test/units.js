'use strict';
// SF Κέντρο — the parts that had no test of their own (checked 24/11): the network guard (DNS rebinding), the ads
// rules (what may be advertised), the PIN lock and the vault of passwords, the suppliers, the audit log.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dns = require('dns');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-units-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
delete process.env.SFK_ALLOW_PRIVATE;
delete process.env.SFK_TREAT_PUBLIC;

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);

(async () => {
  const store = require(APP + '/lib/store'); store.init();

  section('Δίκτυο: η διεύθυνση που ελέγχθηκε είναι αυτή που συνδέεται (DNS rebinding)');
  const H = require(APP + '/lib/http');
  const srv = http.createServer((q, r) => r.end('SECRET of this machine'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // a name that says «public» when it is checked, and «this machine» when the connection is made
  const real = dns.lookup;
  let n = 0;
  dns.lookup = (host, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (host !== 'rebind.example') return real(host, opts, cb);
    n++;
    const addr = n === 1 ? '93.184.216.34' : '127.0.0.1';
    return opts && opts.all ? cb(null, [{ address: addr, family: 4 }]) : cb(null, addr, 4);
  };
  let err = null, body = '';
  try { const r = await H.get(`http://rebind.example:${port}/`, { retries: 0, timeout: 5000 }); body = r.text; } catch (e) { err = e; }
  dns.lookup = real;
  ok(n >= 2 && err && err.private && !/SECRET/.test(body), 'a name that answers «public» to the check and «127.0.0.1» to the connection gets nothing', JSON.stringify([n, err && err.message, body.slice(0, 20)]));
  let e2 = null; try { await H.get(`http://127.0.0.1:${port}/`, { retries: 0, timeout: 5000 }); } catch (e) { e2 = e; }
  ok(e2 && e2.private, 'an address of this machine is refused (as before)');
  srv.close();
  ok(H.privateIp('10.1.2.3') && H.privateIp('169.254.169.254') && H.privateIp('::ffff:127.0.0.1') && !H.privateIp('93.184.216.34'), 'private ranges: LAN, the cloud\'s metadata, IPv6-mapped loopback — a public one passes');

  section('Cloudflare: ποιο μπλοκ, και η ανάγνωση του δικού μας site δεν χάνεται σε ένα όριο ρυθμού');
  {
    const hdr = (o) => ({ get: (k) => o[k.toLowerCase()] || null, keys: () => Object.keys(o)[Symbol.iterator]() });
    const cfh = { server: 'cloudflare', 'cf-ray': '8f00aa11bb22cc33-ATH' };
    const k1 = H.cloudflareOf(429, '<title>Access denied</title> error code: 1015', hdr(cfh));
    const k2 = H.cloudflareOf(403, '<h1>Error 1020</h1> Access denied', hdr(cfh));
    const k3 = H.cloudflareOf(403, '<title>Just a moment...</title>', hdr(Object.assign({ 'cf-mitigated': 'challenge' }, cfh)));
    const k4 = H.cloudflareOf(403, 'forbidden', hdr({ server: 'nginx' }));
    ok(k1.kind === 'rate' && k1.code === '1015' && k1.ray === '8f00aa11bb22cc33-ATH' && k2.kind === 'firewall' && k3.kind === 'challenge' && k4 === null, 'which Cloudflare mechanism: rate limit (1015), a firewall rule (1020), the «Just a moment» check; not Cloudflare = nothing', JSON.stringify([k1, k2.kind, k3.kind, k4]));
    process.env.SFK_ALLOW_PRIVATE = '1'; process.env.SFK_CF_WAITS = '50,50';
    let hits = 0, page2 = 0;
    const woo = http.createServer((q, r) => {
      hits++;
      const pg = Number(new URL(q.url, 'http://x').searchParams.get('page') || 1);
      // page 2 is refused twice by the «rate limit», then given
      if (pg === 2 && page2++ < 2) { r.writeHead(429, { server: 'cloudflare', 'cf-ray': 'abc-ATH', 'content-type': 'text/html' }); return r.end('<title>Access denied</title> error code: 1015'); }
      r.writeHead(200, { 'content-type': 'application/json', 'x-wp-total': '250', 'x-wp-totalpages': '3' });
      r.end(JSON.stringify(Array.from({ length: pg === 3 ? 50 : 100 }, (_, i) => ({ id: pg * 1000 + i }))));
    });
    await new Promise((r) => woo.listen(0, '127.0.0.1', r));
    delete require.cache[require.resolve(APP + '/lib/catalog')];
    const catalog = require(APP + '/lib/catalog');
    const waits = [];
    const res = await catalog.fetchAll(`http://127.0.0.1:${woo.address().port}`, 'products', '', { onWait: (ms, cf) => waits.push(cf.kind) });
    ok(res.items.length === 250 && waits.join() === 'rate,rate' && page2 === 3, 'a page refused by the rate limit: a pause and the same page again — the whole reading is not lost', JSON.stringify([res.items.length, waits, page2]));
    const fw = http.createServer((q, r) => { r.writeHead(403, { server: 'cloudflare', 'cf-ray': 'fw-ATH' }); r.end('<h1>Error 1020</h1> Access denied'); });
    await new Promise((r) => fw.listen(0, '127.0.0.1', r));
    let fe = null; const w2 = [];
    try { await catalog.fetchAll(`http://127.0.0.1:${fw.address().port}`, 'products', '', { onWait: () => w2.push(1) }); } catch (e) { fe = e; }
    ok(fe && fe.cf && fe.cf.kind === 'firewall' && !w2.length && /κανόνας firewall/.test(fe.message) && /fw-ATH/.test(fe.message), 'a firewall rule of the site (1020): said at once, with its Ray (waiting does not change it)', fe && fe.message);
    woo.close(); fw.close(); delete process.env.SFK_ALLOW_PRIVATE; delete process.env.SFK_CF_WAITS;
  }

  section('Ενημέρωση υπολογιστών: το cloud (Docker) έχει όλα τα αρχεία του πακέτου');
  {
    // 24/11: every update answered HTTP 400 — the image of the cloud had no worker.js / vendor, the pack could not be built
    const su = require(APP + '/lib/selfupdate');
    const docker = fs.readFileSync(path.join(APP, 'Dockerfile'), 'utf8');
    const copied = [...docker.matchAll(/^COPY\s+(.+?)\s+\S+\s*$/gm)].flatMap((m) => m[1].split(/\s+/));
    const img = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-img-'));
    for (const c of copied) { const from = path.join(APP, c); if (!fs.existsSync(from)) continue; fs.cpSync(from, path.join(img, c), { recursive: true }); }
    let pk = null, perr = null;
    try { pk = su.build(img, { forRev: '2026-11-24a' }); } catch (e) { perr = e; }
    ok(pk && pk.buf.length > 100000 && !perr, 'the pack of the computers is built from exactly the files the cloud image has (worker.js, lib, vendor)', perr && perr.message);
    const names = pk ? Object.keys(JSON.parse(require('zlib').gunzipSync(pk.buf).toString('utf8')).files) : [];
    ok(names.includes('worker.js') && names.includes('vendor/node-html-parser.js') && names.includes('lib/workerrev.js'), 'it has the worker, its HTML reader and its revision', names.filter((n) => !n.startsWith('lib/')).join(','));
    fs.rmSync(img, { recursive: true, force: true });
  }

  section('Διαφημίσεις: τι επιτρέπεται σε Google / Meta');
  const ad = require(APP + '/lib/adrules');
  const ev = (name, cats, brand) => ad.evaluate({ name, brand: brand || '' }, cats ? [cats.map((c) => ({ name: c, slug: c.toLowerCase() }))] : []);
  ok(ev('ΠΙΣΤΟΛΙ GLOCK 17 GEN5', ['ΟΠΛΑ', 'ΠΙΣΤΟΛΙΑ']).level === 'banned', 'a pistol in the weapons category: banned on Google and Meta');
  ok(ev('ΟΠΛΟΚΙΒΩΤΙΟ RIEFFEL 5 ΟΠΛΩΝ', ['ΟΠΛΑ', 'ΟΠΛΟΚΙΒΩΤΙΑ']).level === 'ok', 'a gun safe, even inside the weapons category: allowed (the safe rule comes first)');
  ok(ev('ΦΥΣΙΓΓΙΑ FEDERAL 12ΒΟΛΑ', ['ΦΥΣΙΓΓΙΑ']).level === 'banned', 'ammunition: banned');
  ok(ad.rank('banned') > ad.rank('google') && ad.rank('google') > ad.rank('ok'), 'the levels in order (banned > not Google > allowed)');
  const tac = ev('ΣΑΚΙΔΙΟ 5.11 TACTICAL RUSH 12', ['ΣΑΚΙΔΙΑ'], '5.11 TACTICAL');
  ok(tac.level !== 'banned', 'the brand «5.11 TACTICAL» is not a weapon word (a backpack stays allowed)', JSON.stringify(tac));

  section('Κλείδωμα με PIN και θησαυροφυλάκιο κωδικών');
  const sec = require(APP + '/lib/security');
  let pe = null; try { sec.setPin('123456'); } catch (e) { pe = e; }
  ok(pe && /εύκολο/.test(pe.message), 'an easy PIN (123456) is refused');
  sec.setPin('7391-alpha');
  ok(sec.hasPin() && !sec.isLocked(), 'a PIN is set; the program stays open for the one who set it');
  const saved = JSON.stringify(store.read('security'));
  ok(!saved.includes('7391-alpha') && /"hash"/.test(saved), 'the PIN itself is never kept: only its slow hash');
  const blob = sec.wrap('b2b-pass-xyz');
  ok(blob !== 'b2b-pass-xyz' && sec.unwrap(blob) === 'b2b-pass-xyz', 'a supplier\'s password is sealed with the PIN and opened again');
  sec.lock();
  ok(sec.isLocked(), 'locked');
  let we = null; try { sec.unlock('wrong-pin-1'); } catch (e) { we = e; }
  ok(we && /Λάθος PIN/.test(we.message) && sec.isLocked(), 'a wrong PIN: refused, stays locked');
  ok(sec.unlock('7391-alpha') && !sec.isLocked(), 'the right PIN opens it');
  sec.removePin('7391-alpha');
  ok(!sec.hasPin(), 'the PIN can be removed (with the PIN)');

  section('Αντιπρόσωποι');
  const sup = require(APP + '/lib/suppliers');
  let se = null; try { sup.save({ name: '   ' }); } catch (e) { se = e; }
  ok(se && /υποχρεωτικό/.test(se.message), 'a supplier without a name is refused');
  const s1 = sup.save({ name: 'Αντιπρόσωπος Α', brands: 'PENTAGON, MIL-TEC ,PENTAGON', markup: '', code: 'ab-12!' }).supplier;
  ok(s1.brands.join() === 'PENTAGON,MIL-TEC' && s1.markup === 80 && s1.code === 'AB12', 'brands without doubles, the default markup 80%, a clean short code', JSON.stringify([s1.brands, s1.markup, s1.code]));
  const r2 = sup.save({ name: 'Αντιπρόσωπος Β', brands: ['PENTAGON'] });
  const s2 = r2.supplier;
  ok(r2.clashes.length === 1 && r2.clashes[0].brand === 'PENTAGON', 'the same brand at two suppliers is said when it is saved (who brings it?)', JSON.stringify(r2.clashes));
  ok(!JSON.stringify(sup.view(Object.assign({}, s2, { b2bPass: 'x' }))).includes('"b2bPass"'), 'a supplier\'s B2B password never goes back to the screen');
  const info = require(APP + '/lib/supplierinfo');
  ok(info.normPhone('+30 210 1234567') === '210 123 4567' && info.normPhone('6971234567') === '697 123 4567' && info.normPhone('12') === '', 'phone numbers: +30 taken off, grouped; a broken one is left empty');

  section('Ιστορικό ενεργειών');
  const audit = require(APP + '/lib/audit');
  const sm = audit.summary({ password: 'p', token: 't', ids: [1, 2, 3, 4, 5, 6, 7], name: 'Χ', obj: { a: 1 } });
  ok(!('password' in sm) && !('token' in sm) && sm.ids === '7 στοιχεία' && sm.name === 'Χ' && sm.obj === '…', 'what is written: no password or token, counts instead of long lists', JSON.stringify(sm));
  await audit.record('alex', 'έγκριση', 'sf:1', { n: 1 });
  const l = await audit.list(5);
  ok(Array.isArray(l) && l[0] && l[0].actor === 'alex' && l[0].action === 'έγκριση', 'who did what and when is kept');


  section('Ακρίβεια & εκμάθηση: πόσες από τις 100 αντιστοιχίες είναι σωστές, μετρημένο από τους ελέγχους σου');
  {
    const catalog = require(APP + '/lib/catalog');
    const acc = require(APP + '/lib/accuracy');
    const market = require(APP + '/lib/market');
    const prods = Array.from({ length: 12 }, (_, i) => catalog.fromStoreApi({ id: 100 + i, name: 'ΣΑΚΙΔΙΟ PENTAGON MODEL' + i + ' ΜΑΥΡΟ', slug: 's' + i, type: 'simple', permalink: 'https://shop.example/s' + i, sku: 'K' + (100 + i), prices: { price: '5000', regular_price: '5000', currency_minor_unit: 2 }, images: [], categories: [], is_in_stock: true }));
    store.write('catalog-sf', { syncedAt: new Date().toISOString(), source: 'api', products: prods, categories: [] });
    store.write('catalog-st', { syncedAt: new Date().toISOString(), source: 'api', products: [], categories: [] });
    const offer = (host, i, o) => Object.assign({ shop: host, competitorId: host, url: `https://${host}/p${i}`, name: 'Pentagon Model' + i + ' Black', price: 49, inStock: true, match: 'exact', how: 'sku', ev: ['ίδιος κωδικός'], score: 1, country: 'GR', seenAt: new Date().toISOString() }, o || {});
    const m = {};
    for (let i = 0; i < 12; i++) m['sf:' + (100 + i)] = { at: new Date().toISOString(), competitors: [offer('good.gr', i), offer('bad.gr', i), offer('sim.gr', i, { match: 'similar', how: 'words' })] };
    store.write('market', m);
    const smp = acc.sample(10);
    ok(smp.rows.length === 10 && smp.left === 24 && smp.rows.every((r) => r.prog.match === 'exact' && r.ours.name && r.theirs.url), 'the sample: 10 matches the program counts by itself (never the «similar» ones), at random, with ours next to theirs', JSON.stringify([smp.rows.length, smp.left]));
    // the owner checks: good.gr always right, bad.gr wrong 3 of 4
    for (let i = 0; i < 4; i++) acc.check({ k: 'sf:' + (100 + i), url: `https://good.gr/p${i}`, verdict: 'yes', sample: true }, 'alex');
    for (let i = 0; i < 4; i++) acc.check({ k: 'sf:' + (100 + i), url: `https://bad.gr/p${i}`, verdict: i ? 'no' : 'yes', reason: i === 1 ? 'variant' : 'other', sample: true }, 'alex');
    acc.check({ k: 'sf:104', url: 'https://good.gr/p4', verdict: 'unsure', sample: true }, 'alex');
    const sb = acc.scoreboard();
    ok(sb.sample.n === 8 && sb.sample.yes === 5 && sb.sample.unsure === 1 && sb.sample.p === 62.5 && sb.sample.low < 62.5 && sb.sample.high > 62.5, 'the answer: 5 of 8 right = 62.5%, with its margin (few checks = wide margin); «not sure» does not count', JSON.stringify(sb.sample));
    ok(sb.wrongKinds.all === 3 && sb.wrongKinds.variant === 1, '«another colour / size» is a «no» (it counts as a mistake) and is told apart from «another product»', JSON.stringify(sb.wrongKinds));
    ok(acc.sample(30).rows.every((r) => !(r.k === 'sf:100' && /good\.gr/.test(r.theirs.url))), 'a checked match is not asked again');
    ok(sb.doubtShops.includes('bad.gr') && !sb.doubtShops.includes('good.gr'), 'it learns: a shop with 3 wrong of 4 is no longer believed by itself', JSON.stringify(sb.doubtShops));
    const e5 = market.compute('sf', catalog.byId('sf').get(105), store.read('market')['sf:105']);
    const b5 = e5.competitors.find((c) => /bad\.gr/.test(c.url)), g5 = e5.competitors.find((c) => /good\.gr/.test(c.url));
    ok(b5 && b5.flag === 'doubt' && !b5.used && /λάθος 3 από 4/.test(b5.note) && g5 && g5.flag !== 'doubt', 'its matches on other products now wait for a yes (their price does not count by itself); the good shop\'s still count', JSON.stringify([b5 && b5.flag, b5 && b5.note, g5 && g5.flag]));
    const md = store.read('market-decisions');
    ok(md['sf:102'] && md['sf:102'].no.includes('https://bad.gr/p2') && md['sf:101'].variant.includes('https://bad.gr/p1') && md['sf:100'].yes.includes('https://good.gr/p0') && !md['sf:104'], '«Άλλο προϊόν» here is «Όχι ίδιο» of Τιμές, «Ίδιο» the same «Ίδιο», «Άλλο χρώμα» kept as another colour; «not sure» changes nothing');
    // a person's yes / no in Τιμές is kept too, with what the program had said («similar» → it was the same)
    market.decide('sf', 106, 'https://sim.gr/p6', 'yes', { by: 'alex' });
    const sb2 = acc.scoreboard();
    ok(sb2.confirmations.n === 1 && sb2.confirmations.yes === 1, 'the answers in Τιμές count too («similar» that was the same)', JSON.stringify(sb2.confirmations));
    const d = acc.dossier('sf', 101);
    ok(d.rows.length === 3 && d.rows[0].prog.match === 'exact' && d.rows.some((r) => r.check && r.check.verdict === 'no'), 'one product: every match with what the program decided, why, and the owner\'s answer', JSON.stringify(d.rows.map((r) => [r.theirs.shop, r.prog.match, r.check && r.check.verdict])));
    // the AI's second opinion (a fake AI here: «no» for sim-looking shop bad.gr, «yes» otherwise)
    const judge = async (r) => ({ verdict: /bad\.gr/.test(r.theirs.url) ? 'no' : 'yes', why: 'δοκιμή', model: 'fake' });
    const ar = await acc.aiRound(50, { judge });
    const sb3 = acc.scoreboard();
    ok(ar.judged === 15 && sb3.ai.n === 15 && sb3.ai.doubts > 0, 'the AI judges the matches nobody judged (not those you answered), kept apart from yours', JSON.stringify([ar, sb3.ai.n, sb3.ai.doubts]));
    ok(acc.aiDoubts(20).every((r) => /bad\.gr/.test(r.theirs.url) && r.ai.verdict === 'no'), 'the AI\'s «no» are shown to you first (outside the random sample)');
    ok(!acc.aiAgreement().proven, 'the AI does not count in what is learned before it has agreed with you on ≥20 matches');
    const keepAi = store.read('match-checks').ai; store.update('match-checks', {}, (d) => { d.ai = {}; return d; });
    let bad = 0; const ar2 = await acc.aiRound(5, { judge: async () => { if (++bad >= 2) throw new Error('Ollama off'); return { verdict: 'yes', why: '', model: 'fake' }; } });
    ok(ar2.judged === 1 && /Ollama off/.test(ar2.error), 'an AI that stops answering: the round stops at once and says why');
    store.update('match-checks', {}, (d) => { d.ai = keepAi; return d; });
    // the certainty of proposals corrected by what happened: «sure» photos approved 14 of 20 → 70%, no longer sure
    const dec = {};
    for (let i = 0; i < 20; i++) dec['sf:' + i + ':images'] = { status: i < 14 ? 'approved' : 'rejected', cf: 94, fd: 'images', og: 'sources', at: new Date().toISOString() };
    for (let i = 0; i < 25; i++) dec['sf:' + i + ':brand'] = { status: 'approved', cf: 92, fd: 'brand', og: 'sources', at: new Date().toISOString() };
    store.write('fixes', dec);
    await new Promise((r) => setTimeout(r, 5));
    const ac2 = require(APP + '/lib/accuracy');
    ac2.record({ k: 'sf:111', url: 'https://x.gr/1', verdict: 'unsure' }); // (clears the memo)
    const ci = ac2.calibrationFor('images', 94), cb = ac2.calibrationFor('brand', 92);
    ok(ci && ci.p === 70 && ci.n === 20 && cb && cb.p === 100 && !ac2.calibrationFor('gtin', 95), 'measured: «sure» photos approved 70% (20), brands 100% (25); a kind with too few answers is not touched', JSON.stringify([ci, cb]));
    const fixes = require(APP + '/lib/fixes');
    const c = { site: 'sf', pid: 1, field: 'images', to: ['x'], level: 'high', source: { kind: 'web', label: 'x' }, sources: [{ kind: 'web' }] };
    fixes.finishForTest(c);
    ok(c.confidence === 70 && c.level === 'medium' && c.confidence0 >= 90 && /εγκρίθηκαν 14 από 20/.test(c.why), 'a «sure» photo proposal now says 70% and is «look at it» (not in «approve all sure»), with why', JSON.stringify([c.confidence, c.confidence0, c.level, c.why]));
    const cb2 = { site: 'sf', pid: 1, field: 'brand', to: 'X', level: 'high', source: { kind: 'competitor', label: 'x' }, sources: [{ kind: 'competitor' }] };
    fixes.finishForTest(cb2);
    ok(cb2.level === 'high' && !cb2.calibrated, 'a kind that is approved as often as said stays as it is (only ever more careful)');
    // undo (asked 24/11): an answer taken back no longer counts, and the match is as the program had it
    const before = acc.scoreboard().sample.n;
    const hist = acc.recent(100);
    ok(hist.length >= 9 && hist[0].product && hist.every((x, i) => !i || x.at <= hist[i - 1].at), 'the history: every answer, newest first, with the product', JSON.stringify(hist.slice(0, 2).map((x) => [x.product, x.verdict])));
    const u = acc.undo({ k: 'sf:101', url: 'https://bad.gr/p1' }, 'alex');
    const md2 = store.read('market-decisions');
    const e1 = store.read('market')['sf:101'].competitors.find((c) => c.url === 'https://bad.gr/p1');
    ok(u.was === 'no' && acc.scoreboard().sample.n === before - 1 && !(md2['sf:101'] && md2['sf:101'].no.includes('https://bad.gr/p1')) && e1 && !e1.ignored, 'undo: it no longer counts, «Όχι ίδιο» is taken off in Τιμές too, the page counts again as the program had it', JSON.stringify([u, e1 && e1.ignored]));
    ok(!acc.recent(100).some((x) => x.k === 'sf:101' && x.url === 'https://bad.gr/p1'), 'and it leaves the history (it can be answered again)');
    // another colour of the same model (24/11): not thrown away — evaluated, and a sign when our colour is at too few shops
    {
      const p8 = catalog.byId('sf').get(108);
      const fam = (host, o) => offer(host, 8, Object.assign({ match: 'family', why: 'άλλο χρώμα', name: 'Pentagon Model8 Olive' }, o));
      const e8 = market.compute('sf', p8, { at: new Date().toISOString(), competitors: [offer('good.gr', 8), fam('olive1.gr', { variantOk: true }), fam('olive2.gr', { vSame: true }), fam('olive3.gr'), fam('olive4.gr', { vSame: true, inStock: false })] });
      const f = (h) => e8.competitors.find((c) => c.url.includes(h));
      ok(f('good.gr').flag === 'used' && f('olive1.gr').flag === 'variant' && f('olive2.gr').flag === 'variant' && f('olive3.gr').flag === 'family' && f('olive4.gr').flag === 'family',
        'our colour at 1 shop: other colours count as a sign when evaluated (★ you said same model, ★★ one price for all colours), never without evaluation or out of stock', JSON.stringify(e8.competitors.map((c) => [c.shop, c.flag])));
      ok(/★/.test(f('olive2.gr').note) && e8.stats.variants === 2 && e8.stats.count === 3, 'shown apart, with its evaluation, and counted in the market', JSON.stringify([f('olive2.gr').note, e8.stats.variants, e8.stats.count]));
      const e9 = market.compute('sf', p8, { at: new Date().toISOString(), competitors: [offer('good.gr', 8), offer('bad2.gr', 8), fam('olive2.gr', { vSame: true })] });
      ok(e9.competitors.find((c) => c.url.includes('olive2')).flag === 'family', 'our own colour at 2 shops or more: the other colours stay information only');
      // the answer «Άλλο χρώμα / μέγεθος» → evaluated (★), and an undo gives back what the program had said
      acc.check({ k: 'sf:107', url: 'https://good.gr/p7', verdict: 'no', reason: 'variant' }, 'alex');
      const c7 = store.read('market')['sf:107'].competitors.find((c) => c.url === 'https://good.gr/p7');
      ok(c7.match === 'family' && c7.variantOk && !c7.ignored && store.read('market-decisions')['sf:107'].variant.includes('https://good.gr/p7'), '«Άλλο χρώμα / μέγεθος»: kept as the same model in another colour (its price evaluated), not thrown away', JSON.stringify([c7.match, c7.variantOk, c7.ignored]));
      // an answer «Άλλο χρώμα / μέγεθος» given with the older version (kept as «Όχι ίδιο» by Τιμές) is moved at start
      market.decide('sf', 109, 'https://good.gr/p9', 'no', { noRecord: true });
      acc.record({ k: 'sf:109', url: 'https://good.gr/p9', verdict: 'no', reason: 'variant', by: 'alex' });
      const moved = acc.migrateVariants();
      const c9 = store.read('market')['sf:109'].competitors.find((c) => c.url === 'https://good.gr/p9');
      ok(moved >= 1 && c9.match === 'family' && c9.variantOk && !c9.ignored && acc.migrateVariants() === 0, 'answers «another colour» of the older version are moved once (their price evaluated, no longer thrown away)', JSON.stringify([moved, c9.match, c9.ignored]));
      acc.undo({ k: 'sf:107', url: 'https://good.gr/p7' }, 'alex');
      const c7b = store.read('market')['sf:107'].competitors.find((c) => c.url === 'https://good.gr/p7');
      ok(c7b.match === 'exact' && !c7b.variantOk && !(store.read('market-decisions')['sf:107'] || {}).variant, 'undo: back to what the program had said', JSON.stringify([c7b.match, c7b.variantOk]));
    }
    ok(acc.wilson(98, 100).low > 92 && acc.wilson(3, 3).low < 45, 'the margin: 98 of 100 → at least ~93%; 3 of 3 says little (from ~44%)', JSON.stringify([acc.wilson(98, 100), acc.wilson(3, 3)]));
  }

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
