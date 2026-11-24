'use strict';
// Competitor catalogs: the whole public product list of each competitor shop, downloaded and kept
// on this PC (WooCommerce Store API or Shopify products.json), so every one of our products can be
// compared locally in seconds, without searching product by product.
// Later downloads only fetch what changed (WooCommerce) — a full read happens once a week.
const store = require('./store');
const settings = require('./settings');
const http = require('./http');
const U = require('./util');

// global_unique_id: WooCommerce's own GTIN / EAN field (9.2+), when the shop's API gives it
const WOO_FIELDS = 'id,name,sku,permalink,prices,is_in_stock,brands,attributes,images,type,global_unique_id';

function file(id) { return 'comp-' + id; }
function load(id) { return store.read(file(id), () => ({ products: [], at: null })); }
function remove(id) { try { store.write(file(id), { products: [], at: null, removed: true }); } catch (_) { /* ignore */ } }

function brandOfWoo(p) {
  if (p.brands && p.brands[0] && p.brands[0].name) return U.decodeEntities(p.brands[0].name);
  const a = (p.attributes || []).find((x) => /κατασκευαστ|brand|μάρκ|μαρκ|marka/i.test(x.name || ''));
  return a && a.terms && a.terms[0] ? U.decodeEntities(a.terms[0].name) : '';
}
/** A real GTIN / EAN (check digit), never a made-up number: the shop's field, or an «EAN» attribute with one value. */
function gtinOf(v) { return require('./extract').validGtin(v); }
function wooGtin(p) {
  const d = gtinOf(p.global_unique_id || p.gtin || p.ean || '');
  if (d) return d;
  const a = (p.attributes || []).find((x) => /^(ean|gtin|upc|barcode|ean-?13|κωδικός ean|κωδικοσ ean|γραμμωτός κώδικας)$/i.test(U.collapse(U.decodeEntities(x.name || ''))) && x.terms && x.terms.length === 1);
  return a ? gtinOf(a.terms[0].name) : '';
}
function fromWoo(p) {
  const pr = p.prices || {};
  const unit = Number(pr.currency_minor_unit == null ? 2 : pr.currency_minor_unit);
  const f = (v) => (v == null || v === '' ? 0 : Number(v) / Math.pow(10, unit));
  const range = pr.price_range || null;
  const img = (p.images && p.images[0]) || null;
  return {
    id: p.id,
    n: U.untexturize(U.decodeEntities(p.name || '')),
    s: U.decodeEntities(p.sku || ''),
    b: brandOfWoo(p),
    u: p.permalink || '',
    p: f(pr.price) || (range ? f(range.min_amount) : 0),
    pm: range ? f(range.max_amount) : 0,
    r: f(pr.regular_price),
    st: p.is_in_stock === true ? true : p.is_in_stock === false ? false : null,
    i: img ? (img.thumbnail || img.src || '') : '',
    c: pr.currency_code || 'EUR',
    ...(wooGtin(p) ? { g: wooGtin(p) } : {}),
  };
}
function fromShopify(p, base) {
  const vs = p.variants || [];
  // the price a buyer can pay today: the cheapest of the sizes / colours IN STOCK (a cheap size sold out is not
  // the shop's price); none in stock → the product is sold out, shown with its lowest price
  const avail = vs.filter((v) => v.available !== false);
  const pool = avail.length ? avail : vs;
  const prices = pool.map((v) => U.parseNumber(v.price)).filter((x) => x > 0);
  const compare = pool.map((v) => U.parseNumber(v.compare_at_price)).filter((x) => x > 0);
  const img = (p.images && p.images[0] && p.images[0].src) || '';
  // one code / EAN for the product only when all its sizes and colours share it (the first size's code is not the
  // product's): the common part of the codes (K16110-01-S, -M → K16110-01); every EAN of the variants kept apart (gs)
  const skus = [...new Set(vs.map((v) => String(v.sku || '').trim()).filter(Boolean))];
  const eans = [...new Set(vs.map((v) => gtinOf(v.barcode)).filter(Boolean))];
  const sku = skus.length <= 1 ? skus[0] || '' : require('./extract').commonCode(skus);
  // the variants, kept one by one ONLY when they differ in colour (a product in Black / Coyote / Olive): the price, the
  // stock, the code and the EAN of OUR colour are then taken, never the cheapest of any colour (spec 2.0, P1). Sizes
  // alone are the same product (ours has the sizes too): not kept — the memory of the small cloud machine is spared.
  let vlist = null;
  if (vs.length > 1) {
    const mk = require('./market');
    const opt = (v) => U.collapse([v.option1, v.option2, v.option3].filter((x) => x && !/^default title$/i.test(x)).join(' / ') || v.title || '');
    const cols = new Set(vs.map((v) => [...mk.coloursOf(opt(v))].sort().join('+')).filter(Boolean));
    if (cols.size >= 2) vlist = vs.slice(0, 40).map((v) => ({ o: opt(v).slice(0, 60), s: String(v.sku || '').trim(), g: gtinOf(v.barcode) || '', p: U.parseNumber(v.price) || 0, r: U.parseNumber(v.compare_at_price) || 0, st: v.available !== false }));
  }
  return {
    id: p.id,
    n: U.decodeEntities(p.title || ''),
    s: sku,
    g: eans.length === 1 && vs.every((v) => gtinOf(v.barcode) === eans[0]) ? eans[0] : '',
    ...(eans.length > 1 ? { gs: eans.slice(0, 20) } : {}),
    b: p.vendor || '',
    u: base + '/products/' + p.handle,
    p: prices.length ? Math.min(...prices) : 0,
    pm: prices.length ? Math.max(...prices) : 0,
    r: compare.length ? Math.max(...compare) : 0,
    st: avail.length > 0,
    i: img ? img.replace(/(\.[a-z]+)(\?|$)/i, '_200x$1$2') : '',
    c: 'EUR',
    ...(vlist ? { v: vlist } : {}),
  };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 19);

// a kept piece of a long answer keeps the whole answer in memory: each product is copied out (see catalog.fromStoreApiPacked)
const fresh = (o) => JSON.parse(JSON.stringify(o));
const fromWooFresh = (p) => fresh(fromWoo(p));
/** map: each page converted as it arrives (the raw answers of a whole shop are never kept together). */
async function wooPages(base, query, gap, onPage, cancelled, headers, map, signal) {
  const url = (pg) => `${base}/wp-json/wc/store/v1/products?per_page=100&page=${pg}${query ? '&' + query : ''}`;
  const first = await http.getJson(url(1), { gap, timeout: 60000, retries: 2, headers, signal });
  if (!Array.isArray(first.json)) throw new Error('Μη αναμενόμενη απάντηση');
  const pages = parseInt(first.headers.get('x-wp-totalpages') || '1', 10) || 1;
  const total = parseInt(first.headers.get('x-wp-total') || '0', 10) || first.json.length;
  const conv = (list) => (map ? list.map(map) : list);
  const out = conv(first.json);
  onPage && onPage(first.json.length, total);
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);
  // two requests at a time per competitor, with a pause between them: polite, never a load on their shop
  await http.pool(rest, 2, async (pg) => {
    const r = await http.getJson(url(pg), { gap, timeout: 60000, retries: 2, headers, signal });
    // a page that does not answer with products fails the whole reading: a catalog with a hole is never kept
    // (the previous, whole one stays until a reading succeeds)
    if (!Array.isArray(r.json)) throw new Error(`Η σελίδα ${pg} από ${pages} του καταλόγου δεν διαβάστηκε σωστά: κρατιέται ο προηγούμενος κατάλογος.`);
    const n = r.json.length; for (const x of conv(r.json)) out.push(x); onPage && onPage(n, 0);
  }, cancelled);
  if (cancelled && cancelled()) return { items: out, total, partial: true };
  // the shop said how many products it has: a reading with clearly fewer (a page lost on the way) is not kept
  if (total && out.length < total * 0.98 && pages > 1) throw new Error(`Διαβάστηκαν ${out.length} από ${total} προϊόντα του καταλόγου: κρατιέται ο προηγούμενος κατάλογος.`);
  return { items: out, total };
}

async function syncWoo(c, prev, opts) {
  const gap = opts.gap;
  const H = opts.headers;
  const started = Date.now();
  const daysSinceFull = prev.lastFullAt ? (started - new Date(prev.lastFullAt).getTime()) / 864e5 : Infinity;
  const full = opts.full || !!H || !prev.products.length || daysSinceFull >= 7 || !prev.syncStartedAt || prev.kind !== 'woo';
  const onPage = (n, total) => { if (total) opts.prog.addTotal(total); opts.prog.add(n); };
  let items, mode;
  if (full) {
    mode = 'full';
    let r;
    try { r = await wooPages(c.url, '_fields=' + WOO_FIELDS, gap, onPage, opts.cancelled, H, fromWooFresh, opts.signal); } catch (e) {
      if (e.status !== 400) throw e;
      r = await wooPages(c.url, '', gap, onPage, opts.cancelled, H, fromWooFresh, opts.signal);
    }
    items = r.items;
  } else {
    mode = 'changes';
    const since = iso(new Date(prev.syncStartedAt).getTime() - 2 * 3600e3);
    const changed = (await wooPages(c.url, `after=${encodeURIComponent(since)}&date_column=modified_gmt&_fields=${WOO_FIELDS}`, gap, onPage, opts.cancelled, H, fromWooFresh, opts.signal)).items;
    const map = new Map(prev.products.map((p) => [p.id, p]));
    for (const p of changed) map.set(p.id, p);
    const head = await http.getJson(`${c.url}/wp-json/wc/store/v1/products?per_page=1&_fields=id`, { gap, timeout: 30000, headers: H, signal: opts.signal });
    const total = parseInt(head.headers.get('x-wp-total') || '0', 10);
    if (total && total !== map.size) {
      // something was deleted or hidden: read the list of ids (small pages) and fill the gaps
      const ids = new Set((await wooPages(c.url, '_fields=id', gap, null, opts.cancelled, H, null, opts.signal)).items.map((x) => x.id));
      for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
      const missing = [...ids].filter((id) => !map.has(id));
      for (let i = 0; i < missing.length; i += 100) {
        const r = await http.getJson(`${c.url}/wp-json/wc/store/v1/products?per_page=100&include=${missing.slice(i, i + 100).join(',')}&_fields=${WOO_FIELDS}`, { gap, timeout: 60000, headers: H, signal: opts.signal });
        for (const p of r.json || []) map.set(p.id, fromWooFresh(p));
      }
    }
    items = [...map.values()];
  }
  return { items, mode, full, started };
}

async function syncShopify(c, prev, opts) {
  const started = Date.now();
  const items = [];
  let total = 0, limitReached = false;
  const MAX_PAGES = 200; // 50.000 products: a shop bigger than this is read in part — and said so, never «whole»
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (opts.cancelled && opts.cancelled()) break;
    const r = await http.getJson(`${c.url}/products.json?limit=250&page=${page}`, { gap: opts.gap, timeout: 60000, retries: 2, headers: opts.headers, signal: opts.signal });
    const list = (r.json && r.json.products) || [];
    if (!list.length) break;
    total += list.length;
    opts.prog.addTotal(list.length);
    opts.prog.add(list.length);
    for (const p of list) items.push(fresh(fromShopify(p, c.url)));
    if (list.length < 250) break;
    if (page === MAX_PAGES) limitReached = true;
  }
  void total;
  return { items, mode: 'full', full: !limitReached, limitReached, started };
}

/**
 * A shop without a public product list (PrestaShop, OpenCart, Joomla…): read little by little through its site map
 * (lib/sitemapcat.js). What is read is written every few pages, so nothing is lost when the run is stopped.
 */
async function syncSitemap(c, prev, o) {
  const sm = require('./sitemapcat');
  const t0 = Date.now();
  const keep = (st, done) => {
    const items = st.products.filter((p) => p.n && p.p > 0 && (!p.c || p.c === 'EUR'));
    store.write(file(c.id), { kind: 'sitemap', url: c.url, at: U.nowIso(), syncStartedAt: new Date(t0).toISOString(), mode: 'staged', seconds: Math.round((Date.now() - t0) / 1000), count: items.length, products: items, pages: st.pages, sitemaps: st.sitemaps, wanted: st.wanted, mapUrls: st.mapUrls, left: st.left, opened: st.opened, mapWhole: st.mapWhole !== false, complete: !!done && st.left === 0 && st.mapWhole !== false });
    return items.length;
  };
  let total = 0, shown = 0;
  const st = await sm.sync(c, prev.kind === 'sitemap' ? prev : null, {
    want: o.want, budget: o.budget, gap: Math.max(1200, o.gap), signal: o.signal, cancelled: o.cancelled, headers: o.headers,
    // page by page on the screen (it used to stay at 0 until the whole shop was read: it looked stuck)
    onProgress: (done, tot, note) => { if (note) { o.prog.note(note); return; } if (tot && !total) { total = tot; o.prog.note(''); o.prog.addTotal(tot); } if (done > shown) { o.prog.add(done - shown); shown = done; } },
    save: async (s2) => { keep(s2, false); },
  });
  if (st.opened > shown) o.prog.add(st.opened - shown);
  if (total > st.opened) o.prog.add(total - st.opened); // stopped at its time limit: the bar ends full (the rest next time)
  const count = keep(st, true);
  return { id: c.id, name: c.name, count, mode: 'staged', seconds: Math.round((Date.now() - t0) / 1000), left: st.left, opened: st.opened, wanted: st.wanted };
}

/** Download (or update) one competitor's catalog. */
async function syncOne(c, opts) {
  const prev = load(c.id);
  const t0 = Date.now();
  const gap = Math.max(300, Number(settings.all().competitorGap) || 900);
  const o = Object.assign({ gap }, opts);
  if (c.kind === 'sitemap') return syncSitemap(c, prev, o);
  const r = c.kind === 'shopify' ? await syncShopify(c, prev, o) : await syncWoo(c, prev, o);
  if (o.cancelled && o.cancelled()) return null;
  // keep only products with a price, in euro
  const items = r.items.filter((p) => p.n && p.p > 0 && (!p.c || p.c === 'EUR'));
  const out = {
    kind: c.kind, url: c.url, at: U.nowIso(), syncStartedAt: new Date(r.started).toISOString(),
    lastFullAt: r.full ? new Date(r.started).toISOString() : prev.lastFullAt, mode: r.mode,
    seconds: Math.round((Date.now() - t0) / 1000), count: items.length, products: items,
    ...(r.limitReached ? { limitReached: true } : {}),
  };
  store.write(file(c.id), out);
  return { id: c.id, name: c.name, count: items.length, mode: r.mode, seconds: out.seconds };
}

/** Update every readable competitor, several at the same time (each one politely, one after the other page). */
async function syncAll(comps, job, progress, extra) {
  const out = [];
  const errors = [];
  // on a small machine (512 MB) one shop at a time: five catalogs and site maps being read together took ~490 MB
  await http.pool(comps, require('./bg').small ? 1 : 5, async (c) => {
    if (job && job.cancelled()) return;
    const prog = progress.site('c-' + c.id, c.name);
    try {
      const r = await syncOne(c, Object.assign({ prog, cancelled: () => !!(job && job.cancelled()), full: false, signal: job && job.signal }, extra || {}));
      if (r) { out.push(r); job && job.log(r.mode === 'staged' ? `${c.name}: ${r.count.toLocaleString('el-GR')} προϊόντα ως τώρα (χάρτης του site: άνοιξαν ${r.opened} σελίδες${r.left ? ', μένουν ' + r.left.toLocaleString('el-GR') + ' για τις επόμενες φορές' : ', όλες όσες μας αφορούν'})` : `${c.name}: ${r.count.toLocaleString('el-GR')} προϊόντα (${r.mode === 'full' ? 'πλήρης' : 'αλλαγές'}, ${r.seconds} δευτ.)`); }
      prog.note('έτοιμο');
    } catch (e) {
      if (e && e.cancelled) return; // stopped by the person: not a failure of the shop
      errors.push({ id: c.id, name: c.name, error: e.message });
      job && job.log(`${c.name}: ${e.message}`);
      prog.note('σφάλμα');
    }
  });
  return { done: out, errors };
}

function info(id) {
  const c = load(id);
  return { at: c.at, count: c.count || (c.products || []).length, mode: c.mode, seconds: c.seconds, lastFullAt: c.lastFullAt, left: c.left, wanted: c.wanted, mapUrls: c.mapUrls, mapWhole: c.mapWhole !== false, limitReached: !!c.limitReached,
    // the catalog of the shop read whole? (a site map still being read, or a shop over the page limit: in part)
    complete: c.kind === 'sitemap' ? !!c.complete : !c.limitReached };
}

module.exports = { load, remove, syncOne, syncAll, info, fromWoo, fromShopify };
