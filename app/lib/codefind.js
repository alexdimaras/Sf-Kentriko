'use strict';
// SF Κέντρο — what our products miss (maker's code / SKU, EAN, photos, brand), found on the internet.
// For each product that misses something: web searches (its title; brand + model; brand + code when it has one) on
// every search engine that answers, the shop pages of the results read side by side (the product data every shop
// page carries for Google: name, brand, code, EAN, price, photos), and only a page that shows the SAME product counts
// (the same matching as the price research: brand, model words, colour, pieces, set… — or the same code). What is
// proposed comes only from such pages and is sure when two or more different shops agree (the same code, the same
// EAN, the same photo file). The shops found to sell our products are kept too: proposed as new competitors.
// Nothing is written to the sites: what is found becomes proposals in Διορθώσεις → Κωδικοί, for a yes.
const store = require('./store');
const U = require('./util');

const KEY = 'web-codes';          // { products: { 'site:id': { at, hits: [...], tried } }, shops: { host: {...} } }
const AGAIN_DAYS = 21;            // a product looked up without result is looked up again after three weeks
const PAGES_PER_QUERY = 6;

function data() { const d = store.read(KEY, null) || {}; d.products = d.products || {}; d.shops = d.shops || {}; return d; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }

/** What a product misses that the internet can give. */
function needsOf(p) {
  const n = [];
  if (!String(p.sku || '').trim()) n.push('sku');
  if ((p.images || []).length < 2) n.push('images');
  if (!p.brand) n.push('brand');
  if (p.type === 'simple' && !p.ean) n.push('ean');
  return n;
}
const ORDER = { sku: 0, images: 1, brand: 2, ean: 3 };

/** The products to look up, the most useful first (no code, no photo, no brand, no EAN; in stock; dearer). */
function candidates(limit) {
  const catalog = require('./catalog');
  const L = catalog.links();
  const d = data();
  const now = Date.now();
  const out = [];
  for (const site of catalog.SITES) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      if (site === 'st' && L.stToSf.has(p.id)) continue; // the same product on SpecialForces is looked up once
      const needs = needsOf(p);
      if (!needs.length) continue;
      const k = site + ':' + p.id;
      const prev = d.products[k];
      // looked up: again after three weeks (nothing found) or two months (something found)
      if (prev && now - new Date(prev.at).getTime() < ((prev.hits || []).length ? 60 : AGAIN_DAYS) * 864e5) continue;
      out.push({ k, name: p.name, brand: p.brand || '', sku: p.sku || '', price: p.price || 0, inStock: p.inStock !== false, needs, rank: Math.min(...needs.map((x) => ORDER[x])) });
    }
  }
  out.sort((a, b) => a.rank - b.rank || Number(b.inStock) - Number(a.inStock) || b.price - a.price);
  return out.slice(0, limit || out.length);
}

/** What to type in the searches: the code with the brand (when we have it), the title, the brand with the model words. */
function queriesOf(it) {
  const market = require('./market');
  const title = U.collapse(U.decodeEntities(it.name));
  const brand = U.collapse(U.decodeEntities(it.brand || ''));
  const withBrand = brand && !U.foldKey(title).includes(U.foldKey(brand)) ? brand + ' ' + title : title;
  const keys = market.features({ name: it.name, brand: it.brand }).keys.filter((k) => /[A-Z0-9]/.test(k));
  const qs = [];
  if (it.sku) qs.push(`${brand} ${it.sku}`.trim());
  qs.push(withBrand);
  if (brand && keys.length) qs.push(`${brand} ${keys.join(' ')}`);
  return [...new Set(qs.map((q) => q.trim()).filter((q) => q.length >= 4))];
}
function queryOf(it) { return queriesOf(it)[0]; }

/** Run `fn` over `list`, `n` at a time. */
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => { while (i < list.length) { const x = list[i++]; await fn(x); } }));
}

/**
 * One product: searches, the shop pages read, those that show the same product kept.
 * io = { search(q) → [{ url }], page(url) → { name, brand, code, ean, price, currency, images }, own: Set(host), parallel }
 * → { hits: [{ host, url, name, brand, code, ean, price, img, images, how, proof }], read, queries }
 */
async function lookUp(it, io) {
  const market = require('./market');
  const sfind = require('./supplierfind');
  const seen = new Set(), tried = new Set();
  const hits = [];
  let read = 0, queries = 0;
  const ours = U.normSku(it.sku || '');
  for (const q of queriesOf(it)) {
    if (io.cancelled && io.cancelled()) break;
    // enough: four shops with the same product
    if (hits.length >= 4) break;
    const results = await io.search(q);
    queries++;
    const pages = [];
    for (const r of results || []) {
      const host = hostOf(r.url);
      if (!host || seen.has(host) || tried.has(r.url) || (io.own && io.own.has(host)) || sfind.NEVER.test(host) || !/^https?:\/\//i.test(r.url)) continue;
      seen.add(host); tried.add(r.url);
      pages.push({ host, url: r.url });
      if (pages.length >= PAGES_PER_QUERY) break;
    }
    await pool(pages, io.parallel || 2, async (pg0) => {
      if (io.cancelled && io.cancelled()) return;
      let pg;
      try { pg = await io.page(pg0.url); read++; } catch (_) { return; }
      if (!pg || !pg.name) return;
      // the same product: the same code as ours, or the matching of the price research says «exact»
      const theirs = [pg.code, pg.mpn].map((x) => U.normSku(x || '')).filter((x) => x.length >= 4);
      const sameCode = ours.length >= 4 && (theirs.includes(ours) || U.normSku(pg.name).includes(ours));
      const chk = market.score({ name: it.name, brand: it.brand, sku: it.sku || '', price: it.price }, { name: pg.name, sku: pg.code || '', brand: pg.brand || '', price: Number(pg.price) || 0, ean: pg.ean || '' });
      if (!sameCode && chk.match !== 'exact') return;
      if (sameCode && chk.match === 'none') return; // the same number on another kind of product: no
      const images = (pg.images || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 4);
      hits.push({ host: pg0.host, url: pg.url || pg0.url, name: String(pg.name).slice(0, 200), brand: String(pg.brand || '').slice(0, 60), code: String(pg.code || pg.mpn || '').slice(0, 60), ean: String(pg.ean || '').replace(/\D/g, ''),
        price: pg.currency && pg.currency !== 'EUR' ? 0 : Number(pg.price) || 0, img: images[0] || '', images, how: sameCode ? 'code' : 'words', proof: sameCode ? 'ίδιος κωδικός' : (chk.ev || []).join(' · ') || 'ίδιο προϊόν' });
    });
  }
  return { hits, read, queries };
}

/** Keep what was found for a product, and count the shops that sell our products. */
function save(results) {
  const own = ownHosts();
  store.update(KEY, {}, (d) => {
    d.products = d.products || {}; d.shops = d.shops || {};
    for (const [k, r] of Object.entries(results)) {
      const hits = (r.hits || []).filter((h) => h && h.host && !own.has(h.host)).slice(0, 10);
      d.products[k] = { at: U.nowIso(), hits, read: r.read || 0 };
      for (const h of hits) {
        const s = d.shops[h.host] || { host: h.host, url: 'https://' + h.host + '/', products: [] };
        if (!s.products.includes(k)) s.products.push(k);
        s.products = s.products.slice(-50);
        s.at = U.nowIso();
        d.shops[h.host] = s;
      }
    }
    return d;
  });
  try { require('./fixes').invalidate(); } catch (_) { /* not loaded */ }
}
function ownHosts() { const s = require('./settings').all(); return new Set(['sf', 'st'].map((x) => hostOf(s.sites[x] && s.sites[x].url)).filter(Boolean)); }

/** The pages of the web, for the program itself (the cloud machine). */
function localIO(signal, job) {
  const sfind = require('./supplierfind');
  const extract = require('./extract');
  const state = { blocked: new Set(), used: new Set(), signal };
  return {
    own: ownHosts(),
    search: (q) => sfind.searchWide(q, state),
    page: (url) => extract.fromUrl(url, { gap: 1500 }),
    cancelled: () => !!(job && job.cancelled()),
    parallel: 2,
    state,
  };
}

/**
 * Look up the next `max` products without a code (a job of the program). Stops when the search engines ask for a
 * pause (it goes on the next day). → { looked, withCode, shops, blocked }
 */
async function run(job, opts) {
  opts = opts || {};
  const sfind = require('./supplierfind');
  const list = opts.items || candidates(Math.max(1, Number(opts.max) || 20));
  const io = opts.io || localIO(job && job.signal, job);
  let looked = 0, withCode = 0, blocked = false;
  const results = {};
  job && job.progress(0, list.length, `Έρευνα στο internet: ${list.length} προϊόντα (κωδικός, EAN, φωτογραφίες, μάρκα)…`);
  for (const it of list) {
    if (job && job.cancelled()) break;
    try {
      const r = await lookUp(it, io);
      results[it.k] = r;
      looked++;
      if (r.hits.length) withCode++;
    } catch (e) {
      if (e instanceof sfind.Blocked) { blocked = true; job && job.log('Οι μηχανές αναζήτησης ζήτησαν παύση· η αναζήτηση συνεχίζει αργότερα.'); break; }
      results[it.k] = { hits: [], read: 0 };
    }
    if (looked % 5 === 0) { save(results); for (const k of Object.keys(results)) delete results[k]; }
    job && job.progress(looked, list.length, `Έρευνα στο internet: ${looked}/${list.length} · ίδιο προϊόν σε άλλα καταστήματα για ${withCode}`);
  }
  save(results);
  return { looked, withCode, blocked };
}

/** What the shops of the web say about one of our products (for the proposals). */
function hitsFor(key) { const e = data().products[key]; return e ? e.hits || [] : []; }

/** Shops that sell several of our products and are not competitors yet: proposed for the price research. */
function suggestedShops(min) {
  const market = require('./market');
  const have = new Set(market.competitors().map((c) => hostOf(c.url)));
  return Object.values(data().shops).filter((s) => !have.has(s.host) && s.products.length >= (min || 3)).sort((a, b) => b.products.length - a.products.length).slice(0, 20).map((s) => ({ host: s.host, url: s.url, count: s.products.length, at: s.at }));
}

/** How far the search has come. */
function status() {
  const d = data();
  const all = Object.values(d.products);
  return { looked: all.length, withCode: all.filter((e) => (e.hits || []).length).length, waiting: candidates().length };
}

module.exports = { candidates, lookUp, run, save, hitsFor, suggestedShops, status, queryOf, queriesOf, needsOf, KEY };
