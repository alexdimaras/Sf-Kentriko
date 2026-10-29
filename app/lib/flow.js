'use strict';
// The order of work, product by product: 1 code (SKU) → 2 facts (brand, category, title, rules) →
// 3 description and photos → 4 price → 5 ready. A product sits at the FIRST step that still has an open problem:
// prices are only worked on for products whose code, facts and texts are already right, so no price is
// decided on a product that is still wrong or incomplete. Everything here is computed from what the program
// already knows (catalog, checks, ready fixes, market results); nothing is stored.
const catalog = require('./catalog');
const checks = require('./checks');
const fixes = require('./fixes');
const market = require('./market');

const STAGES = [
  { n: 1, id: 'code', title: 'Κωδικός', help: 'Κάθε προϊόν έχει δικό του κωδικό (SKU), μοναδικό, ίδιο και στα δύο sites.' },
  { n: 2, id: 'facts', title: 'Στοιχεία', help: 'Μάρκα, κατηγορία, σωστός τίτλος (ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ) και κανόνες διαφημίσεων.' },
  { n: 3, id: 'content', title: 'Περιγραφή και φωτογραφίες', help: 'Περιγραφή που βοηθά τον πελάτη και το SEO, και τουλάχιστον μία φωτογραφία.' },
  { n: 4, id: 'price', title: 'Τιμή', help: 'Τιμή μεγαλύτερη από το κόστος, ίδια στα δύο sites και σωστή μπροστά στην αγορά.' },
  { n: 5, id: 'ready', title: 'Έτοιμο', help: 'Όλα σωστά: τίποτα δεν περιμένει.' },
];

// check id (without the site prefix) → step
const STAGE_OF_CHECK = {
  nobrand: 2, nocat: 2, mixed: 2, typos: 2, suspect: 2, typefirst: 2, caps: 2, accents: 2, spaces: 2, 'ads-banned': 2, 'ads-google': 2,
  nodesc: 3, noimg: 3,
  'x-price': 4, 'x-price-zero': 4,
};
const FIELD_OF = { mixed: 'name', typos: 'name', suspect: 'name', typefirst: 'name', caps: 'name', accents: 'name', spaces: 'name', nodesc: 'desc', noimg: 'images', nobrand: 'brand', nocat: 'cats', 'x-price': 'price', 'ads-banned': 'published', 'ads-google': 'gla' };

const skuKey = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
let memo = null;

/** One answer for the whole catalog: { rows: Map('site:id' → row), stages: [...] }. */
function compute() {
  const ck = checks.cached();
  const fxItems = fixes.compute().items;
  const mk = market.results();
  const cats = catalog.SITES.map((s) => catalog.load(s));
  if (memo && memo.ck === ck && memo.fx === fxItems && memo.mk === mk && memo.cats.every((c, i) => c === cats[i])) return memo.out;

  const L = catalog.links();
  const fxBy = new Map(); // 'site:pid:field' → fix
  for (const x of fxItems) if (x.status !== 'rejected') fxBy.set(`${x.site}:${x.pid}:${x.field}`, x);
  const rows = new Map();
  const bySite = {};
  catalog.SITES.forEach((site, i) => {
    bySite[site] = new Map(cats[i].products.filter((p) => p.type !== 'variation').map((p) => [p.id, p]));
    for (const p of bySite[site].values()) {
      if (p.status === 'draft' || p.status === 'private') continue;
      rows.set(`${site}:${p.id}`, { site, id: p.id, name: p.name, sku: p.sku || '', img: p.thumb || (p.images || [])[0] || '', url: p.url, price: p.price, problems: [] });
    }
  });
  const problem = (site, id, n, kind, text, field, extra) => {
    const r = rows.get(`${site}:${id}`);
    if (!r) return;
    const fx = field ? fxBy.get(`${site}:${id}:${field}`) : null;
    // state: a ready fix waits for a yes ('approve'), is approved or already in the file ('done'), or only a person can solve it ('manual')
    const state = fx ? (fx.status === 'pending' ? 'approve' : 'done') : 'manual';
    r.problems.push(Object.assign({ stage: n, kind, text, field: field || '', state, fixId: fx ? fx.id : '' }, extra || {}));
  };

  // 1. codes
  for (const site of catalog.SITES) {
    const seen = new Map();
    for (const p of bySite[site].values()) { const k = skuKey(p.sku); if (k) { if (!seen.has(k)) seen.set(k, []); seen.get(k).push(p.id); } }
    for (const p of bySite[site].values()) {
      const k = skuKey(p.sku);
      if (!k) {
        const other = site === 'sf' ? L.sfToSt : L.stToSf;
        const o = other.get(p.id) != null ? bySite[site === 'sf' ? 'st' : 'sf'].get(other.get(p.id)) : null;
        problem(site, p.id, 1, 'nosku', 'Χωρίς κωδικό (SKU)', '', o && o.sku ? { hint: `Το ίδιο προϊόν στο άλλο site έχει κωδικό ${o.sku}`, suggest: o.sku } : {});
      } else if (seen.get(k).length > 1) {
        problem(site, p.id, 1, 'dupsku', `Ο ίδιος κωδικός «${p.sku}» υπάρχει σε ${seen.get(k).length} προϊόντα`, '', { hint: 'Κάθε προϊόν χρειάζεται δικό του κωδικό (εκτός αν είναι το ίδιο προϊόν δύο φορές).' });
      }
    }
  }
  for (const [sfId, stId] of L.sfToSt) {
    const a = bySite.sf.get(sfId), b = bySite.st.get(stId);
    if (a && b && skuKey(a.sku) && skuKey(b.sku) && skuKey(a.sku) !== skuKey(b.sku)) problem('st', stId, 1, 'skudiff', `Άλλος κωδικός από το κεντρικό site (${a.sku})`, '', { hint: `Σωστός θεωρείται ο κωδικός του κεντρικού site: ${a.sku}`, suggest: a.sku });
  }

  // 2-4. what the catalog checks already found; a ready fix, if any, is attached to it
  for (const c of ck.checks) {
    const base = c.id.replace(/^(sf|st)-/, '');
    const n = STAGE_OF_CHECK[base];
    if (!n || c.severity === 'info') continue;
    for (const it of c.items) problem(it.site, it.id, n, base, c.title, FIELD_OF[base] || '');
  }
  // 4. price: no price, selling below cost, and what the market says
  for (const [key, r] of rows) {
    const site = r.site;
    if (!(r.price > 0)) problem(site, r.id, 4, 'noprice', 'Χωρίς τιμή', 'price');
    let e = mk[key];
    if (!e && site === 'st') { const sf = L.stToSf.get(r.id); if (sf != null) e = mk['sf:' + sf]; }
    if (e && r.price > 0) {
      if (e.loss) problem(site, r.id, 4, 'loss', 'Πουλιέται κάτω από το κόστος', '', { hint: e.reason, suggest: e.suggested });
      else if (e.action === 'lower' || e.action === 'raise') problem(site, r.id, 4, 'market-' + e.action, e.action === 'lower' ? 'Ακριβότερο από την αγορά' : 'Φθηνότερο από την αγορά', '', { hint: e.reason, suggest: e.suggested, state: 'decide' });
    }
  }

  // not allowed on the ads site: only "take it off" is asked, nothing else (no text, photo or price work)
  const banned = catalog.bannedOnAds();
  for (const r of rows.values()) if (r.site === 'st' && banned.has(r.id)) r.problems = r.problems.filter((x) => x.kind === 'ads-banned');

  const stages = STAGES.map((s) => ({ n: s.n, id: s.id, title: s.title, help: s.help, count: { sf: 0, st: 0 }, approve: 0, manual: 0, done: 0 }));
  for (const r of rows.values()) {
    const open = r.problems.filter((x) => x.state !== 'done');
    r.stage = open.length ? Math.min(...open.map((x) => x.stage)) : 5;
    r.waitingFile = r.stage === 5 && r.problems.some((x) => x.state === 'done');
    const s = stages[r.stage - 1];
    s.count[r.site]++;
    if (r.stage < 5) {
      const here = open.filter((x) => x.stage === r.stage);
      if (here.every((x) => x.state === 'approve')) s.approve++; else if (here.some((x) => x.state === 'manual')) s.manual++; else s.approve++;
    } else if (r.waitingFile) s.done++;
  }
  const total = { sf: 0, st: 0 };
  for (const r of rows.values()) total[r.site]++;
  const out = { rows, stages, total };
  memo = { ck, fx: fxItems, mk, cats, out };
  return out;
}

/** Step of one product (5 = ready), for other screens. */
function stageOf(site, id) {
  const r = compute().rows.get(`${site}:${id}`);
  return r ? r.stage : 0;
}

/** For the screen: the steps with their counts, the first step with work, and the products of one step. */
function view(q) {
  q = q || {};
  const { rows, stages, total } = compute();
  const first = stages.find((s) => s.n < 5 && (s.count.sf + s.count.st) > 0);
  const want = Number(q.stage) || (first ? first.n : 5);
  const site = q.site === 'sf' || q.site === 'st' ? q.site : '';
  const needle = String(q.q || '').trim().toUpperCase();
  let list = [...rows.values()].filter((r) => r.stage === want && (!site || r.site === site));
  if (needle) list = list.filter((r) => r.name.toUpperCase().includes(needle) || skuKey(r.sku).includes(skuKey(needle)));
  const order = { manual: 0, decide: 1, approve: 2, done: 3 };
  list.sort((a, b) => (Math.min(...a.problems.map((x) => order[x.state] ?? 0)) - Math.min(...b.problems.map((x) => order[x.state] ?? 0))) || a.name.localeCompare(b.name, 'el'));
  return {
    stages, total, next: first ? first.n : 5, stage: want, matches: list.length,
    rows: list.slice(0, 300).map((r) => ({ site: r.site, id: r.id, name: r.name, sku: r.sku, img: r.img, price: r.price, waitingFile: r.waitingFile, problems: r.problems.filter((x) => x.stage === want || want === 5) })),
  };
}

/** Counts for the Today screen. */
function summary() {
  try {
    const { stages, total } = compute();
    const first = stages.find((s) => s.n < 5 && (s.count.sf + s.count.st) > 0);
    const ready = stages[4].count.sf + stages[4].count.st;
    return { stages, total, next: first || null, ready, products: total.sf + total.st };
  } catch (e) { return { stages: [], total: { sf: 0, st: 0 }, next: null, ready: 0, products: 0, error: e.message }; }
}

module.exports = { STAGES, compute, stageOf, view, summary };
