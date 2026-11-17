'use strict';
// SF Κέντρο — the maker's code (SKU) and EAN of our products that have none, found on the internet.
// For each product without a code: a web search with its title, the shop pages of the results are read (the product
// data every shop page carries for Google: name, brand, code, EAN, price), and only a page that shows the SAME
// product (the same matching as the price research: brand, model words, colour, set…) counts. A code is proposed
// only from such pages, and is sure when two or more different shops give the same one. The shops found to sell
// the same products are also kept: they are proposed as new competitors for the price research.
// Nothing is written to the sites: what is found becomes proposals in Διορθώσεις → Κωδικοί, for a yes.
const store = require('./store');
const U = require('./util');

const KEY = 'web-codes';          // { products: { 'site:id': { at, hits: [...], tried } }, shops: { host: {...} } }
const AGAIN_DAYS = 21;            // a product looked up without result is looked up again after three weeks
const PAGES_PER_PRODUCT = 5;

function data() { const d = store.read(KEY, null) || {}; d.products = d.products || {}; d.shops = d.shops || {}; return d; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }

/** The products to look up, most useful first (in stock, dearer), skipping those looked up recently. */
function candidates(limit) {
  const catalog = require('./catalog');
  const L = catalog.links();
  const d = data();
  const now = Date.now();
  const out = [];
  for (const site of catalog.SITES) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private' || String(p.sku || '').trim()) continue;
      if (site === 'st' && L.stToSf.has(p.id)) continue; // the same product on SpecialForces is looked up once
      const k = site + ':' + p.id;
      const prev = d.products[k];
      if (prev && now - new Date(prev.at).getTime() < AGAIN_DAYS * 864e5) continue;
      out.push({ k, name: p.name, brand: p.brand || '', price: p.price || 0, inStock: p.inStock !== false });
    }
  }
  out.sort((a, b) => Number(b.inStock) - Number(a.inStock) || b.price - a.price);
  return out.slice(0, limit || out.length);
}

/** What to type in the search: the title (it names brand and model); with a brand that is not in it, the brand too. */
function queryOf(it) {
  let q = U.collapse(U.decodeEntities(it.name));
  if (it.brand && !U.foldKey(q).includes(U.foldKey(it.brand))) q = it.brand + ' ' + q;
  return q;
}

/**
 * One product: search, read the shop pages, keep those that show the same product.
 * io = { search(q) → [{ url, title }], page(url) → { name, brand, code, ean, price, currency, images }, own: Set(host) }
 * → { hits: [{ host, url, name, code, ean, price, img, proof }], read }
 */
async function lookUp(it, io) {
  const market = require('./market');
  const sfind = require('./supplierfind');
  const results = await io.search(queryOf(it));
  const seen = new Set();
  const pages = [];
  for (const r of results || []) {
    const host = hostOf(r.url);
    if (!host || seen.has(host) || (io.own && io.own.has(host)) || sfind.NEVER.test(host) || !/^https?:\/\//i.test(r.url)) continue;
    seen.add(host);
    pages.push({ host, url: r.url });
    if (pages.length >= PAGES_PER_PRODUCT) break;
  }
  const hits = [];
  let read = 0;
  for (const pg0 of pages) {
    if (io.cancelled && io.cancelled()) break;
    let pg;
    try { pg = await io.page(pg0.url); read++; } catch (_) { continue; }
    if (!pg || !pg.name) continue;
    const chk = market.score({ name: it.name, brand: it.brand, sku: '', price: it.price }, { name: pg.name, sku: pg.code || '', brand: pg.brand || '', price: Number(pg.price) || 0, ean: pg.ean || '' });
    // only the SAME product: a proof of brand and model in the titles, nothing «similar»
    if (chk.match !== 'exact') continue;
    hits.push({ host: pg0.host, url: pg.url || pg0.url, name: String(pg.name).slice(0, 200), brand: pg.brand || '', code: String(pg.code || '').slice(0, 60), ean: String(pg.ean || '').replace(/\D/g, ''),
      price: pg.currency && pg.currency !== 'EUR' ? 0 : Number(pg.price) || 0, img: (pg.images || [])[0] || '', proof: (chk.ev || []).join(' · ') || 'ίδιο προϊόν' });
  }
  return { hits, read };
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
    search: (q) => sfind.search(q, state),
    page: (url) => extract.fromUrl(url, { gap: 1500 }),
    cancelled: () => !!(job && job.cancelled()),
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
  job && job.progress(0, list.length, `Κωδικοί από το internet: ${list.length} προϊόντα χωρίς κωδικό…`);
  for (const it of list) {
    if (job && job.cancelled()) break;
    try {
      const r = await lookUp(it, io);
      results[it.k] = r;
      looked++;
      if (r.hits.some((h) => h.code || h.ean)) withCode++;
    } catch (e) {
      if (e instanceof sfind.Blocked) { blocked = true; job && job.log('Οι μηχανές αναζήτησης ζήτησαν παύση· η αναζήτηση συνεχίζει αργότερα.'); break; }
      results[it.k] = { hits: [], read: 0 };
    }
    if (looked % 5 === 0) { save(results); for (const k of Object.keys(results)) delete results[k]; }
    job && job.progress(looked, list.length, `Κωδικοί από το internet: ${looked}/${list.length} · βρέθηκε κάτι για ${withCode}`);
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
  return { looked: all.length, withCode: all.filter((e) => (e.hits || []).some((h) => h.code || h.ean)).length, waiting: candidates().length };
}

module.exports = { candidates, lookUp, run, save, hitsFor, suggestedShops, status, queryOf, KEY };
