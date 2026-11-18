'use strict';
// SF Κέντρο — how well the internet research finds the SAME product, measured (not claimed).
//
//   node test/bench/research-bench.js            the old engine (the version in git, --old <rev>) and the new one
//   node test/bench/research-bench.js --json     the numbers as JSON
//
// A world with a known answer, made the same way every time (seeded): ~60 of our products (with and without brand,
// with and without code / EAN, in colours), 14 shops that each carry some of them under their own titles (English,
// Greek, with the code, without the brand) — and the traps of real shops: the same model in another colour or camo,
// the PRO / MK2 version, sets of two, category pages, pages that do not open, an engine that fails now and then. Two
// «search engines» rank every page of the world by the words of the query, as engines do. The research then runs
// exactly as in the program (codefind.lookUp, market.score); only the internet is this world.
// What it measures: recall (of the shops that really carry the product, how many were found), precision (of the
// pages taken for «the same product», how many really are), wrong matches, and what that gives (new codes / EANs /
// photos that two shops agree on and are right), the searches and pages it cost.
// It is NOT the live internet: on the live internet the numbers depend on the engines and the shops of the day.
process.env.SFK_ALLOW_PRIVATE = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-bench-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const oldRev = args.includes('--old') ? args[args.indexOf('--old') + 1] : '852723d';

// ---------- a seeded world ----------
let seed = 20261118;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gtin = (base) => { const d = String(base).padStart(12, '0').slice(0, 12); let s = 0; for (let i = 0; i < 12; i++) s += Number(d[11 - i]) * (i % 2 === 0 ? 3 : 1); return d + ((10 - (s % 10)) % 10); };
const KINDS = [['ΣΑΚΙΔΙΟ', 'Backpack'], ['ΠΑΝΤΕΛΟΝΙ', 'Pants'], ['ΜΠΟΥΦΑΝ', 'Jacket'], ['ΓΑΝΤΙΑ', 'Gloves'], ['ΦΑΚΟΣ', 'Flashlight'], ['ΜΑΧΑΙΡΙ', 'Knife'], ['ΑΡΒΥΛΑ', 'Boots'], ['ΘΗΚΗ', 'Pouch'], ['ΖΩΝΗ', 'Belt'], ['ΚΑΠΕΛΟ', 'Cap']];
const BRANDS = ['PENTAGON', 'HELIKON-TEX', 'MIL-TEC', 'NITECORE', 'MECHANIX', '5.11 TACTICAL', 'HAIX', 'MORAKNIV', 'FENIX', 'CONDOR', 'MAGNUM', 'OLIGHT', 'INVADER GEAR', 'TRU-SPEC'];
const MODELS = ['KYLER', 'RACCOON', 'ASSAULT', 'MH40', 'M-PACT', 'SABRE', 'BLACK EAGLE', 'ELDRIS', 'PD36R', 'SUMMIT', 'COBRA', 'WARRIOR', 'URBAN LINE', 'RANGER', 'TITAN', 'NOMAD', 'VIPER', 'GHOST', 'ATLAS', 'FALCON'];
const COLOURS = [['ΜΑΥΡΟ', 'Black'], ['ΧΑΚΙ', 'Khaki'], ['ΛΑΔΙ', 'Olive'], ['COYOTE', 'Coyote']];
const SHOPS = Array.from({ length: 14 }, (_, i) => `shop${i + 1}.gr`).concat(['tactical-world.com', 'gear-europe.de']);

const world = { ours: [], pages: [] };
for (let i = 0; i < 60; i++) {
  const kind = pick(KINDS), brand = rnd() < 0.2 ? '' : pick(BRANDS), model = pick(MODELS) + (rnd() < 0.4 ? ' ' + (10 + Math.floor(rnd() * 80)) : ''), col = pick(COLOURS);
  const realBrand = brand || pick(BRANDS);
  const code = (realBrand.replace(/[^A-Z]/g, '').slice(0, 2) || 'XX') + String(10000 + i * 37).slice(0, 5) + '-' + String(1 + COLOURS.indexOf(col)).padStart(2, '0');
  const ean = gtin(520000000000 + i * 101 + COLOURS.indexOf(col));
  const hasSku = rnd() < 0.4, hasEan = rnd() < 0.2;
  // our title: ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ ΧΡΩΜΑ (no brand: the brand is not written either, as in many old products)
  const name = [kind[0], brand, model, col[0]].filter(Boolean).join(' ');
  const o = { k: 'sf:' + (1000 + i), name, brand, sku: hasSku ? code : '', ean: hasEan ? ean : '', price: 40 + Math.round(rnd() * 120), needs: [].concat(hasSku ? [] : ['sku'], ['images', 'price'], brand ? [] : ['brand'], hasEan ? [] : ['ean']), truth: { code, ean, brand: realBrand, model, col, kind }, shops: new Set() };
  world.ours.push(o);
  const n = 1 + Math.floor(rnd() * 5);
  const shops = SHOPS.slice().sort(() => rnd() - 0.5).slice(0, n);
  for (const host of shops) {
    // how this shop writes it
    const style = Math.floor(rnd() * 4);
    const t = style === 0 ? `${realBrand} ${model} ${kind[1]} ${col[1]}` : style === 1 ? `${kind[0]} ${realBrand} ${model} ${col[0]}` : style === 2 ? `${realBrand} ${model} ${col[1]} ${code}` : `${kind[0]} ${model} ${col[0]}`;
    const avail = rnd() < 0.8 ? 'in' : rnd() < 0.5 ? 'out' : 'unknown';
    const showsCode = rnd() < 0.7, showsEan = rnd() < 0.5;
    const img = `https://${host}/img/${code.toLowerCase()}-a.jpg`;
    // a few shops put the product deeper: first a category page of the same model
    if (rnd() < 0.35) world.pages.push({ url: `https://${host}/c/${model.toLowerCase().replace(/\s+/g, '-')}`, host, title: `${realBrand} ${model} — όλα τα χρώματα`, category: true });
    // the same model in another colour (a camo one) at the same shop, often first in the results
    if (rnd() < 0.5) { const oc = pick(COLOURS.filter((c) => c !== col).concat([['MULTICAM', 'Multicam']])); world.pages.push({ url: `https://${host}/p/${code.toLowerCase()}-x${oc[1].toLowerCase()}`, host, title: `${realBrand} ${model} ${kind[1]} ${oc[1]}`, data: { name: `${realBrand} ${model} ${kind[1]} ${oc[1]}`, brand: realBrand, sku: showsCode ? code.replace(/-\d\d$/, '-99') : '', price: o.price + 5, availability: 'in', images: [`https://${host}/img/other-${i}.jpg`] }, truthOf: null }); }
    // the PRO version / a set of two
    if (rnd() < 0.3) world.pages.push({ url: `https://${host}/p/${code.toLowerCase()}-pro`, host, title: `${realBrand} ${model} PRO ${kind[1]} ${col[1]}`, data: { name: `${realBrand} ${model} PRO ${kind[1]} ${col[1]}`, brand: realBrand, sku: showsCode ? code + 'P' : '', price: o.price * 1.4, availability: 'in', images: [] }, truthOf: null });
    if (rnd() < 0.15) world.pages.push({ url: `https://${host}/p/${code.toLowerCase()}-set`, host, title: `SET 2x ${realBrand} ${model} ${kind[1]} ${col[1]}`, data: { name: `SET 2x ${realBrand} ${model} ${kind[1]} ${col[1]}`, brand: realBrand, price: o.price * 1.9, availability: 'in', images: [] }, truthOf: null });
    world.pages.push({ url: `https://${host}/p/${code.toLowerCase()}`, host, title: t, data: { name: t, brand: style === 3 ? '' : realBrand, sku: showsCode ? code : '', ean: showsEan ? ean : '', price: o.price + Math.round((rnd() - 0.5) * 10), currency: host.endsWith('.gr') ? 'EUR' : host.endsWith('.de') ? 'EUR' : 'USD', availability: avail, images: [img, img.replace('-a.', '-b.')] }, truthOf: o.k, fails: rnd() < 0.12 });
    o.shops.add(host);
  }
}
// pages of nothing in particular (blogs, marketplaces)
for (let i = 0; i < 40; i++) world.pages.push({ url: `https://www.skroutz.gr/s/${i}`, host: 'skroutz.gr', title: pick(MODELS) + ' ' + pick(BRANDS), category: true });

// ---------- two search engines over this world ----------
const fold = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9Α-Ω ]+/g, ' ').split(/\s+/).filter(Boolean);
let searches = 0, opened = 0;
function engine(q, variant) {
  const qt = fold(q);
  const flatQ = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const scored = [];
  for (const p of world.pages) {
    const pt = new Set(fold(p.title + ' ' + ((p.data && (p.data.sku + ' ' + p.data.ean)) || '')));
    let s = qt.filter((t) => pt.has(t)).length / Math.max(1, qt.length);
    if (flatQ.length >= 6 && p.data && [p.data.sku, p.data.ean].some((c) => String(c || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === flatQ)) s += 1;
    if (s >= 0.5) scored.push([s + (variant ? rnd() * 0.2 : 0) + (p.category ? 0.05 : 0), p.url]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 10).map((x) => ({ url: x[1] }));
}
function makeIO() {
  return {
    own: new Set(['specialforces.gr']),
    parallel: 4,
    search: async (q) => {
      searches++;
      const a = engine(q, 0);
      const fail = rnd() < 0.1;
      const b = fail ? [] : engine(q, 1);
      const seen = new Set(), out = [];
      for (let i = 0; i < 10; i++) for (const x of [a[i], b[i]]) if (x && !seen.has(x.url)) { seen.add(x.url); out.push(x); }
      out.engines = [{ id: 'ddg', state: 'ok', n: a.length }, fail ? { id: 'bing', state: 'error', error: 'timeout' } : { id: 'bing', state: 'ok', n: b.length }];
      return out;
    },
    page: async (url) => {
      opened++;
      const p = world.pages.find((x) => x.url === url);
      if (!p) throw new Error('404');
      if (p.fails) { p.fails = false; throw new Error('503'); } // fails once (a later research may read it)
      if (p.category) return { url, name: p.title, isProduct: false, price: 0, images: [] };
      return Object.assign({ url, isProduct: true }, p.data);
    },
  };
}

// ---------- the two engines ----------
function oldEngine() {
  const src = execFileSync('git', ['show', `${oldRev}:app/lib/codefind.js`], { cwd: path.join(APP, '..'), encoding: 'utf8' }).replace(/require\('\.\/(\w+)'\)/g, (m, x) => `require(${JSON.stringify(path.join(APP, 'lib', x))})`);
  const f = path.join(tmp, 'codefind-old.js');
  fs.writeFileSync(f, src);
  return require(f);
}
async function measure(cf, label) {
  searches = 0; opened = 0;
  seed = 777; // the same failures for both
  for (const p of world.pages) if (p.truthOf) p.fails = (p.url.length * 7) % 9 === 0;
  const io = makeIO();
  const m = { label, products: world.ours.length, trueShops: 0, foundTrue: 0, hits: 0, correct: 0, wrong: 0, wrongList: [], newSku: 0, wrongSku: 0, newEan: 0, wrongEan: 0, newPhotos: 0, complete: 0, partial: 0, none: 0, withHit: 0 };
  const cfNew = require(path.join(APP, 'lib', 'codefind'));
  for (const o of world.ours) {
    const r = await cf.lookUp({ k: o.k, name: o.name, brand: o.brand, sku: o.sku, ean: o.ean, price: o.price, needs: o.needs }, io);
    m.trueShops += o.shops.size;
    const hosts = new Set();
    for (const h of r.hits) {
      m.hits++;
      const pg = world.pages.find((x) => x.url === h.url);
      const right = !!(pg && pg.truthOf === o.k);
      if (right) { m.correct++; if (!hosts.has(h.host)) { hosts.add(h.host); m.foundTrue++; } } else { m.wrong++; if (m.wrongList.length < 8) m.wrongList.push(`${o.name} ⇄ ${h.name}`); }
    }
    if (r.hits.length) m.withHit++;
    // what it gives: a value two shops agree on (sure in Διορθώσεις), right or wrong
    const agree = (vals) => { const c = new Map(); for (const v of vals) if (v) c.set(v, (c.get(v) || 0) + 1); const top = [...c].sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= 2 && !([...c].filter((x) => x[1] === top[1]).length > 1) ? top[0] : ''; };
    if (!o.sku) { const c = agree(r.hits.map((h) => String(h.code || '').toUpperCase())); if (c) { if (c === o.truth.code) m.newSku++; else m.wrongSku++; } }
    if (!o.ean) { const e = agree(r.hits.map((h) => h.ean)); if (e) { if (e === o.truth.ean) m.newEan++; else m.wrongEan++; } }
    if (r.hits.filter((h) => (h.images || []).length).length >= 2) m.newPhotos++;
    const left = cfNew.openNeeds(o.needs, r.hits.map((h) => Object.assign({ at: new Date().toISOString() }, h)));
    if (!r.hits.length) m.none++; else if (left.length) m.partial++; else m.complete++;
  }
  m.recall = m.trueShops ? Math.round((1000 * m.foundTrue) / m.trueShops) / 10 : 0;
  m.precision = m.hits ? Math.round((1000 * m.correct) / m.hits) / 10 : 0;
  m.searches = searches; m.pagesOpened = opened;
  return m;
}

(async () => {
  require(path.join(APP, 'lib', 'store')).init();
  const res = [await measure(oldEngine(), `παλιά μηχανή (${oldRev})`), await measure(require(path.join(APP, 'lib', 'codefind')), 'νέα μηχανή')];
  if (asJson) { console.log(JSON.stringify(res, null, 2)); return; }
  const rows = [
    ['Προϊόντα', 'products'], ['Καταστήματα που έχουν πραγματικά το ίδιο', 'trueShops'], ['Βρέθηκαν (σωστά καταστήματα)', 'foundTrue'], ['Recall %', 'recall'], ['Αντιστοιχίσεις «ίδιο»', 'hits'], ['Σωστές', 'correct'],
    ['Λανθασμένες', 'wrong'], ['Precision %', 'precision'], ['Νέα SKU (2 πηγές, σωστά)', 'newSku'], ['SKU λάθος', 'wrongSku'], ['Νέα EAN (2 πηγές, σωστά)', 'newEan'], ['EAN λάθος', 'wrongEan'],
    ['Νέες φωτογραφίες (≥2 πηγές)', 'newPhotos'], ['Πλήρεις έρευνες', 'complete'], ['Με ελλείψεις', 'partial'], ['Χωρίς αποτέλεσμα', 'none'], ['Αναζητήσεις', 'searches'], ['Σελίδες που άνοιξαν', 'pagesOpened']];
  console.log('Μέτρηση σε συνθετικό κόσμο με γνωστή απάντηση (όχι ζωντανό internet)\n');
  console.log('                                              ' + res.map((r) => r.label.padStart(22)).join(''));
  for (const [t, k] of rows) console.log(t.padEnd(46) + res.map((r) => String(r[k]).padStart(22)).join(''));
  for (const r of res) if (r.wrongList.length) console.log(`\n${r.label} — λάθος αντιστοιχίσεις:\n  ` + r.wrongList.join('\n  '));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
})().catch((e) => { console.error(e); process.exit(1); });
