'use strict';
// Product catalog of the two shops: pull from the public WooCommerce Store API or import an admin CSV export.
const store = require('./store');
const settings = require('./settings');
const http = require('./http');
const U = require('./util');
const GREEK_WORDS = require('./greekwords');

const SITES = ['sf', 'st'];
const FIELDS = 'id,name,slug,parent,type,variation,permalink,sku,short_description,description,on_sale,prices,images,categories,tags,brands,attributes,variations,is_in_stock,is_purchasable,stock_availability';
const BRAND_ATTR = /κατασκευαστ|brand|μάρκ|μαρκ|manufacturer|εταιρ/i;

function siteUrl(site) {
  const s = settings.all().sites[site];
  return U.normUrl(s && s.url);
}

function emptyCatalog() { return { syncedAt: null, source: null, products: [], categories: [], info: {} }; }
function load(site) { return store.read('catalog-' + site, emptyCatalog); }

// ---------- Normalization ----------
function money(prices, key) {
  if (!prices || prices[key] == null || prices[key] === '') return 0;
  const unit = Number(prices.currency_minor_unit == null ? 2 : prices.currency_minor_unit);
  return U.r2(Number(prices[key]) / Math.pow(10, unit));
}

function fromStoreApi(p) {
  const prices = p.prices || {};
  const price = money(prices, 'price');
  const regular = money(prices, 'regular_price') || price;
  const onSale = !!p.on_sale && regular > price;
  const range = prices.price_range;
  const attrs = (p.attributes || []).map((a) => ({
    name: U.untexturize(U.decodeEntities(a.name)), taxonomy: a.taxonomy || '', variation: !!a.has_variations,
    terms: (a.terms || []).map((t) => U.untexturize(U.decodeEntities(t.name))),
  }));
  let brand = '';
  if (Array.isArray(p.brands) && p.brands.length) brand = U.untexturize(U.decodeEntities(p.brands[0].name));
  let brandSource = brand ? 'brands' : '';
  if (!brand) {
    const ba = attrs.find((a) => BRAND_ATTR.test(a.name) || /kataskeuast|brand|marka/i.test(a.taxonomy));
    if (ba && ba.terms.length) { brand = ba.terms[0]; brandSource = 'attr:' + ba.name; }
  }
  const desc = p.description || '';
  const short = p.short_description || '';
  return {
    id: p.id,
    type: p.type || 'simple',
    parent: p.parent || 0,
    name: U.collapse(U.untexturize(U.decodeEntities(String(p.name || '').replace(/<[^>]+>/g, '')))),
    varLabel: p.variation ? U.untexturize(U.decodeEntities(p.variation)) : '',
    slug: safeDecode(p.slug || ''),
    sku: String(p.sku || '').trim(),
    url: p.permalink || '',
    price, regular,
    sale: onSale ? price : 0,
    priceMax: range && range.max_amount ? money({ x: range.max_amount, currency_minor_unit: prices.currency_minor_unit }, 'x') : 0,
    inStock: p.is_in_stock !== false,
    purchasable: p.is_purchasable !== false,
    cats: (p.categories || []).map((c) => c.id),
    catNames: (p.categories || []).map((c) => U.untexturize(U.decodeEntities(c.name))),
    tags: (p.tags || []).map((t) => U.untexturize(U.decodeEntities(t.name))),
    brand, brandSource,
    attrs,
    images: (p.images || []).map((i) => i.src).filter(Boolean),
    thumb: (p.images && p.images[0] && (p.images[0].thumbnail || p.images[0].src)) || '',
    imageAlts: (p.images || []).map((i) => i.alt || ''),
    desc, short,
    descLen: U.stripTags(desc).length,
    shortLen: U.stripTags(short).length,
    variations: (p.variations || []).map((v) => v.id),
    status: 'publish',
  };
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

function catFromStoreApi(c) {
  return { id: c.id, name: U.untexturize(U.decodeEntities(c.name)), slug: safeDecode(c.slug), parent: c.parent || 0, count: c.count || 0, url: c.permalink || '' };
}

// ---------- Store API sync ----------
// First time: everything. Afterwards: only what changed since the last read (WooCommerce "modified" date),
// plus a cheap count check to catch deleted / hidden products. A full read runs again every 7 days.
const VAR_FIELDS = 'id,parent,type,variation,sku,prices,on_sale,is_in_stock,images';
const ENGINE = 2;
const CONCURRENCY = 4;

function apiUrl(base, path, query, page) {
  return `${base}/wp-json/wc/store/v1/${path}?per_page=100&page=${page}${query ? '&' + query : ''}`;
}

/** Fetch every page of a Store API list. onTotal(total) once, onItems(n) per page. */
async function fetchAll(base, path, query, hooks) {
  hooks = hooks || {};
  const first = await http.getJson(apiUrl(base, path, query, 1), { gap: 120, timeout: 60000 });
  if (!Array.isArray(first.json)) throw new Error('Μη αναμενόμενη απάντηση από ' + base);
  const pages = parseInt(first.headers.get('x-wp-totalpages') || '1', 10) || 1;
  const total = parseInt(first.headers.get('x-wp-total') || '0', 10) || first.json.length;
  hooks.onTotal && hooks.onTotal(total);
  const out = first.json.slice();
  hooks.onItems && hooks.onItems(first.json.length);
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);
  await http.pool(rest, CONCURRENCY, async (pg) => {
    const r = await http.getJson(apiUrl(base, path, query, pg), { gap: 120, timeout: 60000 });
    if (Array.isArray(r.json)) { out.push(...r.json); hooks.onItems && hooks.onItems(r.json.length); }
  }, hooks.cancelled);
  return { items: out, total };
}

async function countOf(base, query) {
  const r = await http.getJson(apiUrl(base, 'products', (query ? query + '&' : '') + '_fields=id', 1).replace('per_page=100', 'per_page=1'), { gap: 120, timeout: 30000 });
  return parseInt(r.headers.get('x-wp-total') || '0', 10);
}

async function probe(site) {
  const base = siteUrl(site);
  if (!base) throw new Error('Δεν έχει οριστεί διεύθυνση για το site.');
  const r = await http.getJson(`${base}/wp-json/wc/store/v1/products?per_page=1`, { retries: 1, timeout: 20000 });
  return { ok: true, total: parseInt(r.headers.get('x-wp-total') || '0', 10) };
}

/** Shared progress for one sync job (both sites at once), with time left. */
function makeProgress(job) {
  const parts = {};
  const t0 = Date.now();
  const fmt = (n) => Number(n).toLocaleString('el-GR');
  function render() {
    let done = 0, total = 0;
    const msgs = [];
    const list = Object.values(parts);
    for (const p of list) { done += p.done; total += Math.max(p.total, p.done); }
    // with many parts (competitors) show the ones still running, the rest as a count
    const open = list.filter((p) => !/^(έτοιμο|σφάλμα)$/.test(p.note) && !(p.total && p.done >= p.total && !p.note));
    const show = list.length > 3 ? open.slice(0, 3) : list;
    for (const p of show) msgs.push(p.note ? `${p.name}: ${p.note}` : `${p.name}: ${fmt(p.done)}/${fmt(Math.max(p.total, p.done))}`);
    if (list.length > 3) msgs.push(`${list.length - open.length}/${list.length} έτοιμα`);
    let eta = '';
    const el = (Date.now() - t0) / 1000;
    if (done > 50 && total > done && el > 5) {
      const left = Math.round(((total - done) * el) / done);
      eta = left < 60 ? ' · λιγότερο από 1 λεπτό ακόμα' : ` · ~${Math.round(left / 60)} λεπτά ακόμα`;
    }
    job && job.progress(done, total || null, msgs.join(' · ') + eta);
  }
  return {
    site(key, name) {
      parts[key] = parts[key] || { name, done: 0, total: 0, note: '' };
      const p = parts[key];
      return {
        addTotal(n) { p.total += n; render(); },
        add(n) { p.done += n; render(); },
        note(t) { p.note = t; render(); },
      };
    },
  };
}

function slimVariation(v) {
  const n = fromStoreApi(v);
  return { id: n.id, type: 'variation', parent: n.parent, varLabel: n.varLabel, sku: n.sku, price: n.price, regular: n.regular, sale: n.sale, inStock: n.inStock, image: n.images[0] || '', thumb: n.thumb || '' };
}

function isoUtc(ms) { return new Date(ms).toISOString().slice(0, 19); }

async function syncSite(site, job, opts) {
  opts = opts || {};
  const base = siteUrl(site);
  if (!base) throw new Error('Δεν έχει οριστεί διεύθυνση για το site.');
  const s = settings.all();
  const name = s.sites[site].name;
  const prog = (opts.progress || makeProgress(job)).site(site, name);
  const cancelled = () => !!(job && job.cancelled());
  const prev = load(site);
  const startedAt = Date.now();
  const daysSinceFull = prev.lastFullAt ? (startedAt - new Date(prev.lastFullAt).getTime()) / 864e5 : Infinity;
  const full = !!opts.full || !prev.syncedAt || prev.source !== 'api' || prev.engine !== ENGINE || !prev.syncStartedAt || daysSinceFull >= 7
    || (!!s.syncVariations !== !!prev.withVariations);
  const t0 = Date.now();
  job && job.log(`${name}: ${full ? 'πλήρης ανάγνωση' : 'ανάγνωση αλλαγών'}…`);

  prog.note('κατηγορίες…');
  const cats = await fetchAll(base, 'products/categories', '', { cancelled });
  if (cancelled()) return null;
  const categories = cats.items.map(catFromStoreApi);
  prog.note('');

  const hooks = { onTotal: (n) => prog.addTotal(n), onItems: (n) => prog.add(n), cancelled };
  let products, mode;
  if (full) {
    mode = 'full';
    let prods;
    try {
      prods = await fetchAll(base, 'products', '_fields=' + FIELDS, hooks);
      if (prods.items.length && !prods.items[0].prices) throw new Error('fields');
    } catch (e) {
      if (e.message !== 'fields' && e.status !== 400) throw e;
      prods = await fetchAll(base, 'products', '', hooks);
    }
    if (cancelled()) return null;
    products = prods.items.map(fromStoreApi);
    job && job.log(`${name}: ${products.length} προϊόντα (${Math.round((Date.now() - t0) / 1000)} δευτ.).`);
    let vars = [];
    if (s.syncVariations && products.some((p) => p.type === 'variable')) {
      try {
        const t1 = Date.now();
        vars = (await fetchAll(base, 'products', 'type=variation&_fields=' + VAR_FIELDS, hooks)).items.map(slimVariation);
        job && job.log(`${name}: ${vars.length} παραλλαγές (${Math.round((Date.now() - t1) / 1000)} δευτ.).`);
      } catch (e) {
        job && job.log(`${name}: οι παραλλαγές δεν διαβάστηκαν (${e.message}). Συνεχίζω χωρίς αυτές.`);
      }
    }
    if (cancelled()) return null;
    const seen = new Set(products.map((p) => p.id));
    // only variations their (published) product still lists; the rest belong to drafts or deleted products
    const listed = new Set();
    for (const p of products) if (p.type === 'variable') for (const id of p.variations || []) listed.add(id);
    let orphans = 0;
    for (const v of vars) { if (seen.has(v.id)) continue; if (!listed.has(v.id)) { orphans++; continue; } products.push(v); }
    if (orphans) job && job.log(`${name}: ${orphans} παραλλαγές αγνοήθηκαν (ανήκουν σε πρόχειρα ή διαγραμμένα προϊόντα).`);
  } else {
    mode = 'changes';
    const since = isoUtc(new Date(prev.syncStartedAt).getTime() - 2 * 3600e3);
    const q = `after=${encodeURIComponent(since)}&date_column=modified_gmt`;
    const changed = (await fetchAll(base, 'products', q + '&_fields=' + FIELDS, hooks)).items.map(fromStoreApi);
    if (cancelled()) return null;
    let changedVars = [];
    if (s.syncVariations) changedVars = (await fetchAll(base, 'products', 'type=variation&' + q + '&_fields=' + VAR_FIELDS, hooks)).items.map(slimVariation);
    if (cancelled()) return null;
    const main = new Map(prev.products.filter((p) => p.type !== 'variation').map((p) => [p.id, p]));
    for (const p of changed) main.set(p.id, p);
    // Deleted or hidden products: the shop's total no longer matches.
    prog.note('έλεγχος για διαγραμμένα…');
    const total = await countOf(base, '');
    if (total !== main.size) {
      job && job.log(`${name}: ${total} στο site, ${main.size} εδώ — έλεγχος λίστας προϊόντων…`);
      const ids = new Set((await fetchAll(base, 'products', '_fields=id', { cancelled })).items.map((x) => x.id));
      for (const id of [...main.keys()]) if (!ids.has(id)) main.delete(id);
      const missing = [...ids].filter((id) => !main.has(id));
      for (let i = 0; i < missing.length; i += 100) {
        const r = await http.getJson(`${base}/wp-json/wc/store/v1/products?per_page=100&include=${missing.slice(i, i + 100).join(',')}&_fields=${FIELDS}`, { gap: 120, timeout: 60000 });
        for (const p of r.json || []) main.set(p.id, fromStoreApi(p));
      }
    }
    if (cancelled()) return null;
    // Variations: keep only those their product still lists; fetch any listed but unknown.
    const vars = new Map(prev.products.filter((p) => p.type === 'variation').map((p) => [p.id, p]));
    for (const v of changedVars) vars.set(v.id, v);
    const wanted = new Set();
    for (const p of main.values()) if (p.type === 'variable') for (const id of p.variations) wanted.add(id);
    for (const id of [...vars.keys()]) if (!wanted.has(id)) vars.delete(id);
    if (s.syncVariations) {
      const unknown = [...wanted].filter((id) => !vars.has(id));
      for (let i = 0; i < unknown.length; i += 100) {
        if (cancelled()) return null;
        const r = await http.getJson(`${base}/wp-json/wc/store/v1/products?per_page=100&type=variation&include=${unknown.slice(i, i + 100).join(',')}&_fields=${VAR_FIELDS}`, { gap: 120, timeout: 60000 });
        for (const v of r.json || []) vars.set(v.id, slimVariation(v));
      }
    }
    products = [...main.values(), ...vars.values()];
    prog.note('');
    job && job.log(`${name}: ${changed.length} προϊόντα και ${changedVars.length} παραλλαγές άλλαξαν (${Math.round((Date.now() - t0) / 1000)} δευτ.).`);
  }
  let info = prev.info || {};
  if (full || !info.seo) { try { info = await siteInfo(base); } catch (_) { /* optional */ } }
  const res = saveCatalog(site, { source: 'api', products, categories, info, meta: { syncStartedAt: new Date(startedAt).toISOString(), lastFullAt: full ? new Date(startedAt).toISOString() : prev.lastFullAt, engine: ENGINE, mode, withVariations: !!s.syncVariations, seconds: Math.round((Date.now() - t0) / 1000) } });
  console.log(`sync ${site} ${mode}: ${res.count} products, ${res.variations} variations in ${res.seconds}s`);
  return res;
}

/** Detect SEO plugin from the home page. */
async function siteInfo(base) {
  const r = await http.get(base + '/', { retries: 0, timeout: 15000 });
  const t = r.text.slice(0, 400000);
  let seo = 'none';
  if (/yoast/i.test(t)) seo = 'yoast';
  else if (/rank[\s-]?math/i.test(t)) seo = 'rankmath';
  else if (/all in one seo|aioseo/i.test(t)) seo = 'aioseo';
  const theme = (t.match(/wp-content\/themes\/([a-z0-9_-]+)/i) || [])[1] || '';
  return { seo, theme };
}

function saveCatalog(site, data) {
  const prev = load(site);
  const cat = Object.assign({ syncedAt: U.nowIso(), source: data.source, products: data.products, categories: data.categories, info: Object.assign({}, prev.info || {}, data.info || {}) }, data.meta || {});
  const byId = new Map(cat.products.map((p) => [p.id, p]));
  for (const p of cat.products) {
    if (p.type !== 'variation') continue;
    const par = byId.get(p.parent);
    // WooCommerce shows the parent's code on variations without their own: that is not a real code.
    if (par && p.sku && p.sku === par.sku) { p.sku = ''; p.skuInherited = true; }
    if (!p.thumb && p.image) p.thumb = p.image;
  }
  inferBrands(cat);
  const diff = diffCatalogs(prev, cat);
  store.write('catalog-' + site, cat);
  if (prev.syncedAt) {
    store.update('history', [], (h) => { h.unshift(Object.assign({ site, at: cat.syncedAt, source: data.source, mode: cat.mode || '' }, diff)); return h.slice(0, 40); });
  }
  rebuildAccents();
  learnTypes();
  return { site, mode: cat.mode || 'full', seconds: cat.seconds || 0, count: cat.products.filter((p) => p.type !== 'variation').length, variations: cat.products.filter((p) => p.type === 'variation').length, categories: cat.categories.length, diff };
}

function diffCatalogs(prev, cur) {
  const pm = new Map((prev.products || []).filter((p) => p.type !== 'variation').map((p) => [p.id, p]));
  const cm = new Map(cur.products.filter((p) => p.type !== 'variation').map((p) => [p.id, p]));
  const added = [], removed = [], priceChanged = [], renamed = [];
  for (const [id, p] of cm) {
    const o = pm.get(id);
    if (!o) { added.push({ id, name: p.name }); continue; }
    if (Math.abs((o.price || 0) - (p.price || 0)) > 0.009) priceChanged.push({ id, name: p.name, from: o.price, to: p.price });
    if (o.name !== p.name) renamed.push({ id, from: o.name, to: p.name });
  }
  for (const [id, o] of pm) if (!cm.has(id)) removed.push({ id, name: o.name });
  const cap = (a) => a.slice(0, 300);
  return { added: cap(added), removed: cap(removed), priceChanged: cap(priceChanged), renamed: cap(renamed), counts: { added: added.length, removed: removed.length, priceChanged: priceChanged.length, renamed: renamed.length } };
}

// ---------- Product types learned from the shop's own titles ----------
// Titles follow ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ…, and many also carry English words (ΖΩΝΗ PENTAGON MONTE BELT).
// Counting which Greek type goes with which English word teaches us how to name supplier products.
const TYPE_STOP = new Set(['THE', 'AND', 'FOR', 'WITH', 'PRO', 'NEW', 'MINI', 'MAX', 'PLUS', 'LITE', 'GEN', 'EDITION', 'SET', 'KIT', 'BLACK', 'WHITE', 'GREEN', 'OLIVE', 'COYOTE', 'BROWN', 'GREY', 'GRAY', 'TAN', 'KHAKI', 'NAVY', 'BLUE', 'RED', 'SAND', 'MULTICAM', 'WOODLAND', 'CAMO', 'LED', 'USB']);
function learnTypes() {
  const votes = new Map();
  const first = new Map();
  const anyPos = new Map();
  for (const site of SITES) {
    for (const p of load(site).products) {
      if (p.type === 'variation') continue;
      const w = U.greekUpper(p.name).split(' ');
      if (!w[0] || !/[\u0370-\u03ff]/.test(w[0]) || w[0].length < 3) continue;
      const type = w[0];
      first.set(type, (first.get(type) || 0) + 1);
      for (const x of new Set(w)) if (/^[\u0391-\u03a9]{3,}$/.test(x)) anyPos.set(x, (anyPos.get(x) || 0) + 1);
      const brandToks = new Set(U.greekUpper(p.brand || '').split(/[\s\-.]+/));
      const seen = new Set();
      for (const t of w.slice(1)) {
        const k = t.replace(/[^A-Z]/g, '');
        if (k.length < 3 || k !== t.replace(/[-.,()\/"']/g, '') || TYPE_STOP.has(k) || brandToks.has(k) || seen.has(k)) continue;
        seen.add(k);
        let m = votes.get(k);
        if (!m) { m = new Map(); votes.set(k, m); }
        m.set(type, (m.get(type) || 0) + 1);
      }
    }
  }
  const map = {};
  for (const [k, m] of votes) {
    let tot = 0, best = '', bn = 0;
    for (const [t, n] of m) { tot += n; if (n > bn) { bn = n; best = t; } }
    if (tot >= 3 && bn / tot >= 0.6) map[k] = { type: best, share: Math.round((bn / tot) * 100) / 100, n: tot };
  }
  const list = [...first.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  // "real" product types: words that are almost always the first word when they appear
  const nouns = [...first.entries()].filter(([t, n]) => n >= 8 && n / (anyPos.get(t) || n) >= 0.6).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  store.write('types', { map, list, nouns, at: U.nowIso() });
  return { words: Object.keys(map).length, types: list.length };
}
function learnedTypes() { return store.read('types', { map: {}, list: [] }); }

// ---------- Brands ----------
function knownBrands() {
  const set = new Map(); // KEY -> display
  for (const site of SITES) {
    for (const p of load(site).products) if (p.brand && p.type !== 'variation') set.set(U.foldKey(p.brand), p.brand);
  }
  for (const s of store.read('suppliers', [])) for (const b of s.brands || []) if (b) set.set(U.foldKey(b), b);
  return set;
}
/** Products without an explicit brand: find a known brand inside the title. */
function inferBrands(cat) {
  const brands = knownBrands();
  for (const p of cat.products) if (p.brand) brands.set(U.foldKey(p.brand), p.brand);
  const list = [...brands.entries()].filter(([k]) => k.length >= 2).sort((a, b) => b[0].length - a[0].length);
  for (const p of cat.products) {
    if (p.brand) continue;
    const t = ' ' + U.foldKey(p.name).replace(/[^\p{L}\p{N}.\-&]+/gu, ' ') + ' ';
    for (const [k, disp] of list) {
      if (t.includes(' ' + k + ' ')) { p.brand = disp; p.brandSource = 'title'; break; }
    }
  }
}

// ---------- Accents for Title Case ----------
let accentCache = null;
function rebuildAccents() {
  const counts = new Map();
  for (const site of SITES) {
    const c = load(site);
    for (const cat of c.categories) U.learnAccents(cat.name, counts);
    let n = 0;
    for (const p of c.products) {
      if (p.type === 'variation') continue;
      if (n++ > 6000) break;
      U.learnAccents(U.stripTags(p.desc).slice(0, 3000) + ' ' + U.stripTags(p.short), counts);
    }
  }
  const map = U.accentMapFrom(counts, GREEK_WORDS);
  accentCache = map;
  store.write('accents', Object.fromEntries(map));
  return map;
}
function accents() {
  if (accentCache) return accentCache;
  const o = store.read('accents', null);
  accentCache = o ? new Map(Object.entries(o)) : U.accentMapFrom(new Map(), GREEK_WORDS);
  return accentCache;
}

// ---------- Categories ----------
function categoryIndex(site) {
  const cats = load(site).categories;
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (id) => {
    const parts = []; let c = byId.get(id); let guard = 0;
    while (c && guard++ < 12) { parts.unshift(c.name); c = byId.get(c.parent); }
    return parts;
  };
  const ancestors = (id) => {
    const a = []; let c = byId.get(id); let guard = 0;
    while (c && guard++ < 12) { a.push(c); c = byId.get(c.parent); }
    return a;
  };
  return { cats, byId, pathOf, ancestors };
}

// ---------- Ads rules (what may be advertised; see adrules.js) ----------
/** Category chains of a product, without categories that are just parents of its other categories. */
function chainsFor(idx, catIds) {
  const ids = (catIds || []).filter((id) => idx.byId.has(id));
  const anc = new Set();
  for (const id of ids) for (const a of idx.ancestors(id).slice(1)) anc.add(a.id);
  return ids.filter((id) => !anc.has(id)).map((id) => idx.ancestors(id).reverse().map((c) => ({ name: c.name, slug: c.slug })));
}
const idxCache = new Map();
function idxFor(site) {
  const c = load(site);
  const hit = idxCache.get(site);
  if (hit && hit.cat === c) return hit.idx;
  const idx = categoryIndex(site);
  idxCache.set(site, { cat: c, idx });
  return idx;
}
/** Ad status of a product. linked: the same product on the other site (its categories count too). */
function adStatus(site, p, linked, linkedSite) {
  const adrules = require('./adrules');
  let chains = chainsFor(idxFor(site), p.cats);
  if (linked && linkedSite) chains = chains.concat(chainsFor(idxFor(linkedSite), linked.cats));
  const r = adrules.evaluate({ name: p.name, brand: p.brand }, chains);
  return r;
}
/** Ad level of every category of a site (for the category lists). */
function categoryAdLevels(site) {
  const adrules = require('./adrules');
  const idx = idxFor(site);
  const out = new Map();
  for (const c of idx.cats) out.set(c.id, adrules.evaluate({ name: '' }, [idx.ancestors(c.id).reverse().map((x) => ({ name: x.name, slug: x.slug }))]).level);
  return out;
}

// ---------- Cross-site links ----------
let linksCache = null;
function links() {
  const csf = load('sf'), cst = load('st');
  const manual = store.read('links', {}); // sfId -> stId | 0 (0 = "not the same")
  const mk = JSON.stringify(manual);
  if (linksCache && linksCache.sf === csf && linksCache.st === cst && linksCache.mk === mk) return linksCache.res;
  const res = computeLinks(csf, cst, manual);
  linksCache = { sf: csf, st: cst, mk, res };
  return res;
}
function computeLinks(csf, cst, manual) {
  const sf = csf.products.filter((p) => p.type !== 'variation');
  const st = cst.products.filter((p) => p.type !== 'variation');
  const bySku = new Map(), byName = new Map(), bySlug = new Map();
  for (const p of st) {
    if (p.sku) bySku.set(U.normSku(p.sku), p);
    byName.set(U.foldKey(p.name), p);
    if (p.slug) bySlug.set(p.slug, p);
  }
  const sfToSt = new Map(), stToSf = new Map(), how = new Map();
  const stById = new Map(st.map((p) => [p.id, p]));
  for (const p of sf) {
    let m = null, h = '';
    if (Object.prototype.hasOwnProperty.call(manual, p.id)) {
      m = manual[p.id] ? stById.get(Number(manual[p.id])) : null; h = 'manual';
      if (!m) continue;
    }
    if (!m && p.sku && bySku.has(U.normSku(p.sku))) { m = bySku.get(U.normSku(p.sku)); h = 'sku'; }
    if (!m && byName.has(U.foldKey(p.name))) { m = byName.get(U.foldKey(p.name)); h = 'name'; }
    if (!m && p.slug && bySlug.has(p.slug)) { m = bySlug.get(p.slug); h = 'slug'; }
    if (m && !stToSf.has(m.id)) { sfToSt.set(p.id, m.id); stToSf.set(m.id, p.id); how.set(p.id, h); }
  }
  return { sfToSt, stToSf, how };
}

function setManualLink(sfId, stId) {
  store.update('links', {}, (l) => { if (stId === null) delete l[sfId]; else l[sfId] = Number(stId) || 0; return l; });
}

// ---------- WooCommerce admin CSV import ----------
const COLS = {
  id: [/^id$/],
  type: [/^type$/, /^τυπος$/],
  sku: [/^sku$/, /κωδικ/],
  name: [/^name$/, /^ονομα/, /^τιτλος/],
  published: [/^published$/, /δημοσιευ/],
  visibility: [/visibility/, /ορατοτητα/],
  short: [/short description/, /συντομη περιγραφη/],
  desc: [/^description$/, /^περιγραφη$/],
  inStock: [/in stock\?/, /σε αποθεμα/, /^αποθεμα\?/],
  sale: [/^sale price$/, /τιμη προσφορας/, /προσφορα/],
  regular: [/^regular price$/, /κανονικη τιμη/, /^τιμη$/],
  categories: [/^categories$/, /κατηγοριες/],
  tags: [/^tags$/, /ετικετες/],
  images: [/^images$/, /εικονες/],
  parent: [/^parent$/, /γονικ/],
  brands: [/^brands?$/, /μαρκες/, /^brand$/],
  ean: [/gtin|ean|upc|isbn/],
};
function keyOf(h) { return U.stripTonos(String(h || '')).toLowerCase().replace(/\s+/g, ' ').trim(); }

function csvDetect(text) {
  const { rows, sep } = U.parseCSV(text);
  if (rows.length < 2) throw new Error('Το αρχείο δεν έχει γραμμές προϊόντων.');
  const headers = rows[0].map((h) => h.trim());
  const mapping = {};
  headers.forEach((h, i) => {
    const k = keyOf(h);
    for (const [field, res] of Object.entries(COLS)) {
      if (mapping[field] != null) continue;
      if (res.some((re) => re.test(k))) { mapping[field] = i; break; }
    }
  });
  const attrs = [];
  headers.forEach((h, i) => {
    const k = keyOf(h);
    const m = k.match(/(\d+)/);
    if (!m || !/attribute|ιδιοτητ|χαρακτηριστ|γνωρισμ/.test(k)) return;
    const n = m[1];
    let a = attrs.find((x) => x.n === n);
    if (!a) { a = { n }; attrs.push(a); }
    if (/name|ονομα/.test(k)) a.name = i;
    else if (/value|τιμ/.test(k)) a.value = i;
    else if (/visible|ορατ/.test(k)) a.visible = i;
    else if (/global|καθολικ/.test(k)) a.global = i;
  });
  mapping.attrs = attrs.filter((a) => a.name != null && a.value != null);
  const missing = ['id', 'name'].filter((f) => mapping[f] == null);
  return { sep, headers, mapping, missing, rows: rows.length - 1, sample: rows.slice(1, 4) };
}

function csvImport(site, text, mappingOverride) {
  const det = csvDetect(text);
  const map = Object.assign({}, det.mapping, mappingOverride || {});
  if (map.id == null || map.name == null) throw new Error('Το αρχείο πρέπει να έχει στήλες ID και Όνομα (εξαγωγή από Προϊόντα → Εξαγωγή του WooCommerce).');
  const { rows } = U.parseCSV(text, det.sep);
  const body = rows.slice(1);
  const val = (r, f) => (map[f] != null ? String(r[map[f]] == null ? '' : r[map[f]]).trim() : '');
  // categories from paths
  const catByPath = new Map();
  let nextCat = 1;
  const catFor = (path) => {
    const parts = path.split('>').map((x) => x.trim()).filter(Boolean);
    let parent = 0, key = '';
    let id = 0;
    for (const part of parts) {
      key += '>' + part;
      if (!catByPath.has(key)) catByPath.set(key, { id: nextCat++, name: part, slug: U.slugify(part), parent, count: 0, url: '' });
      id = catByPath.get(key).id; parent = id;
    }
    return id;
  };
  const splitList = (s) => {
    const out = []; let cur = ''; let esc = false;
    for (const ch of s) { if (esc) { cur += ch; esc = false; } else if (ch === '\\') esc = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  const products = [];
  const skuToId = new Map();
  for (const r of body) {
    const id = parseInt(val(r, 'id'), 10);
    if (!id) continue;
    const type = (val(r, 'type') || 'simple').toLowerCase().split(',')[0].trim();
    const typeN = /variation|παραλλαγ/.test(type) ? 'variation' : /variable|μεταβλητ/.test(type) ? 'variable' : /grouped|ομαδ/.test(type) ? 'grouped' : /external|εξωτερ/.test(type) ? 'external' : 'simple';
    const regular = U.parseNumber(val(r, 'regular'));
    const sale = U.parseNumber(val(r, 'sale'));
    const catPaths = splitList(val(r, 'categories'));
    const cats = catPaths.map(catFor);
    const attrs = (map.attrs || []).map((a) => ({
      name: String(r[a.name] || '').trim(), taxonomy: a.global != null && String(r[a.global]).trim() === '1' ? 'pa_' : '',
      variation: false, terms: splitList(String(r[a.value] || '')),
    })).filter((a) => a.name && a.terms.length);
    let brand = '';
    if (map.brands != null) brand = splitList(val(r, 'brands'))[0] || '';
    if (!brand) { const ba = attrs.find((a) => BRAND_ATTR.test(a.name)); if (ba) brand = ba.terms[0]; }
    const pub = val(r, 'published');
    const desc = val(r, 'desc').replace(/\\n/g, '\n');
    const short = val(r, 'short').replace(/\\n/g, '\n');
    const p = {
      id, type: typeN, parent: 0, parentRef: val(r, 'parent'),
      name: U.collapse(val(r, 'name')), varLabel: '', slug: '', sku: val(r, 'sku'), url: '',
      price: sale > 0 && sale < regular ? sale : regular, regular, sale: sale > 0 && sale < regular ? sale : 0, priceMax: 0,
      inStock: !/^(0|no|όχι|οχι|outofstock)$/i.test(val(r, 'inStock')),
      purchasable: true,
      cats, catNames: catPaths.map((x) => x.split('>').pop().trim()),
      tags: splitList(val(r, 'tags')), brand, brandSource: brand ? 'csv' : '',
      attrs, images: splitList(val(r, 'images')), imageAlts: [],
      desc, short, descLen: U.stripTags(desc).length, shortLen: U.stripTags(short).length,
      variations: [],
      status: pub === '1' ? 'publish' : pub === '-1' ? 'draft' : pub === '0' ? 'private' : 'publish',
      ean: val(r, 'ean').replace(/\D/g, ''),
    };
    if (p.sku) skuToId.set(p.sku, id);
    products.push(p);
  }
  // parents: "id:123" or a SKU
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const p of products) {
    if (p.type !== 'variation' || !p.parentRef) continue;
    const m = p.parentRef.match(/^id:(\d+)$/i);
    const pid = m ? Number(m[1]) : skuToId.get(p.parentRef) || 0;
    p.parent = pid;
    const par = byId.get(pid);
    if (par) {
      par.variations.push(p.id);
      const vals = p.attrs.map((a) => a.name + ': ' + a.terms.join(' ')).join(', ');
      p.varLabel = vals;
      for (const a of par.attrs) if (p.attrs.some((x) => x.name === a.name)) a.variation = true;
      if (!p.name) p.name = par.name;
    }
  }
  for (const p of products) delete p.parentRef;
  // variable products: price range from their sizes/colours
  for (const p of products) {
    if (p.type !== 'variable' || !p.variations.length) continue;
    const vs = p.variations.map((id) => byId.get(id)).filter((v) => v && v.price > 0);
    if (!vs.length) continue;
    const min = vs.reduce((a, v) => (v.price < a.price ? v : a));
    p.price = min.price; p.regular = min.regular; p.sale = min.sale;
    p.priceMax = Math.max(...vs.map((v) => v.price));
    if (!p.inStock && vs.some((v) => v.inStock)) p.inStock = true;
  }
  const categories = [...catByPath.values()];
  for (const p of products) for (const c of p.cats) { const cc = categories.find((x) => x.id === c); if (cc) cc.count++; }
  if (!products.length) throw new Error('Δεν βρέθηκαν προϊόντα στο αρχείο.');
  return saveCatalog(site, { source: 'csv', products, categories, info: {} });
}

// ---------- Queries for the UI ----------
function summary() {
  const s = settings.all();
  const out = {};
  for (const site of SITES) {
    const c = load(site);
    const main = c.products.filter((p) => p.type !== 'variation');
    out[site] = { name: s.sites[site].name, url: s.sites[site].url, syncedAt: c.syncedAt, source: c.source, products: main.length, variations: c.products.length - main.length, categories: c.categories.length, info: c.info || {} };
  }
  return out;
}

function productsView(q) {
  q = q || {};
  const site = q.site === 'st' ? 'st' : 'sf';
  const other = site === 'sf' ? 'st' : 'sf';
  const c = load(site);
  const oc = load(other);
  const L = links();
  const map = site === 'sf' ? L.sfToSt : L.stToSf;
  const oById = new Map(oc.products.map((p) => [p.id, p]));
  const supp = require('./suppliers');
  const adOf = (p) => { const oid = map.get(p.id); return adStatus(site, p, oid ? oById.get(oid) : null, other); };
  let list = c.products.filter((p) => p.type !== 'variation');
  const term = U.foldKey(q.search || '');
  if (term) {
    const parts = term.split(' ');
    list = list.filter((p) => { const h = U.foldKey(p.name + ' ' + p.sku + ' ' + p.brand); return parts.every((t) => h.includes(t)); });
  }
  if (q.cat) {
    const id = Number(q.cat);
    const idx = categoryIndex(site);
    list = list.filter((p) => p.cats.some((cid) => cid === id || idx.ancestors(cid).some((a) => a.id === id)));
  }
  if (q.brand) { const b = U.foldKey(q.brand); list = list.filter((p) => U.foldKey(p.brand) === b); }
  if (q.only === 'missing') list = list.filter((p) => !map.has(p.id));
  if (q.only === 'both') list = list.filter((p) => map.has(p.id));
  if (q.only === 'sale') list = list.filter((p) => p.sale > 0);
  if (q.only === 'noimg') list = list.filter((p) => !p.images.length);
  if (q.only === 'out') list = list.filter((p) => !p.inStock);
  if (q.only === 'noads') list = list.filter((p) => adOf(p).level === 'banned');
  if (q.only === 'nogoogle') list = list.filter((p) => ['banned', 'google'].includes(adOf(p).level));
  if (q.only === 'nosku') list = list.filter((p) => !p.sku);
  if (q.supplier) { const sup = supp.get(q.supplier); list = sup ? list.filter((p) => supp.matches(sup, p)) : []; }
  const sort = q.sort || 'name';
  const dir = q.dir === 'desc' ? -1 : 1;
  list.sort((a, b) => {
    if (sort === 'price') return (a.price - b.price) * dir;
    if (sort === 'id') return (a.id - b.id) * dir;
    if (sort === 'brand') return a.brand.localeCompare(b.brand, 'el') * dir || a.name.localeCompare(b.name, 'el');
    return a.name.localeCompare(b.name, 'el') * dir;
  });
  const total = list.length;
  const per = Math.min(500, Math.max(10, Number(q.per) || 50));
  const page = Math.max(1, Number(q.page) || 1);
  const rows = list.slice((page - 1) * per, page * per).map((p) => {
    const oid = map.get(p.id);
    const o = oid ? oById.get(oid) : null;
    const ad = adOf(p);
    return {
      id: p.id, name: p.name, sku: p.sku, brand: p.brand, price: p.price, regular: p.regular, sale: p.sale, priceMax: p.priceMax,
      type: p.type, img: p.thumb || p.images[0] || '', imgCount: p.images.length, inStock: p.inStock, url: p.url, cats: p.catNames, status: p.status,
      variations: p.variations.length,
      other: o ? { id: o.id, price: o.price, url: o.url, name: o.name } : null,
      ads: ad.level, adsWhy: ad.why,
      supplier: (supp.forProduct(p) || {}).name || '',
    };
  });
  return { site, total, page, per, rows, syncedAt: c.syncedAt };
}

function productDetail(site, id) {
  const c = load(site);
  const p = c.products.find((x) => x.id === Number(id));
  if (!p) return null;
  const vars = c.products.filter((x) => x.type === 'variation' && x.parent === p.id);
  const L = links();
  const oid = (site === 'sf' ? L.sfToSt : L.stToSf).get(p.id);
  const other = site === 'sf' ? 'st' : 'sf';
  const o = oid ? load(other).products.find((x) => x.id === oid) : null;
  const base = siteUrl(site);
  const supp = require('./suppliers');
  const market = require('./market');
  return {
    site, product: p, variations: vars,
    adminUrl: base ? `${base}/wp-admin/post.php?post=${p.id}&action=edit` : '',
    other: o ? { site: other, id: o.id, name: o.name, price: o.price, regular: o.regular, sale: o.sale, url: o.url, adminUrl: `${siteUrl(other)}/wp-admin/post.php?post=${o.id}&action=edit`, how: L.how.get(site === 'sf' ? p.id : oid) || '' } : null,
    supplier: supp.view(supp.forProduct(p)),
    market: market.resultFor(site, p.id),
    titleCase: U.titleCase(p.name, accents()),
    cost: store.read('costs', {})[site + ':' + p.id] || null,
    ads: adStatus(site, p, o, other),
  };
}

function brandsList() {
  const m = new Map();
  for (const site of SITES) for (const p of load(site).products) {
    if (p.type === 'variation' || !p.brand) continue;
    const k = U.foldKey(p.brand);
    const e = m.get(k) || { name: p.brand, sf: 0, st: 0 };
    e[site]++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => (b.sf + b.st) - (a.sf + a.st));
}

/** Attribute names used on a site, most common first (for size/colour/brand detection). */
function attributeNames(site) {
  const m = new Map();
  for (const p of load(site).products) for (const a of p.attrs || []) {
    const e = m.get(a.name) || { name: a.name, global: !!a.taxonomy, count: 0, variation: 0, sample: new Set() };
    e.count++; if (a.variation) e.variation++;
    for (const t of a.terms.slice(0, 4)) if (e.sample.size < 6) e.sample.add(t);
    m.set(a.name, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).map((e) => Object.assign(e, { sample: [...e.sample] }));
}

function detectAttribute(site, kind) {
  const set = settings.all().attributes[site] || {};
  if (set[kind]) return set[kind];
  const names = attributeNames(site);
  const re = kind === 'brand' ? BRAND_ATTR : kind === 'size' ? /μέγεθ|μεγεθ|νούμερ|νουμερ|size/i : /χρώμ|χρωμ|colou?r/i;
  const hit = names.find((a) => re.test(a.name));
  return hit ? hit.name : (kind === 'brand' ? 'Κατασκευαστής' : kind === 'size' ? 'Μέγεθος' : 'Χρώμα');
}

module.exports = {
  SITES, load, siteUrl, probe, syncSite, makeProgress, fetchAll, csvDetect, csvImport, summary, productsView, productDetail, links, setManualLink,
  categoryIndex, adStatus, categoryAdLevels, chainsFor, accents, rebuildAccents, brandsList, knownBrands, attributeNames, detectAttribute, fromStoreApi, learnTypes, learnedTypes,
};
