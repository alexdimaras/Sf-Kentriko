'use strict';
process.env.SFK_ALLOW_PRIVATE = '1';
// SF Κέντρο — families and variants, the whole way, with REAL data of specialforces.gr (test/fixtures: the MIL-TEC
// products as the shop's API gives them, and two product pages as Yoast / WooCommerce produce them, 18/11/2026):
//   the same model in another colour = «the same family, another variant» — never its code, EAN, photo or price;
//   photos only of OUR variant; the family of separate products and the files that make it one page with colours;
//   the page as Google reads it; the optional search APIs; the AI with structured answers (JSON Schema), checked.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const APP = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-variants-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
process.env.SFK_SEARCH_FAST = '1';
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
delete process.env.SFK_OLLAMA_URL;

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);
const W = (n, v) => fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v));
const now = new Date().toISOString();
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + srv.address().port)));

(async () => {
  const store = require(APP + '/lib/store'); store.init();
  const catalog = require(APP + '/lib/catalog');
  const market = require(APP + '/lib/market');
  const cf = require(APP + '/lib/codefind');
  // the real MIL-TEC products of the shop, read the way the program reads them
  const real = JSON.parse(fs.readFileSync(path.join(FX, 'sf-miltec-products.json'), 'utf8')).map((p) => catalog.fromStoreApi(p));
  W('catalog-sf', { syncedAt: now, source: 'api', products: real, categories: [] });
  W('catalog-st', { syncedAt: now, source: 'api', products: [], categories: [] });
  W('settings', { sites: { sf: { url: 'https://specialforces.gr', name: 'Special Forces' }, st: { url: 'https://stratiotikaeidi.gr', name: 'Στρατιωτικά Είδη' } } });
  const olive = real.find((p) => p.sku === '14002001');
  const black = real.find((p) => p.sku === '14002002');
  ok(olive && black && olive.name === 'ΣΑΚΙΔΙΟ MIL-TEC ASSAULT MOLLE OLIVE SMALL' && !olive.brand && black.brand === 'MILTEC', 'the real products: the olive bag has no brand on the site, the black one has «MILTEC»', JSON.stringify([olive && olive.brand, black && black.brand]));

  section('Ίδια παραλλαγή / ίδια οικογένεια / παρόμοιο / άλλο');
  const ours = { name: olive.name, brand: 'MIL-TEC', sku: '' };
  const m = (name, extra) => market.score(ours, Object.assign({ name, brand: 'Mil-Tec' }, extra || {}));
  ok(m('Σακίδιο Mil-Tec Assault Molle Small Olive').match === 'exact', 'brand + every model word + OUR colour → the same variant (also with words that alone are «general»: ASSAULT MOLLE SMALL)');
  const fb = m('Σακίδιο Mil-Tec Assault Molle Small Black');
  ok(fb.match === 'family' && /BLACK/.test(fb.why) && /OLIVE/.test(fb.why), 'the black one → the same family, another variant (said which)', JSON.stringify(fb));
  ok(m('Σακίδιο Mil-Tec US Assault Molle Small Olive').match === 'similar' && m('Mil-Tec Assault Molle Large Olive').match !== 'exact', 'US / LARGE: not the same (another model or size)');
  const kf = market.score({ name: 'ΣΑΚΙΔΙΟ HELIKON-TEX RACCOON MK2 COYOTE', brand: 'HELIKON-TEX', sku: 'PL-RCN-CD-11' }, { name: 'Helikon-Tex Raccoon Mk2 Olive Green', brand: 'Helikon-Tex', sku: 'PL-RCN-CD-02' });
  ok(kf.match === 'family', 'two codes of one model that differ where the colour differs (-11 coyote / -02 olive) → the same family', JSON.stringify(kf));
  ok(market.score({ name: 'ΣΑΚΙΔΙΟ PENTAGON KYLER ΜΑΥΡΟ', brand: 'PENTAGON', sku: 'K16110-01' }, { name: 'Pentagon Kyler Black', brand: 'Pentagon', sku: 'K16110-01' }).match === 'exact', 'the whole code and the colour → the same variant');
  // in the price research: another variant's price is shown, never counted (only after a person's yes)
  const st = market.stats([
    { shop: 'a', price: 35, match: 'exact', inStock: true, seenAt: now, country: 'GR' },
    { shop: 'b', price: 29, match: 'family', inStock: true, seenAt: now, country: 'GR', why: 'άλλη παραλλαγή' },
    { shop: 'c', price: 31, match: 'family', confirmed: true, inStock: true, seenAt: now, country: 'GR' }], {});
  ok(st.count === 1 && st.family === 2, 'the price of another colour does not count…', JSON.stringify(st));
  const st2 = market.stats([{ shop: 'c', price: 31, match: 'exact', confirmed: true, inStock: true, seenAt: now, country: 'GR' }], {});
  ok(st2.count === 1, '…until a person says «the same» (then it is that price for ours too)');
  {
    // a competitor's price written by hand counts 14 days, or with no end when asked (audit 23/11, P1)
    const day = 864e5, iso = (ms) => new Date(Date.now() + ms).toISOString();
    const M = (o) => Object.assign({ price: 30, match: 'exact', inStock: true, manual: true, country: 'GR' }, o);
    const list = [M({ shop: 'fresh', at: iso(-day), expires: iso(13 * day) }), M({ shop: 'ended', at: iso(-20 * day), expires: iso(-6 * day) }),
      M({ shop: 'old-no-date', at: iso(-20 * day) }), M({ shop: 'no-end', at: iso(-200 * day), expires: null })];
    const sm = market.stats(list, {});
    const f = Object.fromEntries(list.map((c) => [c.shop, c.flag]));
    require(APP + '/lib/settings').save({ minShops: 1 });
    ok(require(APP + '/lib/settings').all().minShops === 2, 'one shop alone never moves a price: «at least 1 shop» is not accepted (stays 2)');
    const cc = market.catalogCoverage([]);
    ok(cc.whole === 0 && cc.of === 0 && Array.isArray(cc.partial), 'the coverage of the catalogs is told apart from the comparison');
    ok(sm.count === 2 && f.fresh === 'used' && f['no-end'] === 'used' && f.ended === 'stale' && f['old-no-date'] === 'stale' && /έληξε/.test(list[1].note), 'a hand-written price counts until its end (14 days; an older one without a date too), «no end» counts on', JSON.stringify(f));
  }

  section('Φωτογραφίες: μόνο της δικής μας παραλλαγής');
  const OL = market.coloursOf(olive.name);
  const pageMany = { name: 'Mil-Tec Assault Pack Small', images: ['https://s.gr/i/olive-front.jpg', 'https://s.gr/i/black-front.jpg', 'https://s.gr/i/coyote.jpg'], variants: [
    { color: 'Olive', images: ['https://s.gr/i/v-olive.jpg'], inStock: true, price: 35 }, { color: 'Black', images: ['https://s.gr/i/v-black.jpg'], inStock: true, price: 35 }, { color: 'Coyote', images: [], inStock: false, price: 33 }] };
  const iv = cf.imagesForVariant(pageMany, OL);
  ok(iv.how === 'variant' && iv.images.includes('https://s.gr/i/v-olive.jpg') && !iv.images.some((u) => /black|coyote/.test(u)), 'a page of three colours: the olive variant\'s photo (and the gallery photo named olive), never black / coyote', JSON.stringify(iv));
  const noOwn = cf.imagesForVariant({ name: 'X', images: ['https://s.gr/a1.jpg', 'https://s.gr/a2.jpg'], variants: [{ color: 'Olive', images: [] }, { color: 'Black', images: [] }] }, OL);
  ok(noOwn.how === 'none' && !noOwn.images.length, 'colours without their own photos, photos that cannot be told apart → no photo at all (never a guess)');
  const ourNone = cf.imagesForVariant(pageMany, new Set());
  ok(!ourNone.images.length, 'our title names no colour, the page has three → no photo');
  const realFile = 'https://specialforces.gr/wp-content/uploads/2025/08/20191104130707_mil_tec_backpack_us_assault_small_olive_20lt.jpeg';
  ok(cf.fileColours(realFile).has('OLIVE') && cf.fileColours('https://x/schwarz_front.jpg').has('BLACK'), 'the colour written in a real maker\'s file name (…_small_olive_20lt.jpeg, schwarz) is read');
  const one = cf.imagesForVariant({ name: 'Mil-Tec Assault Pack Small Olive', images: [realFile, 'https://x/assault_black.jpg', 'https://x/detail2.jpg'] }, OL);
  ok(one.how === 'page' && one.images.includes(realFile) && !one.images.some((u) => /black/.test(u)), 'a one-colour page in our colour: its photos, minus a photo whose file says another colour', JSON.stringify(one));
  const noCol = cf.imagesForVariant({ name: 'Mil-Tec Assault Pack Small', images: ['https://x/a1.jpg', realFile] }, OL);
  ok(noCol.how === 'filename' && noCol.images.length === 1 && noCol.images[0] === realFile, 'a page that names no colour: only the photo whose file says olive');

  section('Έρευνα: η άλλη παραλλαγή κρατιέται χωριστά, οι πηγές κάθε τιμής');
  const PAGES = {
    'https://shop1.gr/olive': { name: 'Σακίδιο Mil-Tec Assault Molle Small Olive', brand: 'Mil-Tec', sku: '14002001', ean: '4046872181429', price: 34.9, availability: 'in', images: [realFile], isProduct: true },
    'https://shop1.gr/black': { name: 'Σακίδιο Mil-Tec Assault Molle Small Black', brand: 'Mil-Tec', sku: '14002002', price: 34.9, availability: 'in', images: ['https://shop1.gr/i/14002002_black.jpg'], isProduct: true },
    'https://shop2.de/assault': Object.assign({ isProduct: true, brand: 'Mil-Tec', price: 0, availability: 'in' }, { name: 'Mil-Tec US Assault Pack SM', variants: [
      { color: 'Oliv', sku: '14002001', ean: '4046872181429', price: 29.9, inStock: true, images: ['https://shop2.de/i/oliv.jpg'] }, { color: 'Schwarz', sku: '14002002', ean: '4046872181436', price: 29.9, inStock: true, images: ['https://shop2.de/i/schwarz.jpg'] }], images: ['https://shop2.de/i/oliv.jpg', 'https://shop2.de/i/schwarz.jpg'], currency: 'EUR' }),
    'https://shop3.gr/black-only': { name: 'Mil-Tec Assault Molle Small Μαύρο', brand: 'Mil-Tec', sku: '', price: 33, availability: 'in', images: ['https://shop3.gr/i/1.jpg'], isProduct: true },
    'https://www.mil-tec.de/assault': { name: 'US Assault Pack SM', brand: 'Mil-Tec', variants: [{ color: 'Oliv', sku: '14002001', images: ['https://www.mil-tec.de/i/14002001.jpg'], inStock: true, price: 0 }, { color: 'Schwarz', sku: '14002002', images: ['https://www.mil-tec.de/i/14002002.jpg'], inStock: true, price: 0 }], images: [], isProduct: true },
  };
  const io = { own: new Set(['specialforces.gr']), compHosts: new Set(['shop1.gr']), supplierHosts: new Set(), limits: { maxQueries: 6, minQueries: 3 },
    search: async () => Object.assign(Object.keys(PAGES).map((url) => ({ url, title: PAGES[url].name })), { engines: [{ id: 'ddg', state: 'ok', n: 5 }] }), page: async (url) => Object.assign({ url }, PAGES[url]) };
  const r = await cf.lookUp({ k: 'sf:' + olive.id, name: olive.name, brand: '', sku: '14002001', ean: '', price: 35, needs: ['ean', 'images', 'price', 'brand'] }, io);
  const hosts = r.hits.map((h) => h.host).sort();
  ok(hosts.join() === 'mil-tec.de,shop1.gr,shop2.de', 'the same variant at 3 sites (the shop\'s olive page, a German page with variants, the maker\'s page)', JSON.stringify(hosts));
  const h2 = r.hits.find((h) => h.host === 'shop2.de');
  ok(h2 && h2.ean === '4046872181429' && h2.price === 29.9 && h2.images.length === 1 && /oliv\.jpg$/.test(h2.images[0]), 'from the page with variants: the EAN, price and photo of the OLIVE variant only', JSON.stringify(h2));
  ok(r.family.some((f) => f.host === 'shop1.gr' && /black/.test(f.url)) && r.family.some((f) => f.host === 'shop3.gr'), 'the black pages are «the same family, another variant» (kept apart)', JSON.stringify(r.family.map((f) => f.url)));
  ok(!r.hits.some((h) => /black|schwarz|14002002/.test(JSON.stringify(h.images) + h.code + h.ean)), 'no code, EAN or photo of the black variant reached the olive one');
  const mk = r.hits.find((h) => h.host === 'mil-tec.de');
  ok(mk && mk.cls === 'maker' && r.hits.find((h) => h.host === 'shop1.gr').cls === 'competitor', 'the sites are classed: the maker (mil-tec.de), a known competitor, a new shop');
  cf.save({ ['sf:' + olive.id]: r });
  const tr = cf.traceFor('sf:' + olive.id, { per: 2, page: 1 });
  ok(tr.pages.length === 2 && tr.totals.pages >= 5 && tr.totals.results >= 5 && tr.hits.length === 3 && tr.family.length >= 2, 'the detail is kept whole and given page by page (2 per page here)', JSON.stringify(tr.totals));
  const tr2 = cf.traceFor('sf:' + olive.id, { per: 2, page: 2 });
  ok(tr2.pages.length === 2 && tr2.pages[0].url !== tr.pages[0].url, 'page 2 of the pages read');

  section('Οικογένειες του καταλόγου (πραγματικά προϊόντα MIL-TEC)');
  const fam = require(APP + '/lib/families');
  const list = fam.list('sf');
  const assault = list.find((f) => f.title === 'ΣΑΚΙΔΙΟ MIL-TEC ASSAULT MOLLE SMALL');
  ok(assault && assault.members.map((x) => x.sku).sort().join() === '14002001,14002002' && assault.colours.sort().join() === 'BLACK,OLIVE', 'ΣΑΚΙΔΙΟ MIL-TEC ASSAULT MOLLE SMALL: olive (14002001) + black (14002002), the olive one without brand on the site', JSON.stringify(assault));
  ok(!list.some((f) => f.members.some((x) => x.sku === '14002088')), '«…TACTICAL US SMALL» is NOT put in it (another model word, no colour)');
  ok(list.every((f) => new Set(f.members.map((x) => x.colour)).size === f.members.length), 'every family: one colour per member');
  ok(assault.confidence >= 90 && assault.evidence.some((e) => /κοινή αρχή/.test(e)), 'its codes share their beginning (14002…): more sure', JSON.stringify(assault.evidence));
  ok(assault.proof === 'confirmed' && assault.proofSources.length >= 2 && assault.proofSources.every((x) => x.colours.length >= 2), 'confirmed family: ≥2 independent shops show the model in two colours (from the research above)', JSON.stringify(assault.proofSources));
  {
    // the 19/11 rule: with less than 2 independent shops it is only «πιθανή οικογένεια» — no approval, no files
    const st = require(APP + '/lib/store');
    const saved = st.read('web-codes', null);
    const k = 'sf:' + olive.id;
    st.write('web-codes', { products: { [k]: { hits: [{ host: 'shop1.gr', url: 'https://shop1.gr/olive' }], family: [{ host: 'www.shop1.gr', url: 'https://shop1.gr/black', colour: 'black' }, { host: 'eshop.shop1.gr', url: 'https://eshop.shop1.gr/black', colour: 'black' }] } } });
    const pf = fam.list('sf').find((f) => f.key === assault.key);
    ok(pf.proof === 'possible' && pf.proofWord === 'πιθανή οικογένεια' && pf.proofSources.length === 1, 'one shop only (three addresses of shop1.gr = one source) → «πιθανή οικογένεια»', JSON.stringify(pf.proofSources));
    let no1 = null; try { fam.decide('sf', assault.key, 'approved', 'test'); } catch (e) { no1 = e; }
    ok(no1 && /Πιθανή οικογένεια/.test(no1.message), 'a possible family cannot be approved');
    let no2 = null; try { fam.exportFiles('sf', assault.key, {}); } catch (e) { no2 = e; }
    ok(no2 && /Πιθανή οικογένεια/.test(no2.message), 'no conversion files for a possible family');
    st.write('web-codes', { products: { [k]: { hits: [{ host: 'specialforces.gr', url: 'https://specialforces.gr/a' }], family: [{ host: 'stratiotikaeidi.gr', url: 'https://stratiotikaeidi.gr/b', colour: 'black', variants: [{ colour: 'olive' }, { colour: 'black' }] }] } } });
    ok(fam.list('sf').find((f) => f.key === assault.key).proof === 'possible', 'our own two sites never count as proof');
    st.write('web-codes', saved);
  }
  let refused = null; try { fam.exportFiles('sf', assault.key, {}); } catch (e) { refused = e; }
  ok(refused && /έγκρινε/.test(refused.message), 'no files before a person approves the family');
  fam.decide('sf', assault.key, 'approved', 'test');
  const ex = fam.exportFiles('sf', assault.key, { variantSkus: 'own', parentSku: '14002000-FAM' });
  const [f1, f2, f3] = ex.files.map((x) => x.csv.replace(/^﻿/, ''));
  ok(/ID,SKU,Published/.test(f1.split('\n')[0]) && f1.split('\n').filter((l) => /,-1/.test(l)).length === 2, 'file 1: the two old products → draft, without code (kept, not deleted)', f1);
  // (the description holds line breaks inside quotes: the rows are found by their first cells)
  const vrows = f2.split('\n').filter((l) => /^variation,/.test(l));
  ok(/\nvariable,14002000-FAM,,ΣΑΚΙΔΙΟ MIL-TEC ASSAULT MOLLE SMALL,/.test(f2) && vrows.length === 2 && vrows.every((l) => l.startsWith('variation,140020')), 'file 2: one variable product + 2 variations, each with its own code (mode «own»)', vrows.join('\n'));
  const vOl = vrows.find((l) => l.includes('14002001')), vBl = vrows.find((l) => l.includes('14002002'));
  ok(/Λαδί/.test(vOl) && /Μαύρο/.test(vBl) && vOl.includes(olive.images[0]) && !vOl.includes(black.images[0]), 'each variation: its colour and ITS OWN photo (the olive photo on the olive one only)', vOl);
  ok(/source,target,regex,code/.test(f3) && /sakidio-mil-tec-assault-molle-olive-small.*attribute_pa_.*=ladi.*301/.test(f3), 'file 3: 301 from the old olive page to the new page with olive chosen', f3);
  const same = fam.exportFiles('sf', assault.key, { variantSkus: 'same', parentSku: '14002000-FAM' });
  ok(same.files[1].csv.split('\n').filter((l) => /^variation,/.test(l)).every((l) => l.startsWith('variation,,14002000-FAM,')), 'mode «one code» (the shop\'s rule): the variations without code');

  section('SEO: η σελίδα όπως τη διαβάζει το Google (πραγματικές σελίδες του site)');
  const seo = require(APP + '/lib/seoaudit');
  const a1 = seo.auditHtml(fs.readFileSync(path.join(FX, 'sf-simple-olive.html'), 'utf8'), 'https://specialforces.gr/product/sakidio-mil-tec-assault-molle-olive-small/', { family: assault });
  const has = (a, re, level) => a.findings.some((x) => re.test(x.text) && (!level || x.level === level));
  ok(has(a1, /canonical/i, 'ok') && has(a1, /Ένα σύνολο/, 'ok') && has(a1, /μάρκα/, 'warn') && has(a1, /GTIN/, 'warn') && has(a1, /ξεχωριστά προϊόντα του ίδιου μοντέλου/), 'the olive page: canonical ok, one Product (Yoast), no brand, no GTIN, one of 2 separate products of one model', JSON.stringify(a1.findings.map((x) => x.text)));
  const a2 = seo.auditHtml(fs.readFileSync(path.join(FX, 'sf-variable.html'), 'utf8'), 'https://specialforces.gr/product/panteloni-pentagon-bdu-arctic-pants-k05068/');
  ok(a2.summary.groups === 1 && a2.summary.variants === 12 && has(a2, /variesBy/) && has(a2, /αυτόματο αριθμό/) && has(a2, /χωρίς διαθεσιμότητα/) && has(a2, /διεύθυνση που την προεπιλέγει/, 'ok'), 'the variable page: ProductGroup with 12 variants, no variesBy, odd variant codes, offers without availability, crawlable variant addresses', JSON.stringify(a2.findings.map((x) => x.level + ' ' + x.text)));
  const dup = fs.readFileSync(path.join(FX, 'sf-simple-olive.html'), 'utf8').replace('</head>', '<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"1"}}</script></head>');
  ok(has(seo.auditHtml(dup, 'https://specialforces.gr/product/x/'), /Δύο ή περισσότερα/, 'crit'), 'a second structured-data block of a product is caught (never add one)');

  section('Αναφορά ποιότητας του προϊόντος (μία, με τρεις χωριστές καταστάσεις)');
  {
    const quality = require(APP + '/lib/quality');
    const q0 = quality.report('sf', olive.id);
    ok(q0.statuses.flow && /^Βήμα [1-5]/.test(q0.statuses.flow.label) && q0.statuses.research && q0.statuses.seo.state === 'never', 'three states apart: the work flow («Βήμα …»), the internet research, the SEO check (never done yet)', JSON.stringify(q0.statuses));
    ok(q0.statuses.research.state !== 'never' && q0.statuses.research.hits >= 1, 'the last saved research is read (the one above), not started again', JSON.stringify(q0.statuses.research));
    ok(q0.areas.some((a) => a.area === 'Μάρκα / κατηγορία' && /μάρκα/i.test(a.text)), 'the olive bag without its brand filed → said (brand)', JSON.stringify(q0.areas.map((a) => a.text)));
    ok(q0.areas.some((a) => a.area === 'Παραλλαγές' && /επιβεβαιώνουν/.test(a.text)), 'its family is in the report, with how sure', JSON.stringify(q0.areas.filter((a) => a.area === 'Παραλλαγές')));
    quality.saveSeo('sf', olive.id, a1);
    const q1 = quality.report('sf', olive.id);
    ok(q1.statuses.seo.state === 'warn' && q1.statuses.seo.counts.warn >= 1 && q1.areas.some((a) => a.area === 'SEO' && /GTIN/.test(a.text)), 'after an SEO check: its state and its findings are in the report (kept, not checked again on open)', JSON.stringify(q1.statuses.seo));
    // a product with a copy's code: «crit», and no «cleaned» code proposed
    const junk = Object.assign({}, olive, { id: 999001, sku: 'Mora-1755379572', name: 'ΜΑΧΑΙΡΙ MORAKNIV RISBERG HUNTING (S)', brand: 'Morakniv', images: [] });
    store.write('catalog-sf', { syncedAt: now, source: 'api', products: real.concat([junk]), categories: [] });
    const qj = quality.report('sf', 999001);
    ok(qj.areas.some((a) => a.level === 'crit' && /κωδικός αντιγράφου/.test(a.text)) && qj.areas.some((a) => a.level === 'crit' && a.area === 'Φωτογραφίες') && qj.needsResearch, 'a copy\'s code and no photo → «Πρέπει», and the full research is offered (not started)', JSON.stringify(qj.areas.filter((a) => a.level === 'crit').map((a) => a.text)));
    ok(!qj.proposals.some((c) => c.field === 'sku' && /^Mora$/i.test(c.to)), 'no «Mora» made of the copy\'s code');
    // the real case (amerikaniki-agora.gr, 23/11): one shop shows «Mora-14723» for MORAKNIV RISBERG HUNTING (S)
    const wc = store.read('web-codes', null) || {};
    store.write('web-codes', Object.assign({}, wc, { products: Object.assign({}, wc.products, { 'sf:999001': { at: now, status: 'partial', hits: [{ host: 'amerikaniki-agora.gr', url: 'https://amerikaniki-agora.gr/shop/eidi-epiviosis/machairia-epiviosis/morakniv-risberg-hunting-s/', name: 'Morakniv Risberg Hunting (S)', code: 'Mora-14723', sku: 'Mora-14723', at: now }] } }) }));
    const qm = quality.report('sf', 999001);
    const un = qm.areas.find((a) => /Mora-14723/.test(a.text));
    ok(un && un.level === 'warn' && /Αβέβαιο εύρημα/.test(un.text) && /amerikaniki-agora\.gr/.test(un.text) && /χειροκίνητη επιβεβαίωση/.test(un.fix), 'one shop shows Mora-14723 → «αβέβαιο εύρημα» with its URL, to be confirmed by hand', JSON.stringify(un));
    ok(!qm.proposals.some((c) => c.field === 'sku'), 'one shop only → no proposal to change the code');
    store.write('web-codes', wc);
    store.write('catalog-sf', { syncedAt: now, source: 'api', products: real, categories: [] });
  }

  section('Προαιρετικοί πάροχοι αναζήτησης (SearXNG / Brave / Google): δικό τους κλειδί, ποτέ στην οθόνη');
  const sfind = require(APP + '/lib/supplierfind');
  const hits = { searxng: 0, brave: 0, google: 0 };
  const api = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u.pathname === '/search') { hits.searxng++; return res.end(JSON.stringify({ results: [{ url: 'https://sx.gr/p/1', title: 'SX result' }] })); }
    if (u.pathname === '/brave') { hits.brave++; return res.end(JSON.stringify({ web: { results: [{ url: 'https://br.gr/p/1', title: req.headers['x-subscription-token'] === 'BRAVE-KEY' ? 'ok' : 'nokey' }] } })); }
    if (u.pathname === '/google') { hits.google++; return res.end(JSON.stringify({ items: [{ link: 'https://gg.gr/p/1', title: u.searchParams.get('cx') }] })); }
    res.end('{}');
  });
  const base = await listen(api);
  process.env.SFK_SEARCH_DDG = base + '/none'; process.env.SFK_SEARCH_BING = base + '/none'; process.env.SFK_SEARCH_YAHOO = base + '/none';
  process.env.SFK_SEARCH_BRAVE = base + '/brave'; process.env.SFK_SEARCH_GOOGLE = base + '/google';
  const keys = require(APP + '/lib/searchkeys');
  keys.save({ searxng: { url: base }, brave: { key: 'BRAVE-KEY' }, google: { key: 'G-KEY', cx: 'CX1', perDay: 1 } });
  const v = keys.view();
  ok(v.brave.set && v.google.set && !JSON.stringify(v).includes('BRAVE-KEY') && !fs.readFileSync(path.join(process.env.SFK_DATA, 'search-keys.json'), 'utf8').includes('BRAVE-KEY'), 'the keys are kept encrypted and never shown back');
  ok(!keys.config().brave, 'a provider is used only when it is switched on in the settings');
  require(APP + '/lib/settings').save({ webResearch: { apis: { searxng: true, brave: true, google: true } } });
  const cfg = keys.config();
  const state = { blocked: new Set(), used: new Set(), apis: cfg };
  const res1 = await sfind.searchWide('mil-tec assault', state);
  const urls = res1.map((x) => x.url);
  ok(urls.includes('https://sx.gr/p/1') && urls.includes('https://br.gr/p/1') && urls.includes('https://gg.gr/p/1') && res1.find((x) => x.url === 'https://br.gr/p/1').title === 'ok', 'the results of SearXNG, Brave (with its key) and Google Programmable Search come together with the engines\'', JSON.stringify(res1.engines));
  const res2 = await sfind.searchWide('mil-tec assault 2', state);
  ok(res2.engines.some((e) => e.id === 'google' && e.state === 'quota') && hits.google === 1, 'a provider at its daily limit is not asked (said «quota»), the others go on', JSON.stringify(res2.engines));
  api.close();

  section('Το AI στην έρευνα: δομημένες απαντήσεις (JSON Schema), ελεγμένες, με cache');
  const calls = [];
  let answer = {};
  const ol = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }));
      const j = JSON.parse(b);
      calls.push(j);
      const out = typeof answer === 'function' ? answer(j) : answer;
      res.end(JSON.stringify({ model: j.model, response: typeof out === 'string' ? out : JSON.stringify(out), done: true, eval_count: 20, prompt_eval_count: 100 }));
    });
  });
  const obase = await listen(ol);
  process.env.SFK_WORKER_OLLAMA_URL = obase;
  const air = require(APP + '/lib/airesearch');
  const tools = air.forWorker({ signal: null }, 'qwen2.5');
  answer = { queries: ['Mil-Tec Assault Pack Small olive', 'σακίδιο Mil-Tec Assault 20L λαδί', 'Mil-Tec 14002099 olive', 'Nike running shoes'] };
  const q = await tools.queries({ name: olive.name, brand: 'MIL-TEC', sku: '14002001' });
  ok(calls[0] && calls[0].format && calls[0].format.properties && calls[0].format.properties.queries && calls[0].model === 'qwen2.5:7b', 'the JSON Schema reaches Ollama as «format» (structured outputs), with the model of the settings', JSON.stringify(calls[0] && calls[0].format));
  ok(q && q.list.includes('Mil-Tec Assault Pack Small olive') && !q.list.some((x) => /14002099|Nike/.test(x)), 'its searches are checked: an invented code (14002099) and another product (Nike) are dropped', JSON.stringify(q));
  const n0 = calls.length;
  await tools.queries({ name: olive.name, brand: 'MIL-TEC', sku: '14002001' });
  ok(calls.length === n0, 'the same question again: from the cache (no new call)');
  answer = (j) => (j.format === 'json' ? { verdict: 'family', reason: 'μαύρο' } : 'όχι JSON');
  const jv = await tools.judge({ name: olive.name }, { name: 'Mil-Tec Assault Small' }, { match: 'exact' });
  ok(jv && jv.verdict === 'family' && calls.slice(n0).some((c) => c.format === 'json'), 'an answer that is not valid JSON → asked once more (plain JSON), then checked', JSON.stringify(jv));
  // the AI can take a «same» away, never make one: a page the rules call «the same» but the AI calls «another variant»
  const io2 = Object.assign({}, io, { judge: async () => ({ verdict: 'family', reason: 'η φωτογραφία είναι μαύρη' }), search: async () => [{ url: 'https://shop9.gr/x' }], page: async (url) => ({ url, name: 'Σακίδιο Mil-Tec Assault Molle Small Olive', brand: 'Mil-Tec', price: 30, availability: 'in', images: [], isProduct: true }) });
  const r2 = await cf.lookUp({ k: 'sf:1', name: olive.name, brand: 'MIL-TEC', sku: '', price: 35, needs: ['price'] }, io2);
  ok(!r2.hits.length && r2.family.length === 1 && r2.trace.pages[0].why.includes('AI'), 'the AI took a «same» away (it became «another variant»), and it says so', JSON.stringify(r2.trace.pages));
  const io3 = Object.assign({}, io2, { judge: async () => ({ verdict: 'exact', reason: 'ίδιο' }), page: async (url) => ({ url, name: 'Mil-Tec Assault Molle Small', brand: 'Mil-Tec', price: 30, availability: 'in', images: [], isProduct: true }) });
  const r3 = await cf.lookUp({ k: 'sf:1', name: olive.name, brand: 'MIL-TEC', sku: '', price: 35, needs: ['price'] }, io3);
  ok(!r3.hits.length && r3.trace.pages.some((x) => x.ai && x.ai.verdict === 'exact'), 'the AI says «the same» for a doubtful page: written for a person to see, never taken by itself', JSON.stringify(r3.trace.pages));
  // the path of the program: localai.askJson → ai.call → the computer → Ollama, with «format» kept on the way
  const coord = require(APP + '/lib/coord');
  coord.use(require(APP + '/lib/coord-store').fileBackend());
  require(APP + '/lib/jobtypes').register();
  answer = { verdict: 'similar', reason: 'δεν φαίνεται χρώμα' };
  const h = coord.handler('ai.call');
  const res = await h.run({ path: '/api/generate', body: { model: 'qwen2.5:7b', prompt: 'x', format: air.JUDGE_SCHEMA, system: 'σύστημα' } }, { signal: null, progress() {}, cancelled: () => false });
  const last = calls[calls.length - 1];
  ok(last.format && last.format.properties.verdict && last.system === 'σύστημα' && res.prompt_eval_count === 100, 'the job of the computer passes «format» and «system» to Ollama (they used to be dropped), and the tokens come back', JSON.stringify([!!last.format, last.system, res.prompt_eval_count]));
  ol.close();

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
