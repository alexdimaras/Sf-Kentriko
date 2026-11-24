'use strict';
// SF Κέντρο — what a product IS, in the shop's own words (study 24/11 «Μελέτη Γνώσης Προϊόντων»): the real cases of
// specialforces.gr, as regression tests that must never come back —
//   «5.11 TACTICAL ΔΙΑΚΡΙΤΙΚΟ ALL HOGS PATCH» → «ΔΙΑΚΡΙΤΙΚΟ 5.11 TACTICAL ALL HOGS PATCH» (never «ΣΗΜΑ …», never two kinds)
//   one product of a category never names the others; a Greek kind word already in a title is never put aside
//   XQ35 / 223REM (a model, a calibre) stay in a title although another product has them as its code
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-knowledge-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);
const W = (n, v) => fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v));
const now = new Date().toISOString();

let id = 1000;
const P = (name, cats, extra) => Object.assign({ id: ++id, type: 'simple', name, sku: '', brand: '', cats, price: 10, regular: 10, images: [], attrs: [] }, extra || {});
const products = [
  // «5.11 TACTICAL» (a folder of a brand): 1 product starts with a Greek word — «ΣΗΜΑ» — the rest with the brand
  P('ΣΗΜΑ 5.11 HONOUR THOSE WHO SERVE 82057 ΣΥΛΛΕΚΤΙΚΟ', [3461, 3398]),
  P('5.11 TACTICAL ΔΙΑΚΡΙΤΙΚΟ ALL HOGS PATCH', [3461, 3398], { sku: '92239' }),
  P('5.11 TACTICAL ΔΙΑΚΡΙΤΙΚΟ NEPTUNES NAVY PATCH', [3461, 3398], { sku: '92104' }),
  P('5.11 TACTICAL STRYKE PANTS BLACK', [3461]), P('5.11 TACTICAL RUSH 12 BACKPACK', [3461]), P('5.11 TACTICAL ALL HOGS PATCH TWO', [3461]),
  // a category of vests, where shin guards also sit
  ...Array.from({ length: 8 }, (_, i) => P('ΓΙΛΕΚΟ MIL-TEC MODEL ' + i, [500])),
  P('MIL-TEC ANTI RIOT ΠΕΡΙΚΝΗΜΙΔΕΣ', [500]),
  P('MORAKNIV ΑΚΟΝΙΣΤΗΣ ΜΑΧΑΙΡΙΟΥ DIAMOND SHARPENER L-FINE', [600]), ...Array.from({ length: 8 }, (_, i) => P('ΜΑΧΑΙΡΙ MORAKNIV ' + i, [600])),
  // many «ΣΗΜΑ …» titles (it is a learned kind word of the shop)
  ...Array.from({ length: 10 }, (_, i) => P('ΣΗΜΑ ΡΑΦΤΟ ΠΥΡΟΣΒΕΣΤΙΚΗΣ ' + i, [700])),
  // a model of Pulsar that another product has as its code; a calibre in three titles
  P('ΘΕΡΜΙΚΗ ΑΠΕΙΚΟΝΙΣΗ PULSAR SCOPE/FRONT ATTACHMENT KRYPTON 2 XQ35', [800], { sku: '77374' }),
  P('ΘΕΡΜΙΚΗ ΑΠΕΙΚΟΝΙΣΗ PULSAR TELOS LRF XQ35', [800], { sku: 'XQ-35' }),
  P('ΣΚΟΠΕΥΤΙΚΟ ΤΥΦΕΚΙΟ TANFOGLIO TSR 223REM 16"', [900], { sku: 'TSR-16' }), P('ΣΚΟΠΕΥΤΙΚΟ ΤΥΦΕΚΙΟ TANFOGLIO TSR 223REM 14"', [900], { sku: '223REM' }),
  P('ΠΑΝΤΕΛΟΝΙ PENTAGON BDU ARCTIC PANTS K05068', [900], { sku: 'K05001-2.0-MC-1' }),
  // a word seen with a kind only a few times (TRACER: a model of jackets) is no proof for a power bank
  ...Array.from({ length: 6 }, (_, i) => P('ΜΠΟΥΦΑΝ PENTAGON TRACER ' + i, [1000])), P('POWERBANK TRACER 30000MAH 2A ΜΑΥΡΟ', [1100]),
  // two products of the jackets' category whose titles start with the brand (the «similar products» proposal)
  P('PENTAGON HYDRA RAIN SHELL', [1000]), P('PENTAGON ATLAS RAIN SHELL', [1000]), P('PENTAGON ORION RAIN SHELL', [1000]),
];
const cat = (cid, name) => ({ id: cid, name, slug: 'c' + cid, parent: 0, count: 1, url: '' });
W('catalog-sf', { syncedAt: now, source: 'api', products, categories: [cat(3461, '5.11 TACTICAL'), cat(3398, 'ΕΞΟΠΛΙΣΜΟΣ - ΘΗΚΕΣ - ΑΞΕΣΟΥΑΡ'), cat(500, 'ΓΙΛΕΚΑ'), cat(600, 'ΜΑΧΑΙΡΙΑ'), cat(700, 'ΡΑΦΤΑ ΣΗΜΑΤΑ'), cat(800, 'ΘΕΡΜΙΚΗ ΑΠΕΙΚΟΝΙΣΗ'), cat(900, 'ΟΠΛΑ'), cat(1000, 'ΜΠΟΥΦΑΝ'), cat(1100, 'POWER BANKS')], info: {}, lastFullAt: now, engine: 2, mode: 'full' });
W('catalog-st', { syncedAt: now, source: 'api', products: [], categories: [] });
W('settings', { firstRunDone: true });

(async () => {
  const store = require(APP + '/lib/store'); store.init();
  const catalog = require(APP + '/lib/catalog');
  catalog.learnTypes();
  const ck = require(APP + '/lib/checks');
  const K = require(APP + '/lib/knowledge');
  const ctx = ck.titleContext('sf');
  const byName = (n) => products.find((p) => p.name === n);
  const fix = (n) => ck.titleFix(byName(n), ctx);

  section('Το είδος, με τις λέξεις του καταστήματος');
  const hogs = fix('5.11 TACTICAL ΔΙΑΚΡΙΤΙΚΟ ALL HOGS PATCH');
  ok(hogs.fix === 'ΔΙΑΚΡΙΤΙΚΟ 5.11 TACTICAL ALL HOGS PATCH', 'REGRESSION: «5.11 TACTICAL ΔΙΑΚΡΙΤΙΚΟ ALL HOGS PATCH» → «ΔΙΑΚΡΙΤΙΚΟ 5.11 TACTICAL ALL HOGS PATCH»', JSON.stringify(hogs));
  ok(!/ΣΗΜΑ/.test(hogs.fix) && hogs.fix.split(' ').filter((w) => /^(ΔΙΑΚΡΙΤΙΚΟ|ΣΗΜΑ)$/.test(w)).length === 1, 'never «ΣΗΜΑ …», never two kind words', hogs.fix);
  ok(hogs.steps.find((x) => x.kind === 'typefirst').level === 'high', 'the kind word was in the title: moving it first is sure');
  const noGreek = ck.titleFix(byName('5.11 TACTICAL ALL HOGS PATCH TWO'), ctx);
  ok(/^ΔΙΑΚΡΙΤΙΚΟ 5\.11 TACTICAL ALL HOGS PATCH TWO$/.test(noGreek.fix) && noGreek.steps.some((x) => /PATCH/.test(x.why)), 'no Greek word but «PATCH»: the shop\'s word for it, ΔΙΑΚΡΙΤΙΚΟ (owner\'s rule, named)', JSON.stringify(noGreek));
  const st = ck.titleFix(byName('5.11 TACTICAL STRYKE PANTS BLACK'), ctx);
  ok(!/^ΣΗΜΑ/.test(st.fix), 'one product of the brand\'s folder never names the others («ΣΗΜΑ» from 1 of 1)', st.fix);
  const ren = fix('ΣΗΜΑ ΡΑΦΤΟ ΠΥΡΟΣΒΕΣΤΙΚΗΣ 0');
  ok(ren.fix === 'ΔΙΑΚΡΙΤΙΚΟ ΡΑΦΤΟ ΠΥΡΟΣΒΕΣΤΙΚΗΣ 0' && ren.steps.find((x) => x.kind === 'term').level === 'medium', 'an existing «ΣΗΜΑ …» title → «ΔΙΑΚΡΙΤΙΚΟ …», for a look (not a mass change by itself)', JSON.stringify(ren));

  section('Καμία λέξη από «παρόμοια προϊόντα» όταν ο τίτλος έχει ήδη το είδος του');
  ok(!/^ΓΙΛΕΚΟ/.test(fix('MIL-TEC ANTI RIOT ΠΕΡΙΚΝΗΜΙΔΕΣ').fix), 'ΠΕΡΙΚΝΗΜΙΔΕΣ in a category of vests: never «ΓΙΛΕΚΟ …»', fix('MIL-TEC ANTI RIOT ΠΕΡΙΚΝΗΜΙΔΕΣ').fix);
  ok(!/^ΜΑΧΑΙΡΙ/.test(fix('MORAKNIV ΑΚΟΝΙΣΤΗΣ ΜΑΧΑΙΡΙΟΥ DIAMOND SHARPENER L-FINE').fix), 'ΑΚΟΝΙΣΤΗΣ (a sharpener) among knives: never «ΜΑΧΑΙΡΙ …»');
  ok(!/^ΜΠΟΥΦΑΝ/.test(fix('POWERBANK TRACER 30000MAH 2A ΜΑΥΡΟ').fix), 'a word seen with a kind a few times (TRACER) is no proof: a power bank never becomes «ΜΠΟΥΦΑΝ»');

  section('Κωδικός στον τίτλο: όνομα μοντέλου ≠ κωδικός');
  ok(fix('ΘΕΡΜΙΚΗ ΑΠΕΙΚΟΝΙΣΗ PULSAR SCOPE/FRONT ATTACHMENT KRYPTON 2 XQ35').fix.endsWith('KRYPTON 2 XQ35'), 'XQ35 stays: a model of Pulsar (another product has it as its code, and it stands in 2 of our titles)');
  ok(fix('ΣΚΟΠΕΥΤΙΚΟ ΤΥΦΕΚΙΟ TANFOGLIO TSR 223REM 16"').fix.includes('223REM'), '223REM (a calibre) stays');
  const k05 = fix('ΠΑΝΤΕΛΟΝΙ PENTAGON BDU ARCTIC PANTS K05068');
  ok(!k05.fix.includes('K05068') && k05.steps.find((x) => x.kind === 'code').level === 'medium', 'K05068 (a maker\'s item number, not this product\'s code): proposed, for a look — not 98%', JSON.stringify(k05.steps));

  section('Κανόνες του χρήστη: με προέλευση, αναιρούνται');
  ok(K.terms().preferred.get('ΣΗΜΑ').to === 'ΔΙΑΚΡΙΤΙΚΟ' && /ιδιοκτήτη/.test(K.terms().preferred.get('ΣΗΜΑ').source), 'the owner\'s rule is there, with where it comes from');
  const r = K.addRule({ kind: 'foreign', from: ['GAITERS'], to: 'ΓΚΕΤΕΣ' }, 'alex');
  ok(K.terms().foreign.get('GAITERS').to === 'ΓΚΕΤΕΣ' && /alex/.test(K.terms().foreign.get('GAITERS').source), 'a person\'s rule: written with who wrote it');
  ok(K.removeRule(r.id, 'alex') && !K.terms().foreign.has('GAITERS'), '…and taken back');
  let bad = null; try { K.addRule({ kind: 'preferred', from: ['X'], to: 'PATCH' }); } catch (e) { bad = e; }
  ok(bad && /ελληνικά/.test(bad.message), 'the shop\'s word is a Greek word (a foreign one is refused)');

  section('Μαθαίνει από τις αποφάσεις σου (με αναίρεση)');
  const hy = byName('PENTAGON HYDRA RAIN SHELL'), at = byName('PENTAGON ATLAS RAIN SHELL'), or = byName('PENTAGON ORION RAIN SHELL');
  ok(/^ΜΠΟΥΦΑΝ PENTAGON ORION/.test(ck.titleFix(or, ck.titleContext('sf')).fix), 'before: «similar products» propose ΜΠΟΥΦΑΝ for the rain shells');
  const r1 = K.learn({ site: 'sf', pid: hy.id, cats: hy.cats, from: hy.name, to: 'ΜΠΟΥΦΑΝ ' + hy.name, status: 'rejected', by: 'alex' });
  K.learn({ site: 'sf', pid: at.id, cats: at.cats, from: at.name, to: 'ΜΠΟΥΦΑΝ ' + at.name, status: 'rejected', by: 'alex' });
  const after = ck.titleFix(or, ck.titleContext('sf'));
  ok(r1 && r1.word === 'ΜΠΟΥΦΑΝ' && !/^ΜΠΟΥΦΑΝ/.test(after.fix), 'two «no» to «ΜΠΟΥΦΑΝ» in this category: it is not proposed there again', JSON.stringify(after));
  K.forget(r1.id, 'alex');
  ok(/^ΜΠΟΥΦΑΝ PENTAGON ORION/.test(ck.titleFix(or, ck.titleContext('sf')).fix), '…and taken back: proposed again');
  K.learn({ site: 'sf', pid: or.id, cats: or.cats, from: or.name, to: 'ΜΠΟΥΦΑΝ ' + or.name, status: 'approved', edited: 'ΑΔΙΑΒΡΟΧΟ ΜΠΟΥΦΑΝ PENTAGON ORION RAIN SHELL', by: 'alex' });
  ok(K.examplesFor([1000], 3)[0] === 'ΑΔΙΑΒΡΟΧΟ ΜΠΟΥΦΑΝ PENTAGON ORION RAIN SHELL' && K.learned().counts.examples === 1, 'a title you changed and approved is an example for the same category (the AI gets it)');
  const ai = require(APP + '/lib/airesearch');
  ok(/ΑΔΙΑΒΡΟΧΟ ΜΠΟΥΦΑΝ PENTAGON ORION/.test(ai.suggestPrompt ? ai.suggestPrompt(Object.assign({}, hy, { catNames: [] }), '-') : ''), 'the AI\'s question carries the approved examples of the category and the shop\'s words');

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
