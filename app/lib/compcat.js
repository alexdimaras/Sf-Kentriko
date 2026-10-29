'use strict';
// Competitor catalogs: the whole public product list of each competitor shop, downloaded and kept
// on this PC (WooCommerce Store API or Shopify products.json), so every one of our products can be
// compared locally in seconds, without searching product by product.
// Later downloads only fetch what changed (WooCommerce) — a full read happens once a week.
const store = require('./store');
const settings = require('./settings');
const http = require('./http');
const U = require('./util');

const WOO_FIELDS = 'id,name,sku,permalink,prices,is_in_stock,brands,attributes,images,type';

function file(id) { return 'comp-' + id; }
function load(id) { return store.read(file(id), () => ({ products: [], at: null })); }
function remove(id) { try { store.write(file(id), { products: [], at: null, removed: true }); } catch (_) { /* ignore */ } }

function brandOfWoo(p) {
  if (p.brands && p.brands[0] && p.brands[0].name) return U.decodeEntities(p.brands[0].name);
  const a = (p.attributes || []).find((x) => /κατασκευαστ|brand|μάρκ|μαρκ|marka/i.test(x.name || ''));
  return a && a.terms && a.terms[0] ? U.decodeEntities(a.terms[0].name) : '';
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
    s: p.sku || '',
    b: brandOfWoo(p),
    u: p.permalink || '',
    p: f(pr.price) || (range ? f(range.min_amount) : 0),
    pm: range ? f(range.max_amount) : 0,
    r: f(pr.regular_price),
    st: p.is_in_stock !== false,
    i: img ? (img.thumbnail || img.src || '') : '',
    c: pr.currency_code || 'EUR',
  };
}
function fromShopify(p, base) {
  const vs = p.variants || [];
  const prices = vs.map((v) => U.parseNumber(v.price)).filter((x) => x > 0);
  const compare = vs.map((v) => U.parseNumber(v.compare_at_price)).filter((x) => x > 0);
  const img = (p.images && p.images[0] && p.images[0].src) || '';
  return {
    id: p.id,
    n: U.decodeEntities(p.title || ''),
    s: (vs.find((v) => v.sku) || {}).sku || '',
    g: (vs.find((v) => v.barcode) || {}).barcode || '',
    b: p.vendor || '',
    u: base + '/products/' + p.handle,
    p: prices.length ? Math.min(...prices) : 0,
    pm: prices.length ? Math.max(...prices) : 0,
    r: compare.length ? Math.max(...compare) : 0,
    st: vs.some((v) => v.available !== false),
    i: img ? img.replace(/(\.[a-z]+)(\?|$)/i, '_200x$1$2') : '',
    c: 'EUR',
  };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 19);

async function wooPages(base, query, gap, onPage, cancelled, headers) {
  const url = (pg) => `${base}/wp-json/wc/store/v1/products?per_page=100&page=${pg}${query ? '&' + query : ''}`;
  const first = await http.getJson(url(1), { gap, timeout: 60000, retries: 2, headers });
  if (!Array.isArray(first.json)) throw new Error('Μη αναμενόμενη απάντηση');
  const pages = parseInt(first.headers.get('x-wp-totalpages') || '1', 10) || 1;
  const total = parseInt(first.headers.get('x-wp-total') || '0', 10) || first.json.length;
  const out = first.json.slice();
  onPage && onPage(first.json.length, total);
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);
  // two requests at a time per competitor, with a pause between them: polite, never a load on their shop
  await http.pool(rest, 2, async (pg) => {
    const r = await http.getJson(url(pg), { gap, timeout: 60000, retries: 2, headers });
    if (Array.isArray(r.json)) { out.push(...r.json); onPage && onPage(r.json.length, 0); }
  }, cancelled);
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
    try { r = await wooPages(c.url, '_fields=' + WOO_FIELDS, gap, onPage, opts.cancelled, H); } catch (e) {
      if (e.status !== 400) throw e;
      r = await wooPages(c.url, '', gap, onPage, opts.cancelled, H);
    }
    items = r.items.map(fromWoo);
  } else {
    mode = 'changes';
    const since = iso(new Date(prev.syncStartedAt).getTime() - 2 * 3600e3);
    const changed = (await wooPages(c.url, `after=${encodeURIComponent(since)}&date_column=modified_gmt&_fields=${WOO_FIELDS}`, gap, onPage, opts.cancelled, H)).items.map(fromWoo);
    const map = new Map(prev.products.map((p) => [p.id, p]));
    for (const p of changed) map.set(p.id, p);
    const head = await http.getJson(`${c.url}/wp-json/wc/store/v1/products?per_page=1&_fields=id`, { gap, timeout: 30000, headers: H });
    const total = parseInt(head.headers.get('x-wp-total') || '0', 10);
    if (total && total !== map.size) {
      // something was deleted or hidden: read the list of ids (small pages) and fill the gaps
      const ids = new Set((await wooPages(c.url, '_fields=id', gap, null, opts.cancelled, H)).items.map((x) => x.id));
      for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
      const missing = [...ids].filter((id) => !map.has(id));
      for (let i = 0; i < missing.length; i += 100) {
        const r = await http.getJson(`${c.url}/wp-json/wc/store/v1/products?per_page=100&include=${missing.slice(i, i + 100).join(',')}&_fields=${WOO_FIELDS}`, { gap, timeout: 60000, headers: H });
        for (const p of r.json || []) map.set(p.id, fromWoo(p));
      }
    }
    items = [...map.values()];
  }
  return { items, mode, full, started };
}

async function syncShopify(c, prev, opts) {
  const started = Date.now();
  const items = [];
  let total = 0;
  for (let page = 1; page <= 200; page++) {
    if (opts.cancelled && opts.cancelled()) break;
    const r = await http.getJson(`${c.url}/products.json?limit=250&page=${page}`, { gap: opts.gap, timeout: 60000, retries: 2, headers: opts.headers });
    const list = (r.json && r.json.products) || [];
    if (!list.length) break;
    total += list.length;
    opts.prog.addTotal(list.length);
    opts.prog.add(list.length);
    for (const p of list) items.push(fromShopify(p, c.url));
    if (list.length < 250) break;
  }
  void total;
  return { items, mode: 'full', full: true, started };
}

/** Download (or update) one competitor's catalog. */
async function syncOne(c, opts) {
  const prev = load(c.id);
  const t0 = Date.now();
  const gap = Math.max(300, Number(settings.all().competitorGap) || 900);
  const o = Object.assign({ gap }, opts);
  const r = c.kind === 'shopify' ? await syncShopify(c, prev, o) : await syncWoo(c, prev, o);
  if (o.cancelled && o.cancelled()) return null;
  // keep only products with a price, in euro
  const items = r.items.filter((p) => p.n && p.p > 0 && (!p.c || p.c === 'EUR'));
  const out = {
    kind: c.kind, url: c.url, at: U.nowIso(), syncStartedAt: new Date(r.started).toISOString(),
    lastFullAt: r.full ? new Date(r.started).toISOString() : prev.lastFullAt, mode: r.mode,
    seconds: Math.round((Date.now() - t0) / 1000), count: items.length, products: items,
  };
  store.write(file(c.id), out);
  return { id: c.id, name: c.name, count: items.length, mode: r.mode, seconds: out.seconds };
}

/** Update every readable competitor, several at the same time (each one politely, one after the other page). */
async function syncAll(comps, job, progress) {
  const out = [];
  const errors = [];
  await http.pool(comps, 5, async (c) => {
    if (job && job.cancelled()) return;
    const prog = progress.site('c-' + c.id, c.name);
    try {
      const r = await syncOne(c, { prog, cancelled: () => !!(job && job.cancelled()), full: false });
      if (r) { out.push(r); job && job.log(`${c.name}: ${r.count.toLocaleString('el-GR')} προϊόντα (${r.mode === 'full' ? 'πλήρης' : 'αλλαγές'}, ${r.seconds} δευτ.)`); }
      prog.note('έτοιμο');
    } catch (e) {
      errors.push({ id: c.id, name: c.name, error: e.message });
      job && job.log(`${c.name}: ${e.message}`);
      prog.note('σφάλμα');
    }
  });
  return { done: out, errors };
}

function info(id) {
  const c = load(id);
  return { at: c.at, count: c.count || (c.products || []).length, mode: c.mode, seconds: c.seconds, lastFullAt: c.lastFullAt };
}

module.exports = { load, remove, syncOne, syncAll, info, fromWoo, fromShopify };
