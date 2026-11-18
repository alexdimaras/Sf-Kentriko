'use strict';
// Product catalog of the two shops: pull from the public WooCommerce Store API or import an admin CSV export.
const store = require('./store');
const settings = require('./settings');
const http = require('./http');
const U = require('./util');
const GREEK_WORDS = require('./greekwords');

const SITES = ['sf', 'st'];
// global_unique_id: WooCommerce's own «GTIN, UPC, EAN or ISBN» field (9.2+), when the shop's API gives it
const FIELDS = 'id,name,slug,parent,type,variation,permalink,sku,short_description,description,on_sale,prices,images,categories,tags,brands,attributes,variations,is_in_stock,is_purchasable,stock_availability,global_unique_id';
const BRAND_ATTR = /κατασκευαστ|brand|μάρκ|μαρκ|manufacturer|εταιρ/i;

function siteUrl(site) {
  const s = settings.all().sites[site];
  return U.normUrl(s && s.url);
}

function emptyCatalog() { return { syncedAt: null, source: null, products: [], categories: [], info: {} }; }
// What was worked out from a catalog remembers the catalog's VERSION, never the catalog itself: a kept reference
// would keep 30 MB of old products in memory after a new reading (two or three catalogs at once is more than a small
// cloud machine has).
const cver = (site) => store.ver('catalog-' + site);
const bothVer = () => cver('sf') + '|' + cver('st');
// With the engine on (lib/engine.js), the links between the two sites and the list of what is not allowed on the ads
// site are answered from the last result while new ones are built in the background (never inside a request).
let lazy = false, onDirty = null;
function setLazy(on, fn) { lazy = !!on; onDirty = fn || null; }
/** A site's catalog was replaced: what pointed into the old one is let go at once. */
function release(site) { byIdMemo.delete(site); viewMemo.delete(site); idxCache.delete(site); brandsMemo = null; }
function load(site) {
  const c = store.read('catalog-' + site, emptyCatalog);
  if (!c[PACKED]) {
    for (const p of c.products) {
      if (p.type !== 'variation') packProduct(p);
      if (p.sku && p.sku.indexOf('&') >= 0) p.sku = cleanSku(p.sku); // read by an older version: codes were kept encoded
    }
    Object.defineProperty(c, PACKED, { value: true });
  }
  return c;
}

/**
 * Both catalogs into memory in slices (the program keeps answering while 60 MB are read). After it, load() is
 * instant. Also prepares what the screens ask for all the time (products by id, the list order, the links).
 */
async function preload() {
  for (const site of SITES) { await store.readAsync('catalog-' + site, emptyCatalog, bg.breathe); load(site); await bg.breathe(); }
  await bg.drain(warmGen());
  writeMeta();
}
function* warmGen() {
  for (const site of SITES) { byId(site); yield; }
  yield* linksGen();
}
/** What only some screens need (the order and search text of the product list, what is not allowed on the ads site): after the start. */
function* warmLateGen() {
  for (const site of SITES) yield* viewIndexGen(site);
}
/** The saved list of what is not allowed on the ads site (it takes seconds to work out on a small cloud machine). */
function warmBanned() { return bg.drain(bannedGen()); }
/**
 * What the program learns from the catalog at every reading (product types, accents). If the files are missing
 * (data saved by an older version left them out) they are learned again now, in slices. Returns true if anything was made.
 */
async function warmLearned() {
  let made = false;
  if (!SITES.some((s) => load(s).products.length)) return made;
  if (!store.exists('types')) { await bg.drain(learnTypesGen()); made = true; }
  if (!store.exists('accents')) { await bg.drain(accentsGen()); made = true; }
  return made;
}
function setBanned(ids) { bannedMemo = { v: bannedVer(), set: new Set(ids) }; }
function warmLinks() { return bg.drain(linksGen()); }
/** The few numbers every screen shows (how many products, when they were read), without opening the catalogs. */
function writeMeta() {
  const meta = {};
  for (const site of SITES) {
    const c = load(site);
    let main = 0;
    for (const p of c.products) if (p.type !== 'variation') main++;
    meta[site] = { syncedAt: c.syncedAt, source: c.source, products: main, variations: c.products.length - main, categories: c.categories.length, info: c.info || {} };
  }
  if (JSON.stringify(store.read('catalog-meta', null)) !== JSON.stringify(meta)) store.write('catalog-meta', meta);
  return meta;
}

// ---------- descriptions kept compressed ----------
// A shop of ~10.000 products has ~100 MB of description HTML; Greek text takes 2 bytes a letter in memory, more
// than a small cloud machine has. Each product keeps its description and short description compressed
// (descZ / shortZ, about 1/4 of the size) and p.desc / p.short open them only when they are read.
const zlib = require('zlib');
const bg = require('./bg');
const PACKED = Symbol('packed');
const TEXTS = ['desc', 'short'];
function packText(s) { s = String(s == null ? '' : s); return s ? zlib.deflateRawSync(Buffer.from(s, 'utf8'), { level: 6 }).toString('base64') : ''; }
function unpackText(z) { return z ? zlib.inflateRawSync(Buffer.from(z, 'base64')).toString('utf8') : ''; }
// p.desc / p.short live once, on a prototype shared by every product (a pair of functions on each product gave each
// of the 17.000 products its own hidden shape: 30 MB of memory for nothing).
const Packed = Object.create(Object.prototype, Object.fromEntries(TEXTS.map((k) => [k, {
  configurable: true, enumerable: false,
  get() { return unpackText(this[k + 'Z']); },
  set(v) { this[k + 'Z'] = packText(v); textFacts(this, k, v); },
}])));
function packProduct(p) {
  if (Object.getPrototypeOf(p) === Packed) return p;
  for (const k of TEXTS) {
    const d = Object.getOwnPropertyDescriptor(p, k);
    if (!d) continue;
    delete p[k]; // the text itself (or a getter of an older run) leaves the product; the compressed copy stays
    if ('value' in d) { p[k + 'Z'] = packText(d.value); textFacts(p, k, d.value); }
  }
  Object.setPrototypeOf(p, Packed);
  return p;
}
/** Length, Greek share and the start of the plain text: what the checks need, without opening the text again. */
function textFacts(p, k, html) {
  const t = U.stripTags(String(html || ''));
  if (k === 'desc') { p.descLen = t.length; p.descGr = Math.round(U.greekShare(t) * 100) / 100; p.descHead = t.slice(0, 200); }
  else p.shortLen = t.length;
}
/** A product for the screen: the texts opened, the compressed copies left out. */
function withTexts(p) { const o = Object.assign({}, p, { desc: p.desc, short: p.short }); delete o.descZ; delete o.shortZ; return o; }

// ---------- Normalization ----------
function money(prices, key) {
  if (!prices || prices[key] == null || prices[key] === '') return 0;
  const unit = Number(prices.currency_minor_unit == null ? 2 : prices.currency_minor_unit);
  return U.r2(Number(prices[key]) / Math.pow(10, unit));
}

const EAN_ATTR = /^(ean|gtin|upc|barcode|ean-?13|κωδικός ean|κωδικοσ ean|γραμμωτός κώδικας)$/i;
function eanOf(p, attrs) {
  const g = require('./extract').validGtin;
  const direct = g(p.global_unique_id || p.gtin || p.ean || '');
  if (direct) return direct;
  const a = (attrs || []).find((x) => EAN_ATTR.test(x.name) && x.terms.length === 1);
  return a ? g(a.terms[0]) : '';
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
    sku: cleanSku(p.sku),
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
    // the EAN the shop itself keeps (its GTIN field, or an «EAN» attribute) — only a real one (check digit), never made up
    ...(eanOf(p, attrs) ? { ean: eanOf(p, attrs) } : {}),
    status: 'publish',
  };
}
/**
 * fromStoreApi with the texts compressed at once (a whole shop never sits in memory as plain text).
 * The copy through JSON matters: a short piece of the site's answer (a link, a code) would otherwise keep the WHOLE
 * answer of 100 products alive in memory (that is how JavaScript keeps parts of long texts).
 */
function fromStoreApiPacked(p) { return packProduct(fresh(packProduct(fromStoreApi(p)))); }
function fresh(o) { return JSON.parse(JSON.stringify(o)); }
/** A product code as it is written in the shop: «SE &#8211; 40403» is «SE – 40403» (the public API sends codes encoded). */
function cleanSku(s) { s = String(s == null ? '' : s); return U.collapse(s.indexOf('&') < 0 ? s : U.untexturize(U.decodeEntities(s)).replace(/[–—]/g, '-')); }
function safeDecode(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

function catFromStoreApi(c) {
  return { id: c.id, name: U.untexturize(U.decodeEntities(c.name)), slug: safeDecode(c.slug), parent: c.parent || 0, count: c.count || 0, url: c.permalink || '' };
}

// ---------- Store API sync ----------
// First time: everything. Afterwards: only what changed since the last read (WooCommerce "modified" date),
// plus a cheap count check to catch deleted / hidden products. A full read runs again every 7 days.
const VAR_FIELDS = 'id,parent,type,variation,sku,prices,on_sale,is_in_stock,images,global_unique_id';
const ENGINE = 2;
const CONCURRENCY = 4;

function apiUrl(base, path, query, page) {
  return `${base}/wp-json/wc/store/v1/${path}?per_page=100&page=${page}${query ? '&' + query : ''}`;
}

/** Fetch every page of a Store API list. onTotal(total) once, onItems(n) per page. */
async function fetchAll(base, path, query, hooks) {
  hooks = hooks || {};
  const first = await http.getJson(apiUrl(base, path, query, 1), { gap: 120, timeout: 60000, signal: hooks.signal });
  if (!Array.isArray(first.json)) throw new Error('Μη αναμενόμενη απάντηση από ' + base);
  const pages = parseInt(first.headers.get('x-wp-totalpages') || '1', 10) || 1;
  const total = parseInt(first.headers.get('x-wp-total') || '0', 10) || first.json.length;
  hooks.onTotal && hooks.onTotal(total);
  // each page is converted as it arrives (hooks.map): the raw answers of the whole shop are never kept together
  if (hooks.check) hooks.check(first.json);
  // (in slices: converting 100 products packs 100 descriptions, too long for one go on a small machine)
  const pace = bg.pacer();
  const conv = async (list) => {
    if (!hooks.map) return list;
    const res = [];
    for (const x of list) { res.push(hooks.map(x)); if (pace.due()) await pace.rest(); }
    return res;
  };
  const out = await conv(first.json);
  hooks.onItems && hooks.onItems(first.json.length);
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);
  await http.pool(rest, CONCURRENCY, async (pg) => {
    const r = await http.getJson(apiUrl(base, path, query, pg), { gap: 120, timeout: 60000, signal: hooks.signal });
    if (!Array.isArray(r.json)) throw new Error(`Το ${U.hostOf(base)} έστειλε λάθος απάντηση στη σελίδα ${pg} από ${pages}: η ανάγνωση σταμάτησε για να μη φυλαχτεί μισός κατάλογος.`);
    const n = r.json.length; for (const x of await conv(r.json)) out.push(x); hooks.onItems && hooks.onItems(n);
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

// ---------- how the last reading of each site went ----------
// Kept apart from the catalogs (a failed reading leaves the catalog of the last good one in place): the screens show,
// for each site by itself, when it was read, how many products, and whether the reading finished or failed.
const READS = 'sync-status';
function readStatus() { const r = store.read(READS, null) || {}; const out = {}; for (const s of SITES) out[s] = r[s] || null; return out; }
function setReadStatus(site, patch) {
  store.update(READS, {}, (all) => { all[site] = Object.assign({}, all[site] || {}, patch); return all; });
}
/** A reading starts: remembered at once (if the program is stopped in the middle, the next start says so). */
function readStarted(site, full) { setReadStatus(site, { state: 'running', startedAt: U.nowIso(), endedAt: null, full: !!full, error: '', done: 0, total: 0 }); }
function readEnded(site, res, err, cancelled) {
  const now = U.nowIso();
  if (res && !err) setReadStatus(site, { state: 'ok', endedAt: now, mode: res.mode, products: res.count, variations: res.variations, expected: res.expected || 0, skipped: res.skipped || 0, seconds: res.seconds, error: '', lastOkAt: now, lastOkProducts: res.count, lastOkVariations: res.variations });
  else setReadStatus(site, { state: cancelled ? 'cancelled' : 'failed', endedAt: now, error: cancelled ? 'Σταμάτησε πριν τελειώσει.' : String((err && err.message) || err || 'Άγνωστο σφάλμα') });
}
/** At start: a reading that was running when the program stopped did not finish. */
function closeOpenReads() {
  const r = store.read(READS, null);
  if (!r) return;
  for (const s of SITES) if (r[s] && r[s].state === 'running') setReadStatus(s, { state: 'failed', endedAt: U.nowIso(), error: 'Διακόπηκε: το πρόγραμμα έκλεισε ή ξεκίνησε ξανά πριν τελειώσει η ανάγνωση.' });
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
  return fresh(Object.assign({ id: n.id, type: 'variation', parent: n.parent, varLabel: n.varLabel, sku: n.sku, price: n.price, regular: n.regular, sale: n.sale, inStock: n.inStock, image: n.images[0] || '', thumb: n.thumb || '' }, n.ean ? { ean: n.ean } : {}));
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

  const hooks = { onTotal: (n) => prog.addTotal(n), onItems: (n) => prog.add(n), cancelled, signal: job && job.signal };
  let products, mode, expected = 0, skipped = 0;
  if (full) {
    mode = 'full';
    let prods;
    const ph = Object.assign({}, hooks, { map: fromStoreApiPacked, check: (raw) => { if (raw.length && !raw[0].prices) throw new Error('fields'); } });
    try {
      prods = await fetchAll(base, 'products', '_fields=' + FIELDS, ph);
    } catch (e) {
      if (e.message !== 'fields' && e.status !== 400) throw e;
      prods = await fetchAll(base, 'products', '', Object.assign({}, ph, { check: null }));
    }
    if (cancelled()) return null;
    products = prods.items;
    expected = prods.total;
    // every product the site says it has must be here: a reading that came short is not kept as a whole one
    if (expected && products.length < expected - Math.max(5, Math.ceil(expected * 0.005))) throw new Error(`Διαβάστηκαν ${products.length} από ${expected} προϊόντα: η ανάγνωση δεν ολοκληρώθηκε και δεν φυλάχτηκε.`);
    job && job.log(`${name}: ${products.length} προϊόντα (${Math.round((Date.now() - t0) / 1000)} δευτ.).`);
    let vars = [];
    if (s.syncVariations && products.some((p) => p.type === 'variable')) {
      try {
        const t1 = Date.now();
        vars = (await fetchAll(base, 'products', 'type=variation&_fields=' + VAR_FIELDS, Object.assign({}, hooks, { map: slimVariation }))).items;
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
    skipped = orphans;
    if (orphans) job && job.log(`${name}: ${orphans} παραλλαγές αγνοήθηκαν (ανήκουν σε πρόχειρα ή διαγραμμένα προϊόντα).`);
  } else {
    mode = 'changes';
    const since = isoUtc(new Date(prev.syncStartedAt).getTime() - 2 * 3600e3);
    const q = `after=${encodeURIComponent(since)}&date_column=modified_gmt`;
    const changed = (await fetchAll(base, 'products', q + '&_fields=' + FIELDS, Object.assign({}, hooks, { map: fromStoreApiPacked }))).items;
    if (cancelled()) return null;
    let changedVars = [];
    if (s.syncVariations) changedVars = (await fetchAll(base, 'products', 'type=variation&' + q + '&_fields=' + VAR_FIELDS, Object.assign({}, hooks, { map: slimVariation }))).items;
    if (cancelled()) return null;
    const main = new Map(prev.products.filter((p) => p.type !== 'variation').map((p) => [p.id, p]));
    for (const p of changed) main.set(p.id, p);
    // Deleted or hidden products: the shop's total no longer matches.
    prog.note('έλεγχος για διαγραμμένα…');
    const total = await countOf(base, '');
    expected = total;
    if (total !== main.size) {
      job && job.log(`${name}: ${total} στο site, ${main.size} εδώ — έλεγχος λίστας προϊόντων…`);
      const ids = new Set((await fetchAll(base, 'products', '_fields=id', { cancelled })).items.map((x) => x.id));
      for (const id of [...main.keys()]) if (!ids.has(id)) main.delete(id);
      const missing = [...ids].filter((id) => !main.has(id));
      for (let i = 0; i < missing.length; i += 100) {
        const r = await http.getJson(`${base}/wp-json/wc/store/v1/products?per_page=100&include=${missing.slice(i, i + 100).join(',')}&_fields=${FIELDS}`, { gap: 120, timeout: 60000 });
        for (const p of r.json || []) main.set(p.id, fromStoreApiPacked(p));
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
  const res = await saveCatalogAsync(site, { source: 'api', products, categories, info, meta: { syncStartedAt: new Date(startedAt).toISOString(), lastFullAt: full ? new Date(startedAt).toISOString() : prev.lastFullAt, engine: ENGINE, mode, withVariations: !!s.syncVariations, seconds: Math.round((Date.now() - t0) / 1000) } });
  res.expected = expected; res.skipped = skipped;
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

function* prepareSave(site, data) {
  const prev = load(site);
  const cat = Object.assign({ syncedAt: U.nowIso(), source: data.source, products: data.products, categories: data.categories, info: Object.assign({}, prev.info || {}, data.info || {}) }, data.meta || {});
  const byIdMap = new Map(cat.products.map((p) => [p.id, p]));
  yield;
  for (const p of cat.products) {
    yield;
    if (p.type !== 'variation') { packProduct(p); continue; }
    const par = byIdMap.get(p.parent);
    // WooCommerce shows the parent's code on variations without their own: that is not a real code.
    if (par && p.sku && p.sku === par.sku) { p.sku = ''; p.skuInherited = true; }
    if (!p.thumb && p.image) p.thumb = p.image;
  }
  Object.defineProperty(cat, PACKED, { value: true });
  yield* inferBrandsGen(cat);
  const diff = diffCatalogs(prev, cat);
  yield;
  return { prev, cat, diff };
}
function afterSave(site, data, prev, cat, diff) {
  if (prev.syncedAt) {
    store.update('history', [], (h) => { h.unshift(Object.assign({ site, at: cat.syncedAt, source: data.source, mode: cat.mode || '' }, diff)); return h.slice(0, 40); });
  }
}
function savedResult(site, cat, diff) {
  return { site, mode: cat.mode || 'full', seconds: cat.seconds || 0, count: cat.products.filter((p) => p.type !== 'variation').length, variations: cat.products.filter((p) => p.type === 'variation').length, categories: cat.categories.length, diff };
}
function saveCatalog(site, data) {
  const { prev, cat, diff } = bg.drainSync(prepareSave(site, data));
  store.write('catalog-' + site, cat);
  release(site);
  afterSave(site, data, prev, cat, diff);
  bg.drainSync(accentsGen());
  bg.drainSync(learnTypesGen());
  writeMeta();
  return savedResult(site, cat, diff);
}
/** The same in slices: the program keeps answering while a 30 MB catalog is prepared and written. */
async function saveCatalogAsync(site, data) {
  const { prev, cat, diff } = await bg.drain(prepareSave(site, data));
  await store.writeAsync('catalog-' + site, cat, bg.breathe);
  release(site);
  afterSave(site, data, prev, cat, diff);
  await bg.drain(accentsGen());
  await bg.drain(learnTypesGen());
  await bg.drain(warmGen());
  writeMeta();
  return savedResult(site, cat, diff);
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
function learnTypes() { return bg.drainSync(learnTypesGen()); }
function* learnTypesGen() {
  const votes = new Map();
  const first = new Map();
  const anyPos = new Map();
  for (const site of SITES) {
    for (const p of load(site).products) {
      if (p.type === 'variation') continue;
      yield;
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
function inferBrands(cat) { return bg.drainSync(inferBrandsGen(cat)); }
function* inferBrandsGen(cat) {
  const brands = knownBrands();
  yield;
  for (const p of cat.products) if (p.brand) brands.set(U.foldKey(p.brand), p.brand);
  const list = [...brands.entries()].filter(([k]) => k.length >= 2).sort((a, b) => b[0].length - a[0].length);
  for (const p of cat.products) {
    if (p.brand) continue;
    yield;
    // (a title whose «&» was lost — «Hamp;N» — is read as it was meant: the brand H&N is still found)
    const t = ' ' + U.foldKey(U.repairEntities(p.name) || p.name).replace(/[^\p{L}\p{N}.\-&]+/gu, ' ') + ' ';
    for (const [k, disp] of list) {
      if (t.includes(' ' + k + ' ')) { p.brand = disp; p.brandSource = 'title'; break; }
    }
  }
}

// ---------- Accents for Title Case ----------
let accentCache = null;
function rebuildAccents() { return bg.drainSync(accentsGen()); }
function* accentsGen() {
  const counts = new Map();
  for (const site of SITES) {
    const c = load(site);
    for (const cat of c.categories) U.learnAccents(cat.name, counts);
    let n = 0;
    for (const p of c.products) {
      if (p.type === 'variation') continue;
      if (n++ > 6000) break;
      yield;
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
  if (hit && hit.v === cver(site)) return hit.idx;
  const idx = categoryIndex(site);
  idxCache.set(site, { v: cver(site), idx });
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
/** Every product of a site by its id (built once per catalog). */
const byIdMemo = new Map();
function byId(site) {
  const c = load(site);
  const hit = byIdMemo.get(site);
  if (hit && hit.v === cver(site)) return hit.map;
  const map = new Map(c.products.map((p) => [p.id, p]));
  byIdMemo.set(site, { v: cver(site), map });
  return map;
}
/**
 * Ids of the ads-site products that are not allowed there (weapons, magazines, ammunition…). The program never
 * asks for work on them (texts, photos, prices): the only thing it proposes is to take them off the site.
 */
let bannedMemo = null;
const bannedVer = () => bothVer() + '|' + store.ver('settings') + '|' + store.ver('links');
function bannedOnAds() {
  if (bannedMemo && bannedMemo.v === bannedVer()) return bannedMemo.set;
  if (bannedMemo && lazy) { if (onDirty) onDirty('links'); return bannedMemo.set; }
  return bg.drainSync(bannedGen());
}
function* bannedGen() {
  const cst = load('st');
  const v = bannedVer();
  if (bannedMemo && bannedMemo.v === v) return bannedMemo.set;
  const L = yield* linksGen();
  const sfBy = byId('sf');
  const set = new Set();
  for (const p of cst.products) {
    if (p.type === 'variation') continue;
    yield;
    const oid = L.stToSf.get(p.id);
    if (adStatus('st', p, oid != null ? sfBy.get(oid) : null, 'sf').level === 'banned') set.add(p.id);
  }
  bannedMemo = { v, set };
  return set;
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
  const v = bothVer(), mv = store.ver('links');
  if (linksCache && linksCache.v === v && linksCache.mv === mv) return linksCache.res;
  // a catalog was read again: the last links are used until the new ones are built in the background
  // (a link set by hand is worked out at once: the person is waiting to see it)
  if (linksCache && lazy && linksCache.mv === mv) { if (onDirty) onDirty('links'); return linksCache.res; }
  return bg.drainSync(linksGen());
}
function* linksGen() {
  const csf = load('sf'), cst = load('st');
  const manual = store.read('links', {}); // sfId -> stId | 0 (0 = "not the same")
  const v = bothVer(), mv = store.ver('links');
  if (linksCache && linksCache.v === v && linksCache.mv === mv) return linksCache.res;
  const res = yield* computeLinksGen(csf, cst, manual);
  linksCache = { v, mv, res };
  return res;
}
function* computeLinksGen(csf, cst, manual) {
  const sf = csf.products.filter((p) => p.type !== 'variation');
  const st = cst.products.filter((p) => p.type !== 'variation');
  yield;
  const bySku = new Map(), byName = new Map(), bySlug = new Map();
  for (const p of st) {
    yield;
    if (p.sku) bySku.set(U.normSku(p.sku), p);
    byName.set(U.foldKey(p.name), p);
    if (p.slug) bySlug.set(p.slug, p);
  }
  const sfToSt = new Map(), stToSf = new Map(), how = new Map();
  const stById = new Map(st.map((p) => [p.id, p]));
  for (const p of sf) {
    yield;
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
  const loaded = SITES.every((site) => store.loaded('catalog-' + site));
  const meta = loaded ? writeMeta() : store.read('catalog-meta', null) || writeMeta();
  const reads = readStatus();
  for (const site of SITES) out[site] = Object.assign({ name: s.sites[site].name, url: s.sites[site].url }, meta[site], { read: reads[site] });
  return out;
}

/** The main products of a site in title order, with their search text: prepared once per catalog. */
const viewMemo = new Map();
function viewIndex(site) {
  const hit = viewMemo.get(site);
  if (hit && hit.v === cver(site)) return hit.rows;
  return bg.drainSync(viewIndexGen(site));
}
function* viewIndexGen(site) {
  const c = load(site);
  const hit = viewMemo.get(site);
  if (hit && hit.v === cver(site)) return hit.rows;
  const v = cver(site);
  const rows = [];
  for (const p of c.products) {
    if (p.type === 'variation') continue;
    rows.push({ p, name: U.foldKey(p.name), brand: U.foldKey(p.brand || ''), text: U.foldKey(p.name + ' ' + p.sku + ' ' + p.brand) });
    yield;
  }
  rows.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  viewMemo.set(site, { v, rows });
  return rows;
}

function productsView(q) {
  q = q || {};
  const site = q.site === 'st' ? 'st' : 'sf';
  const other = site === 'sf' ? 'st' : 'sf';
  const c = load(site);
  const L = links();
  const map = site === 'sf' ? L.sfToSt : L.stToSf;
  const oById = byId(other);
  const supp = require('./suppliers');
  const adOf = (p) => { const oid = map.get(p.id); return adStatus(site, p, oid ? oById.get(oid) : null, other); };
  let rows0 = viewIndex(site); // already in title order
  const term = U.foldKey(q.search || '');
  if (term) {
    const parts = term.split(' ');
    rows0 = rows0.filter((r) => parts.every((t) => r.text.includes(t)));
  }
  if (q.brand) { const b = U.foldKey(q.brand); rows0 = rows0.filter((r) => r.brand === b); }
  let list = rows0.map((r) => r.p);
  if (q.cat) {
    const id = Number(q.cat);
    const idx = categoryIndex(site);
    list = list.filter((p) => p.cats.some((cid) => cid === id || idx.ancestors(cid).some((x) => x.id === id)));
  }
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
  if (sort === 'price') list.sort((x, y) => (x.price - y.price) * dir);
  else if (sort === 'id') list.sort((x, y) => (x.id - y.id) * dir);
  else if (sort === 'brand') { const k = (p) => U.foldKey(p.brand || ''); const keyed = list.map((p) => [k(p), p]); keyed.sort((x, y) => (x[0] < y[0] ? -dir : x[0] > y[0] ? dir : 0)); list = keyed.map((x) => x[1]); }
  else if (dir < 0) list.reverse();
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
    site, product: withTexts(p), variations: vars,
    adminUrl: base ? `${base}/wp-admin/post.php?post=${p.id}&action=edit` : '',
    other: o ? { site: other, id: o.id, name: o.name, price: o.price, regular: o.regular, sale: o.sale, url: o.url, adminUrl: `${siteUrl(other)}/wp-admin/post.php?post=${o.id}&action=edit`, how: L.how.get(site === 'sf' ? p.id : oid) || '' } : null,
    supplier: supp.view(supp.forProduct(p)),
    market: market.resultFor(site, p.id),
    titleCase: U.titleCase(p.name, accents()),
    cost: store.read('costs', {})[site + ':' + p.id] || null,
    ads: adStatus(site, p, o, other),
  };
}

let brandsMemo = null;
function brandsList() {
  if (brandsMemo && brandsMemo.v === bothVer()) return brandsMemo.list;
  const m = new Map();
  for (const site of SITES) for (const p of load(site).products) {
    if (p.type === 'variation' || !p.brand) continue;
    const k = U.foldKey(p.brand);
    const e = m.get(k) || { name: p.brand, sf: 0, st: 0 };
    e[site]++;
    m.set(k, e);
  }
  brandsMemo = { v: bothVer(), list: [...m.values()].sort((a, b) => (b.sf + b.st) - (a.sf + a.st)) };
  return brandsMemo.list;
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
  warmLateGen, setBanned, warmBanned, warmLearned, warmLinks, setLazy, bothVer,
  readStatus, readStarted, readEnded, closeOpenReads,
  SITES, load, siteUrl, probe, syncSite, makeProgress, fetchAll, csvDetect, csvImport, summary, productsView, productDetail, links, setManualLink,
  categoryIndex, adStatus, bannedOnAds, byId, preload, writeMeta, saveCatalogAsync, viewIndex, categoryAdLevels, chainsFor, accents, rebuildAccents, brandsList, knownBrands, attributeNames, detectAttribute, fromStoreApi, learnTypes, learnedTypes,
};
