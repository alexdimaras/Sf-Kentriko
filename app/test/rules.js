'use strict';
// SF Κέντρο — tests of the catalog rules (npm test runs them after test/run.js).
// A made-up shop built from REAL kinds of titles found in the two shops (November 2026): a title whose «&» was
// lost on the site (Hamp;N), codes sent encoded (SE &#8211; 40403), descriptions written in entity names, cartridges
// named by a trade name (12ΒΟΛΑ FEDERAL…), brands in front of the kind, accessories sitting in a kind's category.
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-rules-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);

// ---------- the shop as its public API sends it ----------
const CATS = [
  [1, 'Uncategorized', 0], [30, 'ΦΥΣΙΓΓΙΑ ΚΥΝΗΓΙΟΥ-ΣΚΟΠΟΒΟΛΗΣ', 0], [31, 'FEDERAL', 30], [40, 'ΕΝΔΥΣΗ', 0], [41, 'ΜΠΟΥΦΑΝ/ΑΔΙΑΒΡΟΧΑ', 40],
  [50, 'ΣΟΥΓΙΑΔΕΣ', 0], [51, 'OPINEL', 50], [60, 'ΜΑΧΑΙΡΙΑ', 0], [61, 'MORAKNIV', 60], [70, 'ΒΛΗΜΑΤΑ ΑΕΡΟΒΟΛΩΝ', 0], [80, 'ΥΠΟΔΗΣΗ', 0],
  [90, 'T-SHIRT - ΠΟΛΟ ΥΠΗΡΕΣΙΑΣ', 40], [95, 'ΣΑΚΙΔΙΑ', 0],
].map(([id, name, parent]) => ({ id, name, slug: id === 1 ? 'uncategorized' : 'c' + id, parent, count: 5, permalink: '' }));
let nextId = 1000;
function api(name, o) {
  o = o || {};
  const id = o.id || nextId++;
  return {
    id, name, slug: 'p' + id, parent: 0, type: 'simple', variation: '', permalink: 'https://shop.example/p/' + id, sku: o.sku == null ? 'S' + id : o.sku,
    short_description: o.short || '', description: o.desc == null ? '<p>Αναλυτική περιγραφή του προϊόντος με όλα τα χαρακτηριστικά του, τα υλικά κατασκευής, τις διαστάσεις και τις οδηγίες χρήσης, γραμμένη για τον πελάτη του καταστήματος και για τις μηχανές αναζήτησης, ώστε να μη χρειάζεται καμία συμπλήρωση από το πρόγραμμα στη διάρκεια των δοκιμών αυτών.</p>' : o.desc,
    on_sale: false, prices: { price: String(o.price || 1990), regular_price: String(o.price || 1990), currency_minor_unit: 2 },
    images: [{ src: `https://shop.example/i/${id}a.jpg` }, { src: `https://shop.example/i/${id}b.jpg` }],
    categories: (o.cats || []).map((c) => ({ id: c, name: CATS.find((x) => x.id === c).name })), tags: [],
    brands: o.brand ? [{ id: 1, name: o.brand }] : [], attributes: [], variations: [], is_in_stock: true, is_purchasable: true,
  };
}
function shop() {
  const list = [];
  // the shop's own kind words: each leads enough titles to be learned (as in the real catalog)
  const many = (kind, cats, brand, n) => { for (let i = 1; i <= (n || 9); i++) list.push(api(`${kind} ${brand} MODEL ${kind.length}${i}`, { cats, brand })); };
  many('ΦΥΣΙΓΓΙΑ', [30], 'RIO'); many('ΣΟΥΓΙΑΣ', [50], 'SPYDERCO'); many('ΜΑΧΑΙΡΙ', [60], 'MUELA'); many('ΑΡΒΥΛΟ', [80], 'HAIX'); many('ΣΑΚΙΔΙΟ', [95], 'PENTAGON');
  many('ΚΑΡΑΜΠΙΝΑ', [], 'BENELLI'); many('ΒΑΣΗ', [], 'FAB'); many('ΜΠΟΥΦΑΝ', [41], 'PENTAGON'); many('ΒΛΗΜΑΤΑ', [70], 'H&amp;N'); many('ΒΟΛΙΔΕΣ', [70], 'GAMO');
  many('ΗΜΙΑΥΤΟΜΑΤΗ', [], 'DERYA');
  list.push(
    api('12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', { id: 252799, cats: [31], brand: 'FEDERAL', sku: 'F130 00' }),
    api('WINCHESTER SUPER-X 27 ΒΟΛΑ', { id: 2, cats: [30], brand: 'WINCHESTER' }),
    api('ΜΟΝΟΒΟΛΑ FEDERAL TRUBALL DEEP PENETRATOR', { id: 3, cats: [31], brand: 'FEDERAL' }),
    api('FEDERAL H163 HI BRASS 36gr', { id: 4, cats: [31], brand: 'FEDERAL' }),
    api('OPINEL CARBON #07', { id: 5, cats: [51], brand: 'OPINEL' }),
    api('MORAKNIV FIRE KIT ΓΙΑ ELDRIS', { id: 6, cats: [61], brand: 'MORAKNIV' }),
    api('PONCHO PENTAGON ZERO HOUR', { id: 7, cats: [41], brand: 'PENTAGON' }),
    api('MIL-TEC BLACK TACTICAL QUICK DRY', { id: 8, cats: [90], brand: 'MIL-TEC' }),
    api('BENELLI M4 S90 A.I DRONE ΗΜΙΑΥΤΟΜΑΤΗ ΚΑΡΑΜΠΙΝΑ', { id: 9, brand: 'BENELLI' }),
    api('5.11 TACTICAL A.T.A.C. 2.0 ΓΥΝΑΙΚΕΙΟ ΑΡΒΥΛΟ ΜΑΥΡΟ', { id: 10, cats: [80], brand: '5.11 TACTICAL' }),
    api('NEXTORCH TA40 SET ΕΠΑΝΑΦΟΡΤΙΖΟΜΕΝΟΣ ΜΕ ΒΑΣΗ', { id: 11, brand: 'NEXTORCH' }),
    api('ΒΟΛΙΔΕΣ Hamp;N SILVER POINT 4.5mm (400pcs)', { id: 267335, sku: '' }),
    api('ΒΛΗΜΑΤΑ FIELD &#038; TARGET TROPHY H&#038;N 5.0MM', { id: 12, cats: [70], brand: 'H&amp;N' }),
    api('ΘΗΚΗ SAFARILAND 6360', { id: 191690, sku: 'SE &#8211; 40403', brand: 'SAFARILAND' }),
    api('ΑΝΙΧΝΕΥΤΗΣ ΜΕΤΑΛΛΩΝ GARRETT ACE 300', { id: 127416, brand: 'GARRETT', desc: '<p>' + '&Alpha;&nu;&iota;&chi;&nu;&epsilon;&upsilon;&tau;ή&sigmaf; &mu;&epsilon;&tau;ά&lambda;&lambda;&omega;&nu; &gamma;&iota;&alpha; &alpha;&rho;&chi;ά&rho;&iota;&omicron;&upsilon;&sigmaf; &kappa;&alpha;&iota; &pi;&rho;&omicron;&chi;&omega;&rho;&eta;&mu;έ&nu;&omicron;&upsilon;&sigmaf;. '.repeat(6) + '</p>' }),
    api('CHAMP; ΑΝΤΑΛΛΑΚΤΙΚΟ', { id: 13 }),
  );
  return list;
}

(async () => {
  const store = require(APP + '/lib/store'); store.init();
  const U = require(APP + '/lib/util');
  const catalog = require(APP + '/lib/catalog');
  const checks = require(APP + '/lib/checks');
  const fixes = require(APP + '/lib/fixes');
  const kinds = require(APP + '/lib/kinds');
  const drafts = require(APP + '/lib/drafts');
  const wooexport = require(APP + '/lib/wooexport');
  store.write('settings', { firstRunDone: true });

  section('Ειδικοί χαρακτήρες: ό,τι στέλνει το site διαβάζεται σωστά');
  ok(U.decodeEntities('H&amp;N') === 'H&N' && U.decodeEntities('H&amp;amp;N') === 'H&N', 'H&amp;N and a twice encoded H&amp;amp;N both read H&N');
  ok(U.decodeEntities('&Eta; &omicron;&iota;&kappa;&omicron;&nu;&omicron;&mu;&iota;&kappa;ή &sigma;&epsilon;&iota;&rho;ά') === 'Η οικονομική σειρά', 'Greek letters written by name (&Eta;&omicron;…) are read as Greek');
  ok(U.decodeEntities('AT&T; S&W; R&D') === 'AT&T; S&W; R&D', 'an «&» that is not a code stays as it is');
  ok(U.repairEntities('ΒΟΛΙΔΕΣ Hamp;N SILVER POINT 4.5mm') === 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5mm', 'a lost «&» is put back: Hamp;N → H&N');
  ok(U.repairEntities('SMITH #038; WESSON') === 'SMITH & WESSON' && U.repairEntities('ΦΑΚΟΣ 5quot; LED') === 'ΦΑΚΟΣ 5" LED', 'the same for #038; and quot;');
  ok(U.repairEntities('CHAMP; ΑΝΤΑΛΛΑΚΤΙΚΟ') === '' && U.repairEntities('ΛΑΜΠΑ; ΦΑΚΟΣ') === '' && U.repairEntities('H&amp;N') === '', 'a real word before «;» (CHAMP;) or a whole code is never "repaired"');

  await catalog.saveCatalogAsync('sf', { source: 'api', products: shop().map(catalog.fromStoreApi), categories: CATS.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parent: c.parent, count: c.count, url: '' })), info: { seo: 'yoast' }, meta: { syncStartedAt: new Date().toISOString(), lastFullAt: new Date().toISOString(), engine: 2, mode: 'full' } });
  const sf = catalog.byId('sf');
  ok(sf.get(191690).sku === 'SE - 40403', 'a code sent as «SE &#8211; 40403» is kept as «SE - 40403»', sf.get(191690).sku);
  ok(sf.get(12).name === 'ΒΛΗΜΑΤΑ FIELD & TARGET TROPHY H&N 5.0MM' && sf.get(12).brand === 'H&N', 'title and brand with «&» as the site means them', sf.get(12).name + ' / ' + sf.get(12).brand);
  ok(sf.get(267335).name === 'ΒΟΛΙΔΕΣ Hamp;N SILVER POINT 4.5mm (400pcs)', 'a title that is broken ON THE SITE is shown as it is (the program does not hide it)');
  ok(sf.get(267335).brand === 'H&N' && sf.get(267335).brandSource === 'title', 'its brand is still recognised (H&N, from the repaired title)', sf.get(267335).brand);
  ok(sf.get(127416).descGr > 0.8, 'a description written in entity names counts as Greek (not "in English")', String(sf.get(127416).descGr));
  // data read by the previous version: codes were kept encoded
  const old = JSON.parse(fs.readFileSync(path.join(process.env.SFK_DATA, 'catalog-sf.json'), 'utf8'));
  old.products.find((p) => p.id === 191690).sku = 'SE &#8211; 40403';
  fs.writeFileSync(path.join(process.env.SFK_DATA, 'catalog-st.json'), JSON.stringify(Object.assign({}, old, { products: old.products.filter((p) => p.id === 191690) })));
  store.forget('catalog-st');
  ok(catalog.load('st').products[0].sku === 'SE - 40403', 'codes kept encoded by the previous version are put right when the data is loaded');
  fs.unlinkSync(path.join(process.env.SFK_DATA, 'catalog-st.json')); store.forget('catalog-st');

  section('Τίτλοι: σπασμένοι χαρακτήρες και «είδος πρώτο» με απόδειξη');
  const all = fixes.compute().items;
  const one = (pid, field) => all.find((c) => c.site === 'sf' && c.pid === pid && c.field === field);
  const broken = checks.cached().checks.find((c) => c.id === 'sf-broken');
  ok(broken && broken.items.length === 1 && broken.items[0].id === 267335, 'check «Τίτλοι με σπασμένους χαρακτήρες» finds the Hamp;N title and nothing else', broken ? broken.items.map((i) => i.name).join(' | ') : 'no check');
  ok(one(267335, 'name') && one(267335, 'name').to === 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5mm (400pcs)' && one(267335, 'name').level === 'high', 'ready fix: ΒΟΛΙΔΕΣ H&N SILVER POINT… (sure)', one(267335, 'name') && one(267335, 'name').to);
  const f = one(252799, 'name');
  ok(f && f.to === 'ΦΥΣΙΓΓΙΑ 12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', '«12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12» is recognised as cartridges: ΦΥΣΙΓΓΙΑ goes first', f && f.to);
  ok(f && /12ΒΟΛΑ/.test(f.why) && /ΦΥΣΙΓΓΙΑ/.test(f.why) && !/παρόμοια/.test(f.why), 'with the proof in plain words, not "from similar products"', f && f.why);
  ok(one(2, 'name') && one(2, 'name').to === 'ΦΥΣΙΓΓΙΑ WINCHESTER SUPER-X 27 ΒΟΛΑ', 'the same for «27 ΒΟΛΑ» written in two words', one(2, 'name') && one(2, 'name').to);
  ok(!one(3, 'name'), '«ΜΟΝΟΒΟΛΑ FEDERAL…» is left alone (a word customers look for)');
  ok(one(4, 'name') && one(4, 'name').to === 'ΦΥΣΙΓΓΙΑ FEDERAL H163 HI BRASS 36gr' && /κατηγορία «ΦΥΣΙΓΓΙΑ ΚΥΝΗΓΙΟΥ-ΣΚΟΠΟΒΟΛΗΣ › FEDERAL»/.test(one(4, 'name').why), 'a title of Latin words only takes its kind from its own category (FEDERAL under ΦΥΣΙΓΓΙΑ…)', one(4, 'name') && one(4, 'name').to);
  ok(one(5, 'name') && one(5, 'name').to === 'ΣΟΥΓΙΑΣ OPINEL CARBON #07', 'OPINEL CARBON #07 in ΣΟΥΓΙΑΔΕΣ › OPINEL → ΣΟΥΓΙΑΣ first', one(5, 'name') && one(5, 'name').to);
  ok(!one(6, 'name') || !/^ΜΑΧΑΙΡΙ/.test(one(6, 'name').to), 'an accessory in the knives category (FIRE KIT ΓΙΑ…) is NOT called a knife', one(6, 'name') && one(6, 'name').to);
  ok(!one(7, 'name') || !/κατηγορία/.test(one(7, 'name').why), 'a category of two kinds (ΜΠΟΥΦΑΝ/ΑΔΙΑΒΡΟΧΑ) proves nothing: at most a suggestion to check', one(7, 'name') && one(7, 'name').why);
  ok(!one(8, 'name') || !/^ΠΟΛΟ/.test(one(8, 'name').to), '«T-SHIRT - ΠΟΛΟ ΥΠΗΡΕΣΙΑΣ» does not make every product a ΠΟΛΟ', one(8, 'name') && one(8, 'name').to);
  ok(one(9, 'name') && one(9, 'name').to === 'ΗΜΙΑΥΤΟΜΑΤΗ ΚΑΡΑΜΠΙΝΑ BENELLI M4 S90 A.I DRONE', 'the kind moves to the front together with its adjective (ΗΜΙΑΥΤΟΜΑΤΗ ΚΑΡΑΜΠΙΝΑ BENELLI…)', one(9, 'name') && one(9, 'name').to);
  ok(one(10, 'name') && one(10, 'name').to === 'ΓΥΝΑΙΚΕΙΟ ΑΡΒΥΛΟ 5.11 TACTICAL A.T.A.C. 2.0 ΜΑΥΡΟ', 'the colour stays at the end (ΓΥΝΑΙΚΕΙΟ ΑΡΒΥΛΟ 5.11 … ΜΑΥΡΟ)', one(10, 'name') && one(10, 'name').to);
  ok(!one(11, 'name') || !/^ΒΑΣΗ/.test(one(11, 'name').to), 'a word after «ΜΕ» is not the kind (… ΜΕ ΒΑΣΗ)', one(11, 'name') && one(11, 'name').to);
  ok(!all.some((c) => c.field === 'name' && /\bS\d{4}\b|F130 00/.test(String(c.to)) && !/\bS\d{4}\b|F130 00/.test(String(c.from))), 'no title fix ever adds the product code to a title');
  ok(all.filter((c) => c.field === 'name').every((c) => c.source && c.why && c.level), 'every title fix says why, from where and how sure');

  section('Αναγνώριση είδους (κοινή για τίτλους, κατηγορίες, νέα προϊόντα, αντιστοίχιση)');
  ok(kinds.compound('12ΒΟΛΑ FEDERAL F130').kind === 'ΦΥΣΙΓΓΙΑ' && kinds.compound('CLUB ΔΡΑΜΙΑ MAGNUM').kind === 'ΦΥΣΙΓΓΙΑ' && kinds.compound('RIO ROYAL BUCK 16ΒΟΛΟ').kind === 'ΦΥΣΙΓΓΙΑ', '12ΒΟΛΑ / ΔΡΑΜΙΑ / 16ΒΟΛΟ → ΦΥΣΙΓΓΙΑ');
  ok(!kinds.compound('ΑΕΡΟΒΟΛΑ ΠΙΣΤΟΛΙΑ UMAREX') && !kinds.compound('ΦΑΚΟΣ 12V'), 'ΑΕΡΟΒΟΛΑ is not «…ΒΟΛΑ» cartridges');
  ok(kinds.sameStem('ΣΑΚΙΔΙΑ', 'ΣΑΚΙΔΙΟ') && kinds.sameStem('ΖΩΝΕΣ', 'ΖΩΝΗ') && kinds.sameStem('ΣΟΥΓΙΑΔΕΣ', 'ΣΟΥΓΙΑΣ') && !kinds.sameStem('ΣΤΟΛΕΣ', 'ΣΤΟΧΟΣ'), 'plural and singular of a kind are the same word; look-alikes are not');
  ok(drafts.guessType('12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', '') === 'ΦΥΣΙΓΓΙΑ', 'a new product named «12ΒΟΛΑ FEDERAL…» gets the kind ΦΥΣΙΓΓΙΑ', drafts.guessType('12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', ''));
  const market = require(APP + '/lib/market');
  const sc = market.score({ name: '12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', brand: 'FEDERAL', sku: 'F130 00', price: 12.4 }, { name: 'ΘΗΚΗ FEDERAL F130 POWER SHOCK', brand: 'FEDERAL', sku: '', price: 12 });
  ok(sc.match === 'none', 'in the price research a cartridge is never "the same" as another kind of product with the same words', sc.match);
  const cat = one(267335, 'cats');
  ok(cat && cat.to.id === 70, 'a product without a category goes where products of its kind are (ΒΟΛΙΔΕΣ → ΒΛΗΜΑΤΑ ΑΕΡΟΒΟΛΩΝ)', cat && JSON.stringify(cat.to));

  section('Νέα προϊόντα: καθαρά ονόματα, ο κωδικός μόνο στο πεδίο του, χρώμα ως ιδιότητα');
  let d = drafts.fromExtract({ url: 'https://sup.example/p/1', host: 'sup.example', name: 'Βολίδες H&amp;N Silver Point 4.5mm', brand: 'H&amp;amp;N', price: 10, images: [] }, {});
  ok(d.title === 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5MM' && d.fields.brand === 'H&N', 'a supplier page that sends H&amp;N gives a clean title and brand', d.title + ' / ' + d.fields.brand);
  d = drafts.fromExtract({ url: 'https://sup.example/p/2', host: 'sup.example', name: 'Pentagon Ranger 2.0 Pants K05007', brand: 'Pentagon', code: 'K05007', price: 69, images: [], variants: [{ size: 'M', color: 'Black', sku: 'K05007-01-M' }, { size: 'L', color: 'Black', sku: 'K05007-01-L' }] }, {});
  ok(!/K05007/.test(d.title) && d.sku === 'K05007', 'the supplier\'s code is not written into the title; it stays in the code field', d.title + ' / ' + d.sku);
  ok(!/K05007|Κωδικός/.test(d.short), 'nor into the short description (the text under the title)', d.short);
  const rows = wooexport.draftRows(d, 'sf');
  const attrsOf = (r) => [1, 2, 3, 4].map((n) => [r[`Attribute ${n} name`], r[`Attribute ${n} value(s)`]]).filter((x) => x[0]);
  ok(rows[0].Type === 'variable' && attrsOf(rows[0]).some(([, v]) => v === 'M, L') && rows.filter((r) => r.Type === 'variation').length === 2, 'sizes become a WooCommerce attribute with one variation each');
  ok(attrsOf(rows[0]).some(([, v]) => /ΜΑΥΡΟ|Black/i.test(v)), 'a product in one colour keeps the colour as an attribute (not only in the title)', JSON.stringify(attrsOf(rows[0])));
  ok(rows.filter((r) => r.Type === 'variation').every((r) => r.Parent === 'K05007' && r.SKU && attrsOf(r).length >= 1), 'each variation has its own code and its size attribute');

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
