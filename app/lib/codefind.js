'use strict';
// SF Κέντρο — what our products miss (maker's code / SKU, EAN, photos, brand, a market price), found on the internet.
// For each product that misses something:
//   1. many searches, built from what we know: brand + code, the EAN, the whole title, brand + model words, the code
//      alone (and written without dashes), the maker's code, the English name of the kind of product, the model words
//      without a brand (a product without a brand is searched too) — on every search engine that answers;
//   2. the shop pages of the results read side by side (several pages of the same shop when the first one was not the
//      product or did not open; never the same address twice), with the product data each page carries for Google;
//   3. only a page that shows the SAME product counts (the same EAN, the same code, or the matching of the price
//      research says «exact»); the price, the EAN and the code are those of OUR colour when the page has variants;
//   4. the research stops for a product only when what it misses has been found by two shops (or enough shops),
//      and comes back by itself for what is still missing, sooner after a failure than after «not found anywhere».
// What happened is written down per product (searches, engines, pages, why each page was left out, errors): a failed
// or cut research is never taken for a finished one. Proposals: Διορθώσεις → Κωδικοί (sure with ≥2 shops), for a yes.
const store = require('./store');
const U = require('./util');

const KEY = 'web-codes';          // { products: { 'site:id': { at, okAt, status, hits, sum, … } }, shops: { host: {...} } }
const TRACE_KEY = 'web-trace';    // the last researches in detail: { items: { 'site:id': trace }, order: [keys] }
const TRACE_KEEP = 1500;
const AGAIN_DAYS = 21;            // (old entries without a status: as before)
const PAGES_PER_QUERY = 8;        // new pages opened per search
const PER_HOST = 3;               // at most this many pages of one shop for one product (a wrong first page is not the end)
const MAX_QUERIES = 8;
const HIT_DAYS = 120;             // a shop page that showed the product counts for four months, unless read again and changed
const PRICE_DAYS = 14;            // a price from the internet is looked up again after two weeks
const FAILED = new Set(['blocked', 'search_failed', 'pages_failed', 'cancelled', 'error']);
const SUCCESS = new Set(['complete', 'partial', 'not_found', 'no_results']);
const WEIGHT = { sku: 5, price: 4, ean: 3, images: 2, brand: 1 };

function data() { const d = store.read(KEY, null) || {}; d.products = d.products || {}; d.shops = d.shops || {}; return d; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }
const gtin = (v) => require('./market').gtinOf(v);
const days = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);

/** What a product misses that the internet can give. */
function needsOf(p, mk) {
  const n = [];
  if (!String(p.sku || '').trim()) n.push('sku');
  // no price from any shop yet (the competitors' catalogs did not have it): the internet may
  if (mk && !(mk.stats && mk.stats.count)) n.push('price');
  if ((p.images || []).length < 2) n.push('images');
  if (!p.brand) n.push('brand');
  if (p.type === 'simple' && !p.ean) n.push('ean');
  return n;
}
const ORDER = { sku: 0, price: 1, images: 2, brand: 3, ean: 4 };

/**
 * Of what a product misses, what the research has NOT covered yet (field by field): a code given by one shop only is
 * looked for again (a second shop makes it sure); one photo → more; a product found without a price → its price; a
 * price gets old after two weeks.
 */
function openNeeds(needs, hits) {
  const hs = (hits || []).filter((h) => h && h.host);
  const agree = (vals) => { const c = new Map(); for (const v of vals) if (v) c.set(v, (c.get(v) || 0) + 1); return Math.max(0, ...c.values()); };
  const left = [];
  for (const n of needs) {
    if (n === 'sku' && agree(hs.map((h) => U.normSku(h.code || h.sku || ''))) >= 2) continue;
    if (n === 'ean' && agree(hs.map((h) => gtin(h.ean))) >= 2) continue;
    if (n === 'brand' && (agree(hs.map((h) => U.foldKey(h.brand || ''))) >= 2 || hs.some((h) => h.brand && h.how === 'code'))) continue;
    if (n === 'images') { const withImg = hs.filter((h) => (h.images || []).length || h.img); const all = new Set(withImg.flatMap((h) => (h.images || []).concat(h.img || [])).map((u) => String(u).split('?')[0].split('/').pop())); if (withImg.length >= 2 && all.size >= 2) continue; }
    if (n === 'price' && hs.filter((h) => h.price > 0 && (h.avail === 'in' || (h.avail == null && h.inStock === true)) && days(h.at) <= PRICE_DAYS).length >= 2) continue;
    left.push(n);
  }
  return left;
}

/** When a product is due again: soon after a failure, later after «nothing anywhere», in between for what is missing. */
function dueAt(prev) {
  if (!prev) return 0;
  const at = new Date(prev.at || 0).getTime();
  if (!prev.status) {
    const again = (prev.hits || []).some((h) => h.price > 0) ? 14 : (prev.hits || []).length ? 60 : AGAIN_DAYS;
    return at + again * 864e5;
  }
  if (FAILED.has(prev.status)) return at + Math.min(3 * 864e5, 6 * 36e5 * Math.pow(2, Math.max(0, (prev.fails || 1) - 1)));
  if (prev.status === 'not_found' || prev.status === 'no_results') return at + [7, 14, 30][Math.min(2, Math.max(0, (prev.empties || 1) - 1))] * 864e5;
  return at + 10 * 864e5; // something found, something still missing
}

/** The products to look up, those with the most important gaps first (code, price, EAN, photos, brand; in stock; dearer). */
function candidates(limit) {
  const catalog = require('./catalog');
  const L = catalog.links();
  const d = data();
  const now = Date.now();
  const out = [];
  const mk = require('./market').results();
  for (const site of catalog.SITES) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      if (site === 'st' && L.stToSf.has(p.id)) continue; // the same product on SpecialForces is looked up once
      const needs = needsOf(p, mk[site + ':' + p.id] || { stats: null });
      if (!needs.length) continue;
      const k = site + ':' + p.id;
      const prev = d.products[k];
      const left = prev && prev.status ? openNeeds(needs, prev.hits) : needs;
      if (!left.length) continue;
      if (dueAt(prev) > now) continue;
      const score = left.reduce((a, n) => a + WEIGHT[n], 0) + (prev ? 0 : 3) + (p.inStock !== false ? 1 : 0);
      out.push({ k, name: p.name, brand: p.brand || '', sku: p.sku || '', ean: p.ean || '', price: p.price || 0, inStock: p.inStock !== false, needs: left, round: (prev && prev.rounds) || 0, rank: Math.min(...left.map((x) => ORDER[x])), score });
    }
  }
  out.sort((a, b) => b.score - a.score || a.rank - b.rank || b.price - a.price);
  return out.slice(0, limit || out.length);
}

/** The products a person chose (or one product), with what each misses — searched now, whatever the schedule. */
function itemsFor(keys) {
  const catalog = require('./catalog');
  const d = data();
  const mk = require('./market').results();
  const out = [];
  for (const k of keys) {
    const m = String(k).match(/^(sf|st):(\d+)$/);
    if (!m) continue;
    const p = catalog.byId(m[1]).get(Number(m[2]));
    if (!p) continue;
    const prev = d.products[k];
    const needs = needsOf(p, mk[k] || { stats: null });
    const left = prev && prev.status ? openNeeds(needs, prev.hits) : needs;
    out.push({ k, name: p.name, brand: p.brand || '', sku: p.sku || '', ean: p.ean || '', price: p.price || 0, inStock: p.inStock !== false, needs: left.length ? left : needs.length ? needs : ['sku', 'images', 'brand', 'price'], round: (prev && prev.rounds) || 0 });
  }
  return out;
}

// the kind of product in English: the shops abroad (and many Greek ones) write it so
const KIND_EN = [[/^ΣΑΚΙΔ/, 'backpack'], [/^ΠΑΝΤΕΛ/, 'pants'], [/^ΜΠΟΥΦΑΝ/, 'jacket'], [/^ΑΡΒΥΛ|^ΜΠΟΤ/, 'boots'], [/^ΠΑΠΟΥΤΣ/, 'shoes'], [/^ΓΑΝΤ/, 'gloves'], [/^ΦΑΚΟΣ|^ΦΑΚΟΙ|^ΦΑΚΟ$/, 'flashlight'],
  [/^ΜΑΧΑΙΡ|^ΣΟΥΓΙ/, 'knife'], [/^ΘΗΚ/, 'pouch'], [/^ΖΩΝ/, 'belt'], [/^ΚΑΠΕΛ|^ΤΖΟΚΕ/, 'cap'], [/^ΣΚΟΥΦ/, 'beanie'], [/^ΓΥΑΛΙ/, 'glasses'], [/^ΚΙΑΛ/, 'binoculars'], [/^ΔΙΟΠΤΡ/, 'scope'],
  [/^ΦΥΣΙΓΓ/, 'shells'], [/^ΒΟΛΙΔ|^ΣΚΑΓΙ/, 'pellets'], [/^ΜΠΛΟΥΖ|^ΦΑΝΕΛ/, 't-shirt'], [/^ΠΟΥΚΑΜ|^ΧΙΤΩΝ/, 'shirt'], [/^ΓΙΛΕΚ/, 'vest'], [/^ΚΑΛΤΣ/, 'socks'], [/^ΣΚΗΝ/, 'tent'],
  [/^ΥΠΝΟΣΑΚ/, 'sleeping bag'], [/^ΜΠΑΤΑΡ/, 'battery'], [/^ΦΟΡΤΙΣΤ/, 'charger'], [/^ΡΟΛΟΙ/, 'watch'], [/^ΣΗΜΑ/, 'patch'], [/^ΖΑΚΕΤ|^FLEECE/, 'fleece'], [/^ΦΟΥΤΕΡ/, 'hoodie'],
  [/^ΤΣΑΝΤ|^ΣΑΚΟΣ/, 'bag'], [/^ΒΕΡΜΟΥΔ|^ΣΟΡΤΣ/, 'shorts'], [/^ΓΕΜΙΣΤΗΡ/, 'magazine'], [/^ΑΕΡΟΒΟΛ/, 'air rifle'], [/^ΚΑΡΑΜΠΙΝ/, 'shotgun'], [/^ΜΑΣΚ/, 'mask'], [/^ΚΡΑΝ/, 'helmet'],
  [/^ΕΠΙΓΟΝΑΤ/, 'knee pads'], [/^ΠΑΓΟΥΡ/, 'bottle'], [/^ΦΙΛΤΡ/, 'filter'], [/^ΠΥΞΙΔ/, 'compass'], [/^ΣΚΟΠΕΥΤ/, 'sight'], [/^ΛΑΒ/, 'grip'], [/^ΙΜΑΝΤ/, 'sling']];
function kindEn(title) {
  const first = U.stripTonos(String(title || '').split(/\s+/)[0] || '').toUpperCase();
  const k = KIND_EN.find(([re]) => re.test(first));
  return k ? k[1] : '';
}

/**
 * What to type in the searches, from what we know: brand + code first, then the EAN, the title, brand + model words,
 * the code alone (and without dashes), the maker's code, the English kind, the model words without a brand.
 * it.round (how many times it was searched): the later rounds put the other ways of writing it first.
 */
function queriesOf(it) {
  const market = require('./market');
  const title = U.collapse(U.decodeEntities(it.name));
  const brand = U.collapse(U.decodeEntities(it.brand || ''));
  const withBrand = brand && !U.foldKey(title).includes(U.foldKey(brand)) ? brand + ' ' + title : title;
  const f = market.features({ name: it.name, brand: it.brand });
  const keys = f.keys.filter((k) => /[A-Z0-9]/.test(k));
  const sku = U.collapse(it.sku || '');
  const skuFlat = U.normSku(sku);
  const ean = gtin(it.ean) ? String(it.ean).replace(/\D/g, '') : '';
  const mpn = U.collapse(it.mpn || '');
  const en = kindEn(title);
  // the model as the shops write it, in Latin letters (no Greek type words, colours or sizes)
  const latin = title.split(/\s+/).filter((w) => !/[Ͱ-Ͽ]/.test(w)).join(' ');
  const first = [], alt = [];
  if (sku) first.push(`${brand} ${sku}`.trim());
  if (ean) first.push(ean);
  first.push(withBrand);
  if (brand && keys.length) first.push(`${brand} ${keys.join(' ')}`);
  if (sku && skuFlat.length >= 5 && /\d/.test(skuFlat)) { alt.push(sku); if (skuFlat !== sku.toUpperCase()) alt.push(skuFlat); }
  if (mpn && U.normSku(mpn) !== skuFlat) alt.push(`${brand} ${mpn}`.trim());
  if (en && (brand || keys.length)) alt.push(`${brand} ${keys.join(' ')} ${en}`.replace(/\s+/g, ' ').trim());
  if (!brand) {
    // no brand: the model words / codes of the title (a product without a brand is still searched in earnest)
    if (latin && latin !== title) alt.push(latin);
    if (keys.length >= 2) alt.push(keys.join(' ') + (en ? ' ' + en : ''));
  } else if (latin && U.foldKey(latin) !== U.foldKey(withBrand)) alt.push(latin.includes(brand) ? latin : `${brand} ${latin}`);
  for (const c of f.codes.slice(0, 2)) alt.push(brand ? `${brand} ${c}` : c);
  const order = (it.round || 0) % 2 === 1 ? first.slice(0, 1).concat(alt, first.slice(1)) : first.concat(alt);
  const seen = new Set();
  return order.map((q) => U.collapse(q)).filter((q) => { const k = U.foldKey(q); if (q.length < 4 || seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_QUERIES);
}
function queryOf(it) { return queriesOf(it)[0]; }

/** One address, written one way (no #, no tracking tails, no trailing slash): the same page is never read twice. */
function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|gclid|fbclid|srsltid|msclkid|ref$|_pos|_sid|_ss)/i.test(k)) x.searchParams.delete(k);
    return (x.origin + x.pathname.replace(/\/+$/, '') + (x.search || '')).toLowerCase();
  } catch (_) { return String(u || '').toLowerCase(); }
}
// pages that are never a product: the shop's search, tags, blog posts, files
const NOT_PRODUCT = /[?&](s|q|search|query|keyword)=|\/(search|tag|tags|blog|news|article|articles)(\/|$)|\.(pdf|jpe?g|png|webp|gif|zip|docx?|xlsx?)$/i;

/** Run `fn` over `list`, `n` at a time. */
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => { while (i < list.length) { const x = list[i++]; await fn(x); } }));
}

/**
 * A page with sizes / colours seen for OUR product: the price, EAN and stock of our colour (never another variant's).
 * → { price, ean, avail, priceKind: 'single' | 'from' | 'other-colour' }
 */
function variantView(pg, ourColours) {
  const market = require('./market');
  const vs = (pg.variants || []).filter((v) => v && typeof v === 'object');
  const avail0 = pg.availability || (pg.inStock === true ? 'in' : pg.inStock === false ? 'out' : 'unknown');
  if (!vs.length) return { price: Number(pg.price) || 0, ean: gtin(pg.ean) ? String(pg.ean).replace(/\D/g, '') : '', avail: avail0, priceKind: 'single' };
  let poolV = vs, kind = '';
  if (ourColours.size && vs.some((v) => v.color)) {
    poolV = vs.filter((v) => [...market.coloursOf(v.color || '')].some((c) => ourColours.has(c)));
    if (!poolV.length) { poolV = vs; kind = 'other-colour'; }
  }
  const st = (v) => (v.inStock === true ? 'in' : v.inStock === false ? 'out' : 'unknown');
  const told = poolV.filter((v) => st(v) !== 'unknown');
  const inV = poolV.filter((v) => st(v) === 'in' && v.price > 0);
  const priced = poolV.filter((v) => v.price > 0);
  const price = inV.length ? Math.min(...inV.map((v) => v.price)) : priced.length ? Math.min(...priced.map((v) => v.price)) : Number(pg.price) || 0;
  const varies = new Set((inV.length ? inV : priced).map((v) => v.price)).size > 1;
  let avail = told.length ? (told.some((v) => st(v) === 'in') ? 'in' : told.length === poolV.length ? 'out' : 'unknown') : avail0;
  if (kind === 'other-colour') avail = 'unknown'; // our colour is not on their page: nothing is known of its stock
  const eans = [...new Set(poolV.map((v) => gtin(v.ean)).filter(Boolean))];
  const ean = eans.length === 1 && poolV.every((v) => gtin(v.ean) === eans[0]) ? eans[0] : !vs.some((v) => v.ean) && gtin(pg.ean) && kind !== 'other-colour' ? String(pg.ean).replace(/\D/g, '') : '';
  return { price, ean, avail, priceKind: kind || (varies ? 'from' : 'single') };
}

/** The same code: whole, or a word of their title that is our code (never a part of a longer number). */
function sameCodeOf(it, pg) {
  const ours = U.normSku(it.sku || '');
  if (ours.length < 4) return false;
  const theirs = [pg.code, pg.sku, pg.mpn].map((x) => U.normSku(x || '')).filter((x) => x.length >= 4);
  if (theirs.includes(ours)) return true;
  if (ours.length < 5) return false;
  const words = U.foldKey(pg.name || '').split(/[^A-Z0-9Α-Ω.\-_/]+/).map((w) => U.normSku(w)).filter(Boolean);
  for (let i = 0; i < words.length; i++) if (words[i] === ours || (words[i + 1] && words[i] + words[i + 1] === ours)) return true;
  return false;
}

/**
 * One product: many searches, the shop pages read, those that show the same product kept — and what happened, step
 * by step. io = { search(q) → [{ url }] (with .engines), page(url) → { name, brand, code, sku, mpn, ean, price,
 * currency, availability, images, variants }, own: Set(host), parallel, cancelled() }
 * → { hits, read, queries, status, needsLeft, sum, trace }
 *   status: complete (everything it missed was found) · partial (something found, something missing) · not_found
 *   (pages read, none the same product) · no_results (the searches gave no shop page) · pages_failed (no page opened)
 *   · search_failed (no engine answered) · blocked (the engines asked for a pause) · cancelled (stopped)
 */
async function lookUp(it, io) {
  const market = require('./market');
  const sfind = require('./supplierfind');
  const needs = Array.isArray(it.needs) && it.needs.length ? it.needs : ['sku', 'images', 'brand', 'price'];
  const hits = [];
  const tried = new Set(), perHost = new Map(), doneHost = new Set();
  const trace = { at: U.nowIso(), queries: [], pages: [] };
  const sum = { queries: 0, engines: {}, results: 0, opened: 0, read: 0, exact: 0, rejected: 0, errors: 0 };
  let read = 0, queries = 0, status = '', engineOk = 0, engineErr = 0;
  const ourColours = market.coloursOf(it.name);
  const ourEan = gtin(it.ean);
  const our = { name: it.name, brand: it.brand, sku: it.sku || '', price: it.price, ean: it.ean || '' };
  const note = (pg0, outcome, why) => { if (trace.pages.length < 40) trace.pages.push({ url: pg0.url.slice(0, 300), host: pg0.host, q: pg0.qi, outcome, why: String(why || '').slice(0, 140) }); };
  for (const q of queriesOf(it)) {
    if (io.cancelled && io.cancelled()) { status = 'cancelled'; break; }
    // enough: what it missed is found by two shops (or six shops show it)
    if (hits.length >= 6 || (hits.length >= 2 && !openNeeds(needs, hits).length)) break;
    let results;
    try { results = await io.search(q); } catch (e) {
      if (e instanceof sfind.Blocked) {
        if (!queries) throw e; // nothing done yet: the job waits and asks again for this product
        status = 'blocked'; trace.queries.push({ q, n: 0, engines: e.engines || null, error: 'οι μηχανές αναζήτησης ζήτησαν παύση' }); break;
      }
      if (e && e.cancelled) { status = 'cancelled'; break; }
      engineErr++; sum.errors++;
      trace.queries.push({ q, n: 0, error: String(e.message || e).slice(0, 140) });
      continue;
    }
    queries++;
    const eng = (results && results.engines) || null;
    if (eng) for (const x of eng) { sum.engines[x.id] = sum.engines[x.id] || { ok: 0, failed: 0, blocked: 0 }; if (x.state === 'ok') { sum.engines[x.id].ok++; engineOk++; } else if (x.state === 'blocked' || x.state === 'paused') sum.engines[x.id].blocked++; else { sum.engines[x.id].failed++; engineErr++; } }
    else engineOk++;
    const qi = trace.queries.length;
    trace.queries.push({ q, n: (results || []).length, engines: eng });
    sum.results += (results || []).length;
    const pages = [];
    // the likelier pages first (a title with our code or brand), another colour last: fewer pages to open
    const ourBrand = U.foldKey(it.brand || ''), ourSku = U.normSku(it.sku || '');
    const like = (r) => { const t = String(r.title || ''); if (!t) return 0; let v = 0; if (ourSku.length >= 4 && U.normSku(t).includes(ourSku)) v += 3; if (ourBrand && U.foldKey(t).includes(ourBrand)) v += 1; const c = market.coloursOf(t); if (ourColours.size && c.size && ![...c].some((x) => ourColours.has(x))) v -= 2; return v; };
    const ranked = (results || []).map((r, i) => [r, like(r), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
    for (const r of ranked) {
      if (!r || !/^https?:\/\//i.test(r.url)) continue;
      const host = hostOf(r.url);
      const nu = normUrl(r.url);
      if (!host || tried.has(nu)) continue;
      // the same page from another search: counted once; our own sites, marketplaces, social networks: never
      if ((io.own && io.own.has(host)) || sfind.NEVER.test(host)) { tried.add(nu); continue; }
      if (doneHost.has(host)) continue; // this shop already showed the product
      if ((perHost.get(host) || 0) >= PER_HOST) continue;
      tried.add(nu);
      if (NOT_PRODUCT.test(r.url)) { note({ url: r.url, host, qi }, 'skipped', 'δεν είναι σελίδα προϊόντος (αναζήτηση / άρθρο / αρχείο)'); continue; }
      perHost.set(host, (perHost.get(host) || 0) + 1);
      pages.push({ host, url: r.url, qi });
      if (pages.length >= PAGES_PER_QUERY) break;
    }
    await pool(pages, io.parallel || 2, async (pg0) => {
      if (io.cancelled && io.cancelled()) return;
      if (doneHost.has(pg0.host)) { note(pg0, 'skipped', 'το κατάστημα έδειξε ήδη το προϊόν'); return; }
      let pg;
      sum.opened++;
      try { pg = await io.page(pg0.url); read++; sum.read++; sfind.count('page'); } catch (e) { sum.errors++; note(pg0, 'error', e.message || e); return; }
      if (!pg || !pg.name) { note(pg0, 'no_data', 'η σελίδα δεν έδωσε στοιχεία προϊόντος'); return; }
      if (pg.isProduct === false && !(Number(pg.price) > 0) && !pg.code && !pg.sku && !pg.ean) { note(pg0, 'not_product', 'δεν είναι σελίδα ενός προϊόντος'); return; }
      const view = variantView(pg, ourColours);
      // the same product: the same EAN, the same code as ours, or the matching of the price research says «exact»
      const sameEan = !!(ourEan && (gtin(pg.ean) === ourEan || (pg.variants || []).some((v) => gtin(v.ean) === ourEan)));
      const sameCode = sameCodeOf(it, pg);
      const chk = market.score(our, { name: pg.name, sku: pg.sku || pg.code || '', mpn: pg.mpn || '', brand: pg.brand || '', price: view.price, ean: view.ean || (pg.variants && pg.variants.length ? '' : pg.ean || '') });
      let match = '', how = '';
      if (sameEan) { match = 'exact'; how = 'ean'; }
      else if (sameCode && chk.match !== 'none') { match = chk.match === 'exact' ? 'exact' : 'code'; how = 'code'; }
      else if (chk.match === 'exact') { match = 'exact'; how = 'words'; }
      // another colour of the same model: for the price research it may cost the same, but its code, EAN and photos
      // are another product's — the internet research never takes it (a page with variants is seen for our colour)
      if (match && !sameEan && ourColours.size && !(pg.variants || []).length) {
        // each title has a colour the other has not (URBAN of «URBAN LINE» on both sides proves nothing)
        const theirs = market.coloursOf(pg.name);
        const onlyOurs = [...ourColours].filter((c) => !theirs.has(c)), onlyTheirs = [...theirs].filter((c) => !ourColours.has(c));
        if (onlyOurs.length && onlyTheirs.length) { sum.rejected++; note(pg0, 'similar', 'άλλο χρώμα: ' + onlyTheirs.join(' ') + ' — «' + String(pg.name).slice(0, 70) + '»'); return; }
      }
      // another version (PRO, MK2, MINI…) found by the base of the code only: not the same (the whole code or the EAN would be)
      if (match && !sameEan && U.normSku(pg.sku || pg.code || '') !== U.normSku(it.sku || '-')) {
        const ourW = new Set(market.keyTokens(it.name, it.brand)), theirW = market.keyTokens(pg.name, pg.brand || it.brand);
        const mod = theirW.find((w) => market.MODIFIERS.has(w) && !ourW.has(w)) || [...ourW].find((w) => market.MODIFIERS.has(w) && !theirW.includes(w));
        if (mod) { sum.rejected++; note(pg0, 'similar', `άλλη έκδοση («${mod}») — «${String(pg.name).slice(0, 70)}»`); return; }
      }
      if (!match) { sum.rejected++; note(pg0, chk.match === 'similar' ? 'similar' : 'other', (chk.match === 'similar' ? 'παρόμοιο, όχι ίδιο: ' + (chk.why || '') : 'άλλο προϊόν') + ' — «' + String(pg.name).slice(0, 70) + '»'); return; }
      if (doneHost.has(pg0.host)) return;
      doneHost.add(pg0.host);
      sum.exact++;
      const images = (pg.images || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 4);
      // a price counts only in euro (a Greek shop without a currency is in euro; any other is left out)
      const cur = String(pg.currency || '').toUpperCase();
      const euro = cur === 'EUR' || (!cur && /\.(gr|cy)$/.test(pg0.host));
      hits.push({ host: pg0.host, url: pg.url || pg0.url, name: String(pg.name).slice(0, 200), brand: String(pg.brand || '').slice(0, 60), code: String(pg.mpn || pg.sku || pg.code || '').slice(0, 60), sku: String(pg.sku || '').slice(0, 60), mpn: String(pg.mpn || '').slice(0, 60),
        ean: view.ean, price: euro ? Number(view.price) || 0 : 0, regular: euro && Number(pg.regular) > view.price ? Number(pg.regular) : 0, currency: cur, avail: view.avail, priceKind: view.priceKind,
        img: images[0] || '', images, how, match, at: U.nowIso(), proof: how === 'ean' ? 'ίδιο EAN' : how === 'code' ? 'ίδιος κωδικός' + (match === 'code' ? ' (οι τίτλοι διαφέρουν: ' + (chk.why || 'έλεγξέ το') + ')' : '') : (chk.ev || []).join(' · ') || 'ίδιο προϊόν' });
      note(pg0, 'same', (how === 'ean' ? 'ίδιο EAN' : how === 'code' ? 'ίδιος κωδικός' : 'ίδιο προϊόν') + (view.avail === 'in' ? ' · διαθέσιμο' : view.avail === 'out' ? ' · εξαντλημένο' : ' · διαθεσιμότητα άγνωστη') + (euro ? '' : ' · τιμή όχι σε ευρώ'));
    });
  }
  if (!status) {
    const anyPages = sum.opened > 0;
    if (!queries && engineErr) status = 'search_failed';
    else if (queries && !engineOk && engineErr) status = 'search_failed';
    else if (hits.length) status = openNeeds(needs, hits).length ? 'partial' : 'complete';
    else if (anyPages && !read) status = 'pages_failed';
    else if (anyPages) status = 'not_found';
    else status = 'no_results';
  }
  sum.queries = queries;
  return { hits, read, queries, status, needsLeft: openNeeds(needs, hits), sum, trace };
}

/** The pages of before and of now, together: a page found again is the new one; one not read again stays (4 months). */
function mergeHits(prev, r) {
  const fresh = (r.hits || []).filter((h) => h && h.host);
  if (!r.status) return fresh; // a result written as it is (by hand, or an old one): it replaces
  const byUrl = new Set(fresh.map((h) => normUrl(h.url)));
  const reread = new Set(((r.trace && r.trace.pages) || []).filter((p) => p.outcome !== 'error' && p.outcome !== 'skipped').map((p) => normUrl(p.url)));
  const keep = ((prev && prev.hits) || []).filter((h) => h && h.host && !byUrl.has(normUrl(h.url)) && !reread.has(normUrl(h.url)) && days(h.at || prev.at) <= HIT_DAYS && !fresh.some((x) => x.host === h.host));
  return fresh.concat(keep).slice(0, 12);
}

/** Keep what was found for a product (with what happened), and count the shops that sell our products. */
function save(results) {
  const own = ownHosts();
  const traces = {};
  const merged = {};
  store.update(KEY, {}, (d) => {
    d.products = d.products || {}; d.shops = d.shops || {};
    for (const [k, r] of Object.entries(results)) {
      const prev = d.products[k] || null;
      const hits = mergeHits(prev, Object.assign({}, r, { hits: (r.hits || []).filter((h) => h && h.host && !own.has(h.host)) }));
      merged[k] = hits;
      const now = U.nowIso();
      const e = { at: now, hits, read: r.read || 0 };
      // the same research handed in twice (a part during the work, then the whole): counted once
      const again = !!(r.trace && r.trace.at && prev && prev.runAt === r.trace.at);
      if (r.status && again) { e.status = prev.status; Object.assign(e, { okAt: prev.okAt, queries: prev.queries, needsLeft: prev.needsLeft, sum: prev.sum, rounds: prev.rounds, fails: prev.fails, empties: prev.empties, runAt: prev.runAt, at: prev.at }); }
      else if (r.status) {
        const ok = SUCCESS.has(r.status);
        const gotNew = (r.hits || []).length > 0;
        Object.assign(e, {
          status: r.status, okAt: ok ? now : (prev && prev.okAt) || null, queries: r.queries || 0, needsLeft: r.needsLeft || [], sum: r.sum || null,
          rounds: ((prev && prev.rounds) || 0) + 1,
          fails: FAILED.has(r.status) ? ((prev && prev.fails) || 0) + 1 : 0,
          empties: ok && !gotNew ? ((prev && prev.empties) || 0) + 1 : 0,
          runAt: (r.trace && r.trace.at) || now,
          // a failed or cut research changes nothing of what was found before
        });
        if (FAILED.has(r.status) && prev) e.hits = mergeHits(prev, { status: r.status, hits: r.hits || [], trace: null });
        if (r.trace) traces[k] = Object.assign({ status: r.status }, r.trace, { sum: r.sum || null });
      }
      d.products[k] = e;
      for (const h of e.hits) {
        const s = d.shops[h.host] || { host: h.host, url: 'https://' + h.host + '/', products: [] };
        if (!s.products.includes(k)) s.products.push(k);
        s.products = s.products.slice(-50);
        s.at = U.nowIso();
        d.shops[h.host] = s;
      }
    }
    return d;
  });
  if (Object.keys(traces).length) {
    store.update(TRACE_KEY, {}, (t) => {
      t.items = t.items || {}; t.order = (t.order || []).filter((k) => !traces[k]);
      for (const [k, v] of Object.entries(traces)) { t.items[k] = v; t.order.push(k); }
      while (t.order.length > TRACE_KEEP) delete t.items[t.order.shift()];
      return t;
    });
  }
  // the prices of those shops go into the price research (for the products with no price from the competitors too)
  try { require('./market').mergeWeb(merged); } catch (e) { console.error('internet prices:', e.message); }
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
    page: (url) => extract.fromUrl(url, { gap: 1500, signal: state.signal }),
    cancelled: () => !!(job && job.cancelled()),
    parallel: 2,
    state,
  };
}

/**
 * Look up the next `max` products (a job of the program). Stops when the search engines ask for a pause (it goes on
 * later: those products are due again within hours). → { looked, withCode, blocked, failed }
 */
async function run(job, opts) {
  opts = opts || {};
  const sfind = require('./supplierfind');
  const list = opts.items || candidates(Math.max(1, Number(opts.max) || 20));
  const io = opts.io || localIO(job && job.signal, job);
  let looked = 0, withCode = 0, blocked = false, failed = 0;
  const results = {};
  job && job.progress(0, list.length, `Έρευνα στο internet: ${list.length} προϊόντα (κωδικός, EAN, φωτογραφίες, μάρκα, τιμή)…`);
  for (const it of list) {
    if (job && job.cancelled()) break;
    try {
      const r = await lookUp(it, io);
      results[it.k] = r;
      looked++;
      if (r.hits.length) withCode++;
      if (FAILED.has(r.status)) failed++;
      if (r.status === 'blocked') { blocked = true; job && job.log('Οι μηχανές αναζήτησης ζήτησαν παύση· η αναζήτηση συνεχίζει αργότερα.'); break; }
      if (r.status === 'cancelled') break;
    } catch (e) {
      if (e instanceof sfind.Blocked) { blocked = true; job && job.log('Οι μηχανές αναζήτησης ζήτησαν παύση· η αναζήτηση συνεχίζει αργότερα.'); break; }
      // an error is written as an error (looked up again soon), never as «nothing found»
      results[it.k] = { hits: [], read: 0, status: 'error', trace: { at: U.nowIso(), queries: [], pages: [], error: String(e.message || e).slice(0, 200) } };
      failed++;
    }
    if (looked % 5 === 0) { save(results); for (const k of Object.keys(results)) delete results[k]; }
    job && job.progress(looked, list.length, `Έρευνα στο internet: ${looked}/${list.length} · ίδιο προϊόν σε άλλα καταστήματα για ${withCode}`);
  }
  save(results);
  return { looked, withCode, blocked, failed };
}

/** What the shops of the web say about one of our products (for the proposals). */
function hitsFor(key) { const e = data().products[key]; return e ? e.hits || [] : []; }
/** What the research did for one product, in detail (the last time): searches, engines, pages and why. */
function traceFor(key) {
  const e = data().products[key] || null;
  const t = ((store.read(TRACE_KEY, null) || {}).items || {})[key] || null;
  if (!e && !t) return null;
  return { at: e ? e.at : t.at, okAt: e ? e.okAt || null : null, status: e ? e.status || (e.hits && e.hits.length ? 'complete' : 'not_found') : t.status, needsLeft: e ? e.needsLeft || [] : [], hits: e ? (e.hits || []).map((h) => ({ host: h.host, url: h.url, name: h.name, code: h.code, ean: h.ean, price: h.price, avail: h.avail || 'unknown', how: h.how, at: h.at })) : [], sum: (e && e.sum) || (t && t.sum) || null, queries: t ? t.queries : [], pages: t ? t.pages : [], error: t && t.error ? t.error : '', nextAt: e ? new Date(dueAt(e)).toISOString() : null };
}

/** Shops that sell several of our products and are not competitors yet: proposed for the price research. */
function suggestedShops(min) {
  const market = require('./market');
  const have = new Set(market.competitors().map((c) => hostOf(c.url)));
  return Object.values(data().shops).filter((s) => !have.has(s.host) && s.products.length >= (min || 3)).sort((a, b) => b.products.length - a.products.length).slice(0, 20).map((s) => ({ host: s.host, url: s.url, count: s.products.length, at: s.at }));
}

/** Where the internet research stands for some products: { 'site:id': { at, hits, prices, status } } (only those looked up). */
function stateOf(keys) {
  const d = data();
  const out = {};
  for (const k of keys) { const e = d.products[k]; if (e) out[k] = { at: e.at, hits: (e.hits || []).length, prices: (e.hits || []).filter((h) => h.price > 0).length, status: e.status || '' }; }
  return out;
}
/** How far the search has come (failed researches are counted apart: they are not «looked up»). */
function status() {
  const d = data();
  const all = Object.values(d.products);
  const by = {};
  for (const e of all) { const s = e.status || ((e.hits || []).length ? 'complete' : 'not_found'); by[s] = (by[s] || 0) + 1; }
  return { looked: all.filter((e) => !FAILED.has(e.status)).length, withCode: all.filter((e) => (e.hits || []).length).length, waiting: candidates().length, byStatus: by, failed: all.filter((e) => FAILED.has(e.status)).length };
}

module.exports = { itemsFor, stateOf, candidates, lookUp, run, save, hitsFor, traceFor, suggestedShops, status, queryOf, queriesOf, needsOf, openNeeds, dueAt, variantView, normUrl, kindEn, KEY, TRACE_KEY, FAILED };
