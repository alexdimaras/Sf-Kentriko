'use strict';
// SF Κέντρο — the naming of products measured on a REAL catalog (study 24/11 «Μελέτη Γνώσης Προϊόντων», §7): the same
// numbers before / after every change of the title rules, so «better» is a number, not a feeling.
//
//   node test/bench/naming-bench.js <products.json> [prodcats.json] [categories.json …]
//
// products.json: the shop's public list (Store API: /wp-json/wc/store/v1/products?per_page=100&page=N, all pages in one
// array); prodcats.json (optional): [{ id, cats: [category ids] }]; categories (optional): Store API categories pages.
// Nothing is written anywhere but a temporary folder. Numbers 24/11 (specialforces.gr, 9.901 products), before → after:
//   «similar products» proposals 531 → 224 · with a Greek kind word of the title ignored 101 → 7 · ΣΗΜΑ before ΔΙΑΚΡΙΤΙΚΟ 35 → 0
//   «code in the title» 722 → 623 · because of ANOTHER product's code 214 → 122 (and those at «look», not 98%)
const fs = require('fs');
const os = require('os');
const path = require('path');

const [prodFile, catsFile, ...catPages] = process.argv.slice(2);
if (!prodFile) { console.error('Χρήση: node test/bench/naming-bench.js <products.json> [prodcats.json] [categories.json …]'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-naming-'));
process.env.SFK_DATA = path.join(tmp, 'data'); process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
const APP = path.join(__dirname, '..', '..');
const W = (n, v) => fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v));

const store = require(APP + '/lib/store'); store.init();
const catalog = require(APP + '/lib/catalog');
const U = require(APP + '/lib/util');
const raw = JSON.parse(fs.readFileSync(prodFile, 'utf8'));
const pc = catsFile ? new Map(JSON.parse(fs.readFileSync(catsFile, 'utf8')).map((x) => [x.id, x.cats])) : new Map();
let cats = [];
for (const f of catPages) cats = cats.concat(JSON.parse(fs.readFileSync(f, 'utf8')));
const prods = raw.map((p) => { const x = catalog.fromStoreApi(p); if (pc.has(p.id)) x.cats = pc.get(p.id); return x; });
W('catalog-sf', { syncedAt: new Date().toISOString(), source: 'api', products: prods, categories: cats.map((c) => ({ id: c.id, name: U.decodeEntities(c.name || ''), slug: c.slug || '', parent: c.parent || 0, count: c.count || 0 })) });
W('catalog-st', { syncedAt: new Date().toISOString(), source: 'api', products: [], categories: [] });
W('settings', { firstRunDone: true });
catalog.learnTypes();
const ck = require(APP + '/lib/checks');
const kinds = require(APP + '/lib/kinds');
const K = require(APP + '/lib/knowledge').terms();
const ctx = ck.titleContext('sf');

const M = { products: 0, typefirst: 0, sure: 0, similar: 0, similarIgnoring: 0, twoKinds: 0, preferredRename: 0, codeTitle: 0, codeOther: 0, codeShape: 0 };
const ex = { similarIgnoring: [], twoKinds: [], codeOther: [] };
const kindSet = new Set((catalog.learnedTypes().nouns || []).concat([...K.kinds]));
for (const p of prods) {
  if (p.type === 'variation') continue;
  M.products++;
  const tf = ck.titleFix(p, ctx);
  const st = tf.steps.find((x) => x.kind === 'typefirst');
  if (st) { M.typefirst++; if (st.level === 'high') M.sure++; if (st.how === 'similar') { M.similar++; const ws = kinds.words(p.name).filter((w) => /^[Α-Ω]{4,}$/.test(w) && !kinds.COLOUR.test(w)); const added = tf.fix.split(' ')[0]; if (ws.length && !ws.includes(added)) { M.similarIgnoring++; if (ex.similarIgnoring.length < 15) ex.similarIgnoring.push(p.name + '  ⇒  ' + tf.fix); } } }
  if (tf.steps.some((x) => x.kind === 'term')) M.preferredRename++;
  // a kind word ADDED by the rules in front of a title that already had one (ΣΗΜΑ … ΔΙΑΚΡΙΤΙΚΟ …) — not «ΑΔΙΑΒΡΟΧΟ ΑΡΒΥΛΟ»
  const before = new Set(kinds.words(p.name)), first = kinds.words(tf.fix)[0];
  if (st && first && !before.has(first) && ![...before].some((w) => (K.preferred.get(w) || {}).to === first) && [...before].some((w) => kindSet.has(w))) { M.twoKinds++; if (ex.twoKinds.length < 15) ex.twoKinds.push(p.name + '  ⇒  ' + tf.fix); }
  const codes = ck.codesInTitle(p.name, p, ctx);
  if (codes.length) {
    M.codeTitle++;
    const own = U.normSku(p.sku || '');
    if (codes.some((w) => U.normSku(w) !== own && ctx.codes.has(U.normSku(w)))) { M.codeOther++; if (ex.codeOther.length < 15) ex.codeOther.push(codes.join(',') + ' | ' + p.name); }
    else if (codes.every((w) => U.normSku(w) !== own && !ctx.codes.has(U.normSku(w)))) M.codeShape++;
  }
}
console.log(JSON.stringify(M, null, 1));
for (const [k, list] of Object.entries(ex)) if (list.length) console.log('\n' + k + ':\n  ' + list.join('\n  '));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
