'use strict';
// the little shops of the tests run on this machine: the program may open private addresses here (never in use)
process.env.SFK_ALLOW_PRIVATE = '1';
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
    api('ΦΑΚΟΣ LUMOS X100', { id: 14, sku: 'LX-100' }),
    api('ΣΑΚΙΔΙΟ PENTAGON RUSH 8 BLACK', { id: 15, brand: 'PENTAGON', sku: 'K16099-01' }),
    api('ΣΑΚΙΔΙΟ PENTAGON RUSH 8 OLIVE', { id: 16, brand: 'PENTAGON', sku: 'K16099-06' }),
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
  ok(one(267335, 'name') && one(267335, 'name').to === 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5MM (400PCS)' && one(267335, 'name').level === 'high', 'ready fix: ΒΟΛΙΔΕΣ H&N SILVER POINT… (sure)', one(267335, 'name') && one(267335, 'name').to);
  const f = one(252799, 'name');
  ok(f && f.to === 'ΦΥΣΙΓΓΙΑ 12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', '«12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12» is recognised as cartridges: ΦΥΣΙΓΓΙΑ goes first', f && f.to);
  ok(f && /12ΒΟΛΑ/.test(f.why) && /ΦΥΣΙΓΓΙΑ/.test(f.why) && !/παρόμοια/.test(f.why), 'with the proof in plain words, not "from similar products"', f && f.why);
  ok(one(2, 'name') && one(2, 'name').to === 'ΦΥΣΙΓΓΙΑ WINCHESTER SUPER-X 27 ΒΟΛΑ', 'the same for «27 ΒΟΛΑ» written in two words', one(2, 'name') && one(2, 'name').to);
  ok(!one(3, 'name'), '«ΜΟΝΟΒΟΛΑ FEDERAL…» is left alone (a word customers look for)');
  ok(one(4, 'name') && one(4, 'name').to === 'ΦΥΣΙΓΓΙΑ FEDERAL H163 HI BRASS 36GR' && /κατηγορία «ΦΥΣΙΓΓΙΑ ΚΥΝΗΓΙΟΥ-ΣΚΟΠΟΒΟΛΗΣ › FEDERAL»/.test(one(4, 'name').why), 'a title of Latin words only takes its kind from its own category (FEDERAL under ΦΥΣΙΓΓΙΑ…)', one(4, 'name') && one(4, 'name').to);
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
  {
    const r1 = market.score({ name: 'ΦΥΣΙΓΓΙΑ ΜΟΝΟΒΟΛΑ RIO ROYAL STAR 32gr 5τμχ', brand: '', sku: '', price: 20 }, { name: 'RIO Royal Star 32gr Μονόβολα 5τμχ', brand: 'RIO', sku: '', price: 19 });
    const r2 = market.score({ name: 'ΦΥΣΙΓΓΙΑ ΜΟΝΟΒΟΛΑ RIO ROYAL STAR 32gr 5τμχ', brand: '', sku: '', price: 20 }, { name: 'RIO Royal Star 34gr Μονόβολα 5τμχ', brand: 'RIO', sku: '', price: 19 });
    const r3 = market.score({ name: 'ΜΠΛΟΥΖΑ ΠΟΛΟ ΥΑΤ QUICK DRY', brand: '', sku: '', price: 20 }, { name: 'Polo Quick Dry Pentagon', brand: 'Pentagon', sku: '', price: 19 });
    ok(r1.match === 'exact' && r1.ev.some((x) => /μάρκα στον τίτλο μας: RIO/.test(x)) && r2.match !== 'exact' && r3.match !== 'exact', 'a product without a brand: their brand counts when our title names it too (RIO … 32gr = exact; 34gr no; a brand not in our title no)', JSON.stringify([r1.match, r2.match, r3.match]));
  }
  const sc = market.score({ name: '12ΒΟΛΑ FEDERAL F130 POWER SHOCK C12', brand: 'FEDERAL', sku: 'F130 00', price: 12.4 }, { name: 'ΘΗΚΗ FEDERAL F130 POWER SHOCK', brand: 'FEDERAL', sku: '', price: 12 });
  ok(sc.match === 'none', 'in the price research a cartridge is never "the same" as another kind of product with the same words', sc.match);
  const cat = one(267335, 'cats');
  ok(cat && cat.to.id === 70, 'a product without a category goes where products of its kind are (ΒΟΛΙΔΕΣ → ΒΛΗΜΑΤΑ ΑΕΡΟΒΟΛΩΝ)', cat && JSON.stringify(cat.to));

  section('Αντιστοίχιση με ανταγωνιστές: απόδειξη, όχι μόνο τίτλοι που μοιάζουν (αληθινές περιπτώσεις)');
  const same = (our, their) => market.score(our, their);
  const O = (name, brand, sku, price, more) => Object.assign({ name, brand, sku, price }, more || {});
  let r = same(O('ΜΠΟΥΦΑΝ PENTAGON ELEMENTS PARKA COYOTE', 'PENTAGON', 'K01014-1755507139', 125.9), O('Pentagon Elements Parka', 'PENTAGON', 'K01014', 82.9));
  ok(r.match === 'exact' && r.how === 'sku' && /K01014/.test(r.ev.join()), 'the same model code is the same product, also when our code has a tail (K01014-1755507139 = K01014)', JSON.stringify(r));
  r = same(O('ΘΗΚΗ ΠΡΩΤΩΝ ΒΟΗΘΕΙΩΝ TASMANIAN TIGER IFAK POUCH ΛΑΔΙ', 'TASMANIAN TIGER', '7951', 35), O('Tasmanian Tiger IFAK Pouch', 'Tasmanian Tiger', 'ΤΤ 7951-331', 40));
  ok(r.match === 'exact' && r.how === 'sku', '7951 = «ΤΤ 7951-331» (the shop wrote the brand letters in front, in Greek)', JSON.stringify(r));
  r = same(O('ΦΑΚΟΣ NITECORE P20', 'NITECORE', '', 50, { ean: '6952506492404' }), O('Nitecore P20 V2 tactical', '', '', 55, { ean: '6952506492404' }));
  ok(r.match === 'exact' && r.how === 'ean', 'the same EAN is the same product, whatever the titles say', JSON.stringify(r));
  r = same(O('ΑΡΒΥΛΑ PENTAGON HYBRID 2.0 STR BOOT BLACK', 'PENTAGON', 'K15038-2.0-STR', 69.9), O('PENTAGON Hybrid 2.0 STR Shoes', 'PENTAGON', 'K15037-2.0STR-1', 69.9));
  ok(r.match === 'similar' && /K15038/.test(r.why) && /K15037/.test(r.why), 'the same words but another code of the same shape (K15038 / K15037: boots / shoes) is NOT the same', JSON.stringify(r));
  r = same(O('ΠΑΝΤΕΛΟΝΙ PENTAGON BDU 2.0 CAMO ΕΛΛΗΝΙΚΗ ΠΑΡΑΛΛΑΓΗ', 'PENTAGON', 'K05001-2.0-Camo', 36.9), O('PENTAGON BDU 2.0 SET CAMO', 'PENTAGON', 'K02001-K05001-2.0-56', 65));
  ok(r.match === 'similar', 'trousers are not the set (jacket + trousers)', JSON.stringify(r));
  r = same(O('ΠΑΝΤΕΛΟΝΙ PENTAGON BDU 2.0 CAMO', 'PENTAGON', '', 36.9), O('PENTAGON BDU 2.0 SET CAMO', 'PENTAGON', '', 39));
  ok(r.match === 'similar' && /σετ/.test(r.why), 'also without codes: «SET» on one side only → the person decides', JSON.stringify(r));
  r = same(O('ΜΑΧΑΙΡΙ MORAKNIV ELDRIS ΜΕ ΣΠΙΝΘΗΡΙΣΤΗ ΚΙΤΡΙΝΟ', 'MORAKNIV', '', 55), O('MORAKNIV Eldris', 'MORAKNIV', '', 30));
  ok(r.match === 'similar' && /με …/.test(r.why), 'a knife «ΜΕ ΣΠΙΝΘΗΡΙΣΤΗ» is not the plain knife', JSON.stringify(r));
  r = same(O('ΜΑΧΑΙΡΙ MORAKNIV ELDRIS ΜΕ ΣΠΙΝΘΗΡΙΣΤΗ ΠΡΑΣΙΝΟ', 'MORAKNIV', 'MORA-12633', 55), O('Morakniv Eldris με σπινθηριστή πράσινο', 'Morakniv', 'Mora-12633', 54.8));
  ok(r.match === 'exact', 'and IS the same as the one that also says «με σπινθηριστή»', JSON.stringify(r));
  r = same(O('ΔΑΚΤΥΛΙΟΙ ΣΙΛΙΚΟΝΗΣ ΓΙΑ ΩΤΟΑΣΠΙΔΕΣ EARMOR M30', 'EARMOR', 'S06-M30', 23.9), O('ΩΤΟΑΣΠΙΔΕΣ ΗΛΕΚΤΡΟΝΙΚΕΣ EARMOR M30 FOLIAGE GREEN', 'EARMOR', '9020051672', 47));
  ok(r.match === 'similar' && /Άλλο είδος/.test(r.why), 'a spare part «ΓΙΑ ΩΤΟΑΣΠΙΔΕΣ» is not the ear defenders', JSON.stringify(r));
  r = same(O('ΑΡΒΥΛΑ LOWA TIBET GTX', 'LOWA', '', 300), O('Μποτάκια Lowa Tibet GTX', 'LOWA', '', 310));
  ok(r.match === 'exact', 'two names of one kind (ΑΡΒΥΛΑ / ΜΠΟΤΑΚΙΑ) do not split a product', JSON.stringify(r));
  r = same(O('ΣΑΚΙΔΙΟ ΤΑΞΙΔΙΟΥ 100L', 'MRK', '', 43.9), O('Σακίδιο MRK στρατιωτικό 100L - Μαύρο', 'MRK', 'MRK-30-01', 44));
  ok(r.match === 'similar', 'brand + capacity (100L) alone prove nothing', JSON.stringify(r));
  r = same(O('ΚΟΝΤΟΜΑΝΙΚΟ T-SHIRT PENTAGON ΣΠΑΡΤΙΑΤΗΣ PETROL', 'PENTAGON', 'K09012-SH-1754713298', 16.9), O('ΜΠΛΟΥΖΑ PENTAGON AGERON "BLANK" K09012-01 BLACK', 'PENTAGON', 'K09012-01', 21.9));
  ok(r.match !== 'exact', 'one base code, another print (K09012-SH «ΣΠΑΡΤΙΑΤΗΣ» / K09012-01 «BLANK») is not the same', JSON.stringify(r));
  r = same(O('ΚΑΠΕΛΟ PENTAGON CREST TRUCKER CAP', 'PENTAGON', 'K13082-13083', 9.8), O('TRIAD CAP K13082', 'PENTAGON', 'K13082', 14.48));
  ok(r.match === 'similar' && /άλλο όνομα/.test(r.why), 'the same code under two model names: shown for a decision, never counted by itself', JSON.stringify(r));
  r = same(O('ΠΑΝΤΕΛΟΝΙ PENTAGON BDU ARCTIC PANTS K05068', 'PENTAGON', 'K05001-99', 48.9), O('BDU 2.0 K05001-2.0', 'PENTAGON', 'K05001-2.0', 37.28));
  ok(r.match !== 'exact', 'a title that names another code than its own code field (K05068 filed under K05001) is not matched by that code', JSON.stringify(r));
  r = same(O('ΔΙΠΛΗ ΓΕΜΙΣΤΗΡΟΘΗΚΗ PENTAGON DOUBLE MULTI POUCH RAL', 'PENTAGON', 'K17090-1', 16.9), O('PENTAGON DOUBLE MULTI POUCH', 'PENTAGON', 'K17090', 6.9));
  ok(r.match === 'similar' && /τιμή/.test(r.why), 'a price less than half of ours with only the base code in common → check first', JSON.stringify(r));
  r = same(O('ΓΥΑΛΙΑ SWISS EYE APACHE ΚΑΦΕ', 'SWISS EYE', 'SE - 40232', 49.8), O('Swiss Eye Apache', 'SWISS EYE', 'SE – 40231', 64.9));
  ok(r.match === 'similar', 'another colour with its own code and price (SE 40232 / SE 40231) is not the same', JSON.stringify(r));
  ok(r.ev && r.ev.includes('ίδια μάρκα'), 'every answer carries its proof in words (shown next to the offer)', JSON.stringify(r.ev));
  ok(market.codeBase('MORA-12210').base === 'MORA12210' && market.codeBase('8020860 Katadyn BeFree Gravity 10L').base === '8020860' && market.codeBase('Δυνατότητα προ-παραγγελίας') === null && market.codeBase('MORA-HD') === null, 'the base of a code is read from what shops really write in the code field');
  ok(market.gtinOf('6952506492404') === '6952506492404' && market.gtinOf('6952506492405') === '' && market.gtinOf('0844802310635') === '844802310635', 'an EAN counts only with a right check digit (a leading 0 does not matter)');

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
  // (the owner's decision 18/11/2026, as Google asks: each variation its own code — here the supplier's own code of that size)
  const vr = rows.filter((r) => r.Type === 'variation');
  ok(vr.every((r) => r.Parent === 'K05007' && attrsOf(r).length >= 1) && vr.map((r) => r.SKU).join() === 'K05007-01-M,K05007-01-L', 'each variation belongs to the product and has its own distinct code (the supplier\'s code of that size) and its size attribute', JSON.stringify(vr.map((r) => r.SKU)));
  require(APP + '/lib/settings').save({ variantSku: 'suffix' });
  ok(wooexport.draftRows(d, 'sf').filter((r) => r.Type === 'variation').every((r) => r.SKU), 'with «own code per size/colour» each variation gets its code');
  require(APP + '/lib/settings').save({ variantSku: 'same' });

  section('Έρευνα αγοράς: όλα τα προϊόντα, κατάστημα-κατάστημα, χωρίς να χάνεται η πρόοδος');
  {
    const now = new Date().toISOString();
    const W = (n, v) => { fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v)); store.forget(n); };
    W('competitors', ['cA', 'cB', 'cC'].map((id) => ({ id, name: 'shop-' + id, url: `https://${id}.example`, kind: 'woo', enabled: true })));
    W('competitors-meta', { seed: 99 });
    const mains = [...catalog.byId('sf').values()].filter((p) => p.type !== 'variation');
    const cat = (id, off) => W('comp-' + id, { kind: 'woo', at: now, products: mains.map((p, i) => ({ id: i, n: p.name, s: p.sku, b: p.brand, u: `https://${id}.example/p/${p.id}`, p: Math.round((p.price + off) * 100) / 100, pm: 0, r: 0, st: true, i: '', c: 'EUR' })) });
    cat('cA', 1); cat('cB', 2); cat('cC', 3);
    W('market', {}); W('market-meta', {}); W('market-progress', null);
    const shape = () => JSON.stringify(Object.entries(store.read('market', {})).sort().map(([k, e]) => [k, e.action, e.suggested, e.competitors.map((c) => [c.competitorId, c.price, c.match]).sort()]));
    const jobThatStopsAfter = (n) => { let stop = false; const log = []; return { log: (l) => log.push(l), lines: log, progress(d, t, m) { const x = /(\d+)\/(\d+) καταστήματα/.exec(m || ''); if (x && Number(x[1]) >= n) stop = true; }, cancelled: () => stop, signal: new AbortController().signal }; };
    let res = await market.run(null, null, { skipDownload: true });
    const wholeRun = shape();
    ok(res.done === mains.length && res.shops.complete && res.shops.done === 3, 'a whole run compares EVERY product (not a sample) with every shop', JSON.stringify(res));
    ok(res.withData >= mains.length - 3, 'and finds the offers of all three shops', String(res.withData));
    // stopped after the first shop
    W('market', {}); W('market-meta', {}); W('market-progress', null);
    const j1 = jobThatStopsAfter(1);
    res = await market.run(null, j1, { skipDownload: true });
    const saved = store.read('market', {});
    ok(res.stopped && res.shops.done === 1 && res.shops.of === 3 && !res.shops.complete, 'stopped in the middle: it says how far it got (1 of 3 shops)', JSON.stringify(res.shops));
    ok(Object.keys(saved).length >= mains.length - 3 && Object.values(saved).every((e) => e.competitors.every((c) => c.competitorId === 'cA')), 'what the first shop gave is already written down (nothing is lost)');
    ok(!store.read('market-meta', {}).lastRunDay && market.dailyDue() === false, 'the day is not marked as done, and the automatic run does not start again at once after a person stopped it');
    store.forgetAll(); // as after a restart of the program
    const j2 = jobThatStopsAfter(99);
    res = await market.run(null, j2, { skipDownload: true });
    ok(res.resumed === 1 && j2.lines.some((l) => /Συνέχεια από εκεί που είχε μείνει: 1 από 3/.test(l)), 'the next run goes on from where it was (also after a restart): the shop that was done is not compared again', JSON.stringify([res.resumed, j2.lines]));
    ok(shape() === wholeRun && res.shops.complete && store.read('market-meta', {}).lastRunDay, 'and ends with exactly the result of a run that was never stopped');
    // a shop is read again (new catalog): only that one is compared again
    cat('cB', 5);
    const before = store.read('market-progress', {}).done.cB;
    fs.writeFileSync(path.join(process.env.SFK_DATA, 'comp-cB.json'), JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(process.env.SFK_DATA, 'comp-cB.json'), 'utf8')), { at: new Date(Date.now() + 1000).toISOString() }))); store.forget('comp-cB');
    res = await market.run(null, null, { skipDownload: true });
    const anyB = Object.values(store.read('market', {})).map((e) => e.competitors.find((c) => c.competitorId === 'cB')).filter(Boolean);
    ok(res.resumed === 2 && store.read('market-progress', {}).done.cB !== before && anyB.length && anyB.filter((c) => c.match === 'exact').length > 50 && anyB.filter((c) => c.match === 'exact').every((c) => c.prevPrice != null), 'when one shop has a new catalog only that shop is compared again, and its price changes are noted', JSON.stringify([res.resumed, anyB.length]));
    // a shop taken off the list loses its offers; a shop that could not be read keeps its last ones
    W('competitors', ['cA', 'cB'].map((id) => ({ id, name: 'shop-' + id, url: `https://${id}.example`, kind: 'woo', enabled: true })));
    res = await market.run(null, null, { skipDownload: true });
    ok(Object.values(store.read('market', {})).every((e) => e.competitors.every((c) => c.competitorId !== 'cC')), 'a shop taken off the list no longer counts in any product');
  }

  section('Μάρκα, EAN, φωτογραφίες από πολλές πηγές: μόνο από καταστήματα με το ΙΔΙΟ προϊόν, με πηγή και σιγουριά');
  {
    const off = (shop, o) => Object.assign({ shop, competitorId: shop, url: `https://${shop}.example/p`, price: 20, inStock: true, match: 'exact', how: 'sku', ev: ['ίδιος κωδικός', 'ίδια μάρκα'], country: 'GR', seenAt: new Date().toISOString() }, o);
    const entry = (id, offers) => ({ at: new Date().toISOString(), name: catalog.byId('sf').get(id).name, competitors: offers, stats: { count: offers.length } });
    store.write('market', {
      'sf:14': entry(14, [off('a', { name: 'Lumos X100 φακός', brand: 'Lumos', ean: '4046872358951', img: 'https://a.example/wp-content/uploads/lumos-x100-black-300x300.jpg' }), off('b', { name: 'LUMOS X100', brand: 'LUMOS', ean: '4046872358951', img: 'https://b.example/img/lumos-x100-black.jpg' })]),
      'sf:15': entry(15, [off('a', { name: 'Pentagon Rush 8 Black', brand: 'Pentagon', ean: '5205550001117', how: 'sku', ev: ['ίδιος κωδικός μοντέλου (K16099)', 'ίδια μάρκα'] })]),
      'sf:16': entry(16, [off('a', { name: 'Pentagon Rush 8 Black', brand: 'Pentagon', ean: '5205550001117', how: 'sku', ev: ['ίδιος κωδικός μοντέλου (K16099)', 'ίδια μάρκα'] })]),
      'sf:5': entry(5, [off('c', { name: 'Opinel Carbon 07', brand: 'Opinel', ean: '3123840790010', how: 'words', ev: ['ίδια μάρκα', 'λέξεις μοντέλου: CARBON'] })]),
    });
    fixes.invalidate();
    const items = fixes.compute().items;
    const pick = (pid, field) => items.find((c) => c.site === 'sf' && c.pid === pid && c.field === field);
    const b14 = pick(14, 'brand');
    ok(b14 && /^lumos$/i.test(b14.to) && b14.source.kind === 'competitor' && (b14.sources || []).length === 1, 'a missing brand comes from the shops that have the same product (same code), each one named as a source', JSON.stringify(b14 && [b14.to, b14.source, b14.sources]));
    ok(b14 && b14.level === 'medium' && /Νέα μάρκα/.test(b14.why), 'a brand the shop has never used is only «look at it», even when two shops agree', b14 && b14.level);
    const g14 = pick(14, 'gtin');
    ok(g14 && g14.to === '4046872358951' && g14.level === 'high' && /2 πηγές/.test(g14.why), 'the same EAN at two shops with the same code → sure', JSON.stringify(g14 && [g14.to, g14.level]));
    const i14 = pick(14, 'images');
    // (2 photos are «too few» now — fewer than the setting's 3 — so more are proposed; the source must be a sure one)
    ok(!i14 || (i14.to.length > 2 && i14.source && i14.source.url), 'a product with too few photos (2 of 3) gets more only from a named source', JSON.stringify(i14 && i14.source));
    const g15 = pick(15, 'gtin'), g16 = pick(16, 'gtin');
    ok(g15 && g15.to === '5205550001117' && !g16, 'only the base of the code in common: the EAN goes to the black bag (same colour), never to the olive one', JSON.stringify([g15 && g15.to, g16 && g16.to]));
    ok(!pick(5, 'gtin'), 'an offer matched by words only gives nothing (no EAN, no photo, no brand)');
    ok(items.filter((c) => ['brand', 'gtin', 'images'].includes(c.field)).every((c) => c.source && c.source.label && ['high', 'medium'].includes(c.level)), 'every such proposal has a source and a confidence');
    // codes (SKU) and photos from the matches of the research, ready for a yes
    const s14 = pick(14, 'sku');
    ok(!s14, 'a product that has a code gets no other one');
    store.write('market', {
      'sf:7': entry(7, [off('a', { name: 'Pentagon Zero Hour Poncho', brand: 'Pentagon', mpn: 'K07012-13', sku: '99881', how: 'words', ev: ['ίδια μάρκα', 'λέξεις μοντέλου: ZERO HOUR'], img: 'https://a.example/wp-content/uploads/k07012-poncho-300x300.jpg' }),
        off('b', { name: 'PENTAGON ZERO HOUR PONCHO', brand: 'PENTAGON', sku: 'K07012-13', how: 'words', ev: ['ίδια μάρκα', 'λέξεις μοντέλου: ZERO HOUR'], img: 'https://b.example/img/k07012-poncho.jpg' })]),
      'sf:6': entry(6, [off('c', { name: 'Morakniv Fire Kit', brand: 'Morakniv', sku: '3498.vs1', how: 'words', ev: ['ίδια μάρκα', 'λέξεις μοντέλου: FIRE KIT'] })]),
    });
    const c7 = catalog.byId('sf').get(7); const s7sku = c7.sku; c7.sku = ''; // as if it had none
    fixes.invalidate();
    const items2 = fixes.compute().items;
    const k7 = items2.find((c) => c.pid === 7 && c.field === 'sku');
    ok(k7 && k7.to === 'K07012-13' && k7.level === 'high' && (k7.sources || []).length === 1, 'a missing code comes from the research: two shops give the same maker code → sure, both named', JSON.stringify(k7 && [k7.to, k7.level, k7.source.label]));
    ok(!items2.find((c) => c.pid === 6 && c.field === 'sku'), 'a shop\'s own variation number («3498.vs1») is never proposed as our code');
    c7.sku = s7sku;
    store.write('market', {}); fixes.invalidate();
    // codes from the internet: shops that show the SAME product, the code sure only when two of them agree
    {
      const cf = require(APP + '/lib/codefind');
      const pages = {
        'https://shop-a.example/p/1': { name: 'H&N Silver Point 4.5mm (400pcs)', brand: 'H&N', code: 'HN-SP45-400', ean: '4046872358951', price: 9.9, currency: 'EUR', images: ['https://shop-a.example/i.jpg'] },
        'https://shop-b.example/x': { name: 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5mm 400 τεμ.', brand: 'H&N', code: 'HN-SP45-400', ean: '4046872358951', price: 10.5, currency: 'EUR', images: [] },
        'https://shop-c.example/y': { name: 'H&N Baracuda Match 4.5mm (400pcs)', brand: 'H&N', code: 'HN-BM45', ean: '', price: 12, currency: 'EUR', images: [] },
        'https://shop.example/p/267335': { name: 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5mm (400pcs)', brand: 'H&N', code: 'OURS', ean: '', price: 9, currency: 'EUR', images: [] },
      };
      const io = { own: new Set(['shop.example']), search: async () => Object.keys(pages).map((url) => ({ url, title: '' })), page: async (url) => Object.assign({ url }, pages[url]) };
      const it = { k: 'sf:267335', name: 'ΒΟΛΙΔΕΣ H&N SILVER POINT 4.5mm (400pcs)', brand: 'H&N', price: 9 };
      const r = await cf.lookUp(it, io);
      ok(r.hits.length === 2 && r.hits.every((x) => /shop-[ab]/.test(x.host)), 'only shop pages with the SAME product count (another model and our own site are left out)', JSON.stringify(r.hits.map((x) => x.host)));
      cf.save({ 'sf:267335': r });
      fixes.invalidate();
      const items4 = fixes.compute().items;
      const w1 = items4.find((c) => c.site === 'sf' && c.pid === 267335 && c.field === 'sku');
      ok(w1 && w1.to === 'HN-SP45-400' && w1.level === 'high' && (w1.sources || []).length === 1 && /internet/.test(w1.source.label), 'a code given by two shops of the internet with the same product → sure, both named', JSON.stringify(w1 && [w1.to, w1.level, w1.source.label]));
      cf.save({ 'sf:267335': { hits: r.hits.slice(0, 1), read: 1 } });
      fixes.invalidate();
      const w2 = fixes.compute().items.find((c) => c.site === 'sf' && c.pid === 267335 && c.field === 'sku');
      ok(w2 && w2.level === 'medium' && /μία μόνο πηγή/i.test(w2.why) && /χειροκίνητη επιβεβαίωση/.test(w2.why), 'one shop only → «look at it» (medium)', JSON.stringify(w2 && [w2.level]));
      ok(!fixes.compute().items.some((c) => c.field === 'sku' && /^S[FT]-\d/.test(String(c.to))), 'no invented codes: only codes found somewhere');
      ok(cf.suggestedShops(1).some((x) => x.host === 'shop-a.example') && !cf.suggestedShops(1).some((x) => x.host === 'shop.example'), 'the shops that sell our products are kept as proposals for the price research (never our own site)');
      // photos: the same file at two shops of the internet with the same product = the maker's photo → sure
      const hp = catalog.byId('sf').get(267335); const keepImgs = hp.images; hp.images = [];
      const ph = (host, u, more) => Object.assign({}, r.hits[0], { host, url: `https://${host}/p`, images: [u].concat(more || []), img: u });
      cf.save({ 'sf:267335': { read: 2, hits: [ph('shop-a.example', 'https://shop-a.example/wp-content/uploads/hn-silver-point-sp45a-300x300.jpg', ['https://shop-a.example/wp-content/uploads/hn-silver-point-sp45b.jpg']), ph('shop-b.example', 'https://shop-b.example/img/hn-silver-point-sp45a.jpg', ['https://shop-b.example/img/hn-silver-point-sp45b.jpg'])] } });
      fixes.invalidate();
      const im = fixes.compute().items.find((c) => c.site === 'sf' && c.pid === 267335 && c.field === 'images');
      ok(im && im.level === 'high' && im.to.length === 2 && !im.to.some((u) => /300x300/.test(u)) && /internet/.test(JSON.stringify([im.source, im.sources])), 'a product without photos gets the photos found at two shops of the internet with the same product (full size, both views) → sure', JSON.stringify(im && [im.to, im.level]));
      hp.images = keepImgs;
      // our code, searched with the brand: a page with the same code counts even when the titles are written otherwise
      const qs = cf.queriesOf({ name: 'ΘΗΚΗ SAFARILAND 6360', brand: 'SAFARILAND', sku: '6360-832-411' });
      ok(qs[0] === 'SAFARILAND 6360-832-411' && qs.length >= 2, 'the searches: brand + our code first, then the title, then brand + model', JSON.stringify(qs));
      const r3 = await cf.lookUp({ k: 'sf:191690', name: 'ΘΗΚΗ SAFARILAND 6360', brand: 'SAFARILAND', sku: '6360-832-411', price: 150 }, { own: new Set(), search: async () => [{ url: 'https://gun.example/a' }], page: async (url) => ({ url, name: 'Safariland Model 6360 ALS/SLS Mid-Ride Level III Retention Duty Holster', brand: 'Safariland', code: '6360-832-411', ean: '', price: 160, currency: 'EUR', images: [] }) });
      ok(r3.hits.length === 1 && r3.hits[0].how === 'code', 'a shop page with our own code is the same product (even with a longer title)', JSON.stringify(r3.hits.map((x) => x.how)));
      store.write('web-codes', {}); fixes.invalidate();
    }
    // the sizes / colours: the product's code and the value, in Latin letters, each one unique
    const fakeC = { skus: { sf: new Set(['K07014XL']), st: new Set() }, vars: { sf: new Map([[50, [
      { id: 51, type: 'variation', parent: 50, varLabel: 'Μέγεθος: XL', sku: '' }, { id: 52, type: 'variation', parent: 50, varLabel: 'Μέγεθος: 43 (UK8 1/2), Χρώμα: Μαύρο', sku: '' },
      { id: 53, type: 'variation', parent: 50, varLabel: '', sku: '' }, { id: 54, type: 'variation', parent: 50, varLabel: 'Μέγεθος: L', sku: 'K07014-L' }]]]) } };
    // the owner's test plan (19/11/2026): NO code made from ours (no K07014-XL, no P-B-10-M) — a size / colour gets a code
    // only when other shops show that very size / colour with it, two independent sites at least
    require(APP + '/lib/settings').save({ variantSku: 'suffix' });
    ok(fixes.variationCodes(fakeC, 'sf', { id: 50 }, 'K07014', []).length === 0, 'no sources → no code for the sizes / colours (nothing like K07014-XL / K07014-MAVRO is made up)');
    const ev = (host, list) => ({ host, url: `https://${host}/p`, variants: list });
    const twoShops = [ev('a.gr', [{ size: 'XL', sku: 'K07014-XL-01' }, { size: 'L', sku: 'K07014-L' }]), ev('b.gr', [{ size: 'XL', sku: 'K07014-XL-01' }])];
    const vc = fixes.variationCodes(fakeC, 'sf', { id: 50 }, 'K07014', twoShops);
    ok(vc.length === 1 && vc[0].id === 51 && vc[0].sku === 'K07014-XL-01' && vc[0].srcs.map((x) => x.host).join() === 'a.gr,b.gr', 'the XL gets the code two shops show for the XL, with both sources', JSON.stringify(vc));
    ok(fixes.variationCodes(fakeC, 'sf', { id: 50 }, 'K07014', twoShops.slice(0, 1)).length === 0, 'one shop only → no code (an uncertain finding)');
    ok(fixes.variationCodes(fakeC, 'sf', { id: 50 }, 'K07014', [ev('a.gr', [{ size: 'XL', sku: 'K07014-XL-01' }]), ev('a.gr', [{ size: 'XL', sku: 'K07014-XL-01' }])]).length === 0, 'two pages of ONE site are one source, not two');
    require(APP + '/lib/settings').save({ variantSku: 'same' });
    ok(fixes.variationCodes(fakeC, 'sf', { id: 50 }, 'K07014', twoShops).length === 0, '«no codes for sizes / colours» → none at all');
    require(APP + '/lib/settings').save({ variantSku: 'suffix' });
    // codes that are not codes: the moment of a WordPress copy at their end, or the same code twice
    const junkC = { skus: { sf: new Set(), st: new Set() }, vars: { sf: new Map([[60, [
      { id: 61, type: 'variation', parent: 60, varLabel: 'Μεγεθος: 58', sku: '58-1756480828' }, { id: 62, type: 'variation', parent: 60, varLabel: 'Μεγεθος: 56', sku: '56-1758873781' }, { id: 63, type: 'variation', parent: 60, varLabel: 'Μεγεθος: 54', sku: 'K05068-54' }]]]) } };
    ok(fixes.variationCodes(junkC, 'sf', { id: 60 }, 'K05068', []).length === 0, 'the real «58-1756480828» of the site is NOT turned into K05068-58 (no sources)');
    ok(fixes.junkSku('K16107-1755357657').base === 'K16107' && fixes.junkSku('Mora-1755379572') && !fixes.junkSku('14002001') && !fixes.junkSku('K05001-2.0-MC-1'), 'a code with the date of a copy at its end is told apart from a real code');
  }

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
